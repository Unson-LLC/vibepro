import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';

const execFileAsync = promisify(execFile);
const VIBEPRO_BIN = path.resolve('bin/vibepro.js');

async function run(command, args, cwd, options = {}) {
  const { stdout } = await execFileAsync(command, args, { cwd, encoding: 'utf8', ...options });
  return stdout;
}

// Feed stdin explicitly: the async execFile has no `input` option, and a child that
// reads stdin would otherwise hang waiting for EOF.
function runWithStdin(command, args, cwd, input) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(`exit ${code}: ${stderr}`));
    });
    child.stdin.end(input);
  });
}

async function makeRepo(storyId) {
  const repo = await mkdtemp(path.join(os.tmpdir(), 'vibepro-input-e2e-'));
  await run('git', ['init', '-b', 'main'], repo);
  await run('git', ['config', 'user.email', 'test@example.com'], repo);
  await run('git', ['config', 'user.name', 'Test User'], repo);
  await run(process.execPath, [VIBEPRO_BIN, 'init', repo, '--story-id', storyId, '--title', 'Input Regression'], repo);
  await run('git', ['add', '-A'], repo);
  await run('git', ['commit', '-m', 'chore: initialize repo'], repo);
  await run('git', ['switch', '-c', 'feature/input'], repo);
  return repo;
}

function nodeById(prepare, id) {
  return prepare.pr_context.gate_dag.nodes.find((node) => node.id === id);
}

// Regression: `decision record --from-stdin` threw `stdin is not defined` because the
// handler referenced a bare `stdin` instead of `io.stdin ?? process.stdin`.
test('decision record --from-stdin reads structured evidence without ReferenceError', async () => {
  const storyId = 'story-input-decision';
  const repo = await makeRepo(storyId);
  const stdout = await runWithStdin(
    process.execPath,
    [VIBEPRO_BIN, 'decision', 'record', repo, '--id', storyId, '--type', 'noise',
      '--summary', 'fallback', '--source', 'finding:x', '--source-status', 'open',
      '--reason', 'noise finding', '--from-stdin', '--json'],
    repo,
    '{"evidence":{"detail":"structured payload from stdin"}}\n'
  );
  const result = JSON.parse(stdout);
  assert.equal(result.decision.type, 'noise');
  assert.match(result.decision.summary, /structured payload from stdin/);
});

// Regression: SwiftPM `Sources/` and `Tests/` were classified as `other`, so a Swift
// code change looked like a docs-only change (sourceCount === 0).
test('pr prepare classifies SwiftPM Sources/ as source and Tests/ as tests', async () => {
  const storyId = 'story-input-swift';
  const repo = await makeRepo(storyId);
  await mkdir(path.join(repo, 'Sources', 'App'), { recursive: true });
  await mkdir(path.join(repo, 'Tests', 'AppTests'), { recursive: true });
  await writeFile(path.join(repo, 'Sources', 'App', 'Main.swift'), 'let answer = 42\n');
  await writeFile(path.join(repo, 'Tests', 'AppTests', 'MainTests.swift'), 'import XCTest\n');
  await run('git', ['add', '-A'], repo);
  await run('git', ['commit', '-m', 'feat: swift source and tests'], repo);

  const stdout = await run(process.execPath, [VIBEPRO_BIN, 'pr', 'prepare', repo, '--base', 'main', '--story-id', storyId, '--json'], repo);
  const prepare = JSON.parse(stdout);
  assert.equal(prepare.pr_context.pr_route.route_type, 'runtime_change');
  assert.ok(prepare.pr_context.pr_route.signals.includes('file_group:source'));
  const summary = prepare.pr_context.change_summary.join('\n');
  assert.match(summary, /Sources\/App\/Main\.swift/);
  assert.match(summary, /Tests\/AppTests\/MainTests\.swift/);
});

// Regression: an explicit `impact_scope_explained:` statement in the Story doc did not
// satisfy the Common Judgment Spine because the evidence was only derived from an
// inferred spec.json, never from the documented `## 影響範囲` authoring path.
test('common judgment spine credits impact_scope_explained from the Story doc on a docs-only change', async () => {
  const storyId = 'story-input-impact';
  const repo = await makeRepo(storyId);
  await mkdir(path.join(repo, 'docs', 'stories'), { recursive: true });
  await writeFile(path.join(repo, 'docs', 'stories', `${storyId}.md`), [
    '---',
    `story_id: ${storyId}`,
    'title: Impact Scope Regression',
    '---',
    '# Impact Scope Regression',
    '',
    '## 背景',
    'Workflow gate orchestration agent review dag replay retry keywords.',
    '',
    '## 受け入れ基準',
    '- [ ] AC1: 影響範囲を明示する',
    '',
    '## 影響範囲',
    '',
    'impact_scope_explained: このStoryの影響範囲は docs のみに限定し、runtime や auth 境界は変更しない。',
    ''
  ].join('\n'));
  await run('git', ['add', '-A'], repo);
  await run('git', ['commit', '-m', 'docs: add story with impact scope statement'], repo);

  const stdout = await run(process.execPath, [VIBEPRO_BIN, 'pr', 'prepare', repo, '--base', 'main', '--story-id', storyId, '--json'], repo);
  const prepare = JSON.parse(stdout);
  assert.equal(prepare.pr_context.pr_route.route_type, 'docs_only');
  const spine = nodeById(prepare, 'gate:common_judgment_spine');
  const failureModes = spine.subchecks.find((check) => check.id === 'failure_modes');
  const doneEvidence = spine.subchecks.find((check) => check.id === 'done_evidence');
  assert.ok(
    failureModes.matched_evidence.some((item) => item.kind === 'impact_scope_explained'),
    'failure_modes should be backed by the documented impact_scope_explained statement'
  );
  assert.deepEqual(failureModes.missing_evidence, []);
  assert.deepEqual(doneEvidence.missing_evidence, []);
});
