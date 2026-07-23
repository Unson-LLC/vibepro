import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

import { runCli } from '../src/cli.js';
import { writeInferredSpec } from '../src/spec-store.js';

const execFileAsync = promisify(execFile);

async function makeRepo() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vibepro-gate-check-test-'));
  await writeFile(path.join(root, 'index.html'), '<!doctype html><title>Test</title>');
  return root;
}

async function git(repo, args) {
  return execFileAsync('git', args, { cwd: repo, encoding: 'utf8' });
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'));
}

async function makeGitRepoWithStory(storyId = 'story-gate-check') {
  const repo = await makeRepo();
  await git(repo, ['init', '-b', 'main']);
  await git(repo, ['config', 'user.email', 'vibepro@example.com']);
  await git(repo, ['config', 'user.name', 'VibePro Test']);
  await runCli([
    'init',
    repo,
    '--story-id',
    storyId,
    '--title',
    'Gate Check',
    '--view',
    'dev',
    '--period',
    '2026-W29'
  ]);
  await git(repo, ['add', '.']);
  await git(repo, ['commit', '-m', 'chore: init test repo']);
  return repo;
}

test('gate check reports blocked with exit code 1 when required gates are unresolved', async () => {
  const repo = await makeGitRepoWithStory('story-gate-check');

  const result = await runCli(['gate', 'check', repo, '--story-id', 'story-gate-check', '--base', 'main', '--ci', '--json']);

  assert.equal(result.exitCode, 1);
  assert.equal(result.result.status, 'blocked');
  assert.equal(result.result.ready_for_pr_create, false);
  assert.ok(result.result.unresolved_gate_count > 0);
});

test('gate check --json shape exposes normalized report fields', async () => {
  const repo = await makeGitRepoWithStory('story-gate-check');

  const result = await runCli(['gate', 'check', repo, '--story-id', 'story-gate-check', '--base', 'main', '--json']);
  const report = result.result;

  assert.equal(report.schema_version, '0.1.0');
  assert.equal(report.story_id, 'story-gate-check');
  assert.ok(['passed', 'blocked', 'error'].includes(report.status));
  assert.ok(typeof report.overall_status === 'string');
  assert.ok(typeof report.ready_for_pr_create === 'boolean');
  assert.ok(Array.isArray(report.gates));
  assert.ok(report.gates.length > 0);
  for (const gate of report.gates) {
    assert.ok(typeof gate.id === 'string');
    assert.ok(typeof gate.status === 'string');
    assert.ok(typeof gate.blocking === 'boolean');
  }
  assert.ok(typeof report.unresolved_gate_count === 'number');
  assert.ok(typeof report.critical_unresolved_gate_count === 'number');
  assert.ok(typeof report.generated_at === 'string');
});

test('gate check is read-only: does not create pr-prepare.json when absent', async () => {
  const repo = await makeGitRepoWithStory('story-gate-check');
  // `vibepro init` scaffolds an empty `.vibepro/pr/<story-id>/` directory, but
  // `pr-prepare.json` (and the other artifacts `pr prepare` writes) must not
  // exist until an actual (write-permitted) `pr prepare`/`pr autopilot` runs.
  const prPreparePath = path.join(repo, '.vibepro', 'pr', 'story-gate-check', 'pr-prepare.json');

  await assert.rejects(stat(prPreparePath), { code: 'ENOENT' });

  await runCli(['gate', 'check', repo, '--story-id', 'story-gate-check', '--base', 'main', '--json']);

  await assert.rejects(stat(prPreparePath), { code: 'ENOENT' });
});

test('gate check is read-only: leaves existing .vibepro/pr/<story-id> artifacts byte-identical', async () => {
  const repo = await makeGitRepoWithStory('story-gate-check');

  // Seed pre-existing artifacts via a real `pr prepare` run first.
  await runCli(['pr', 'prepare', repo, '--story-id', 'story-gate-check', '--base', 'main', '--json']);

  const prDir = path.join(repo, '.vibepro', 'pr', 'story-gate-check');
  const prPreparePath = path.join(prDir, 'pr-prepare.json');
  const before = await readFile(prPreparePath, 'utf8');
  const statBefore = await stat(prPreparePath);

  await runCli(['gate', 'check', repo, '--story-id', 'story-gate-check', '--base', 'main', '--json']);

  const after = await readFile(prPreparePath, 'utf8');
  const statAfter = await stat(prPreparePath);
  assert.equal(after, before);
  // `cp(..., { preserveTimestamps: true })` round-trips mtime through the
  // filesystem's timestamp resolution, which can lose sub-millisecond
  // precision; a sub-millisecond tolerance still proves the file was
  // restored rather than freshly rewritten by `preparePullRequest`.
  assert.ok(Math.abs(statAfter.mtimeMs - statBefore.mtimeMs) < 1);
});

test('gate check rejects snapshot routes through an external symlink without touching outside files', async () => {
  const repo = await makeGitRepoWithStory('story-gate-check');
  const outside = await mkdtemp(path.join(os.tmpdir(), 'vibepro-gate-check-outside-'));
  const sentinel = path.join(outside, 'sentinel.txt');
  await writeFile(sentinel, 'outside-authority\n');
  await symlink(outside, path.join(repo, 'linked'), 'dir');

  const configPath = path.join(repo, '.vibepro', 'config.json');
  const config = await readJson(configPath);
  config.artifact_routing = {
    artifacts: {
      pr: { canonical: 'linked/pr/{story_id}/pr-prepare.json' },
      gate: { canonical: 'linked/gate/{story_id}/gate-dag.json' }
    }
  };
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);

  const result = await runCli(['gate', 'check', repo, '--story-id', 'story-gate-check', '--base', 'main', '--json']);

  assert.equal(result.exitCode, 1);
  assert.equal(result.result.status, 'error');
  assert.match(result.result.error, /repository root|travers/i);
  assert.equal(await readFile(sentinel, 'utf8'), 'outside-authority\n');
});

test('gate check reports a clean error for a nonexistent story id', async () => {
  const repo = await makeGitRepoWithStory('story-gate-check');

  const result = await runCli(['gate', 'check', repo, '--story-id', 'story-does-not-exist', '--base', 'main', '--json']);

  assert.equal(result.exitCode, 1);
  assert.equal(result.result.status, 'error');
  assert.match(result.result.error, /story-does-not-exist/i);
});

test('gate check without --story-id evaluates repo-level readiness like checkpoint', async () => {
  const repo = await makeGitRepoWithStory('story-gate-check');

  const result = await runCli(['gate', 'check', repo, '--base', 'main', '--json']);

  assert.ok(result.exitCode === 0 || result.exitCode === 1);
  assert.equal(result.result.story_id, 'story-gate-check');
});

test('gate check narrows unresolved gates as story evidence is added, converging toward pass', async () => {
  const repo = await makeGitRepoWithStory('story-gate-check');
  await mkdir(path.join(repo, 'docs', 'management', 'stories', 'active'), { recursive: true });
  await mkdir(path.join(repo, 'docs', 'architecture'), { recursive: true });
  await writeFile(path.join(repo, 'docs', 'management', 'stories', 'active', 'story-gate-check.md'), `---
story_id: story-gate-check
title: Gate Check
architecture_docs:
  reason: CLI-only utility change
---

# Gate Check
`);
  await writeInferredSpec(repo, 'story-gate-check', {
    schema_version: '0.1.0',
    story_id: 'story-gate-check',
    generated_at: '2026-06-03T00:00:00.000Z',
    clauses: [
      {
        id: 'S-001',
        type: 'scenario',
        statement: 'Given the CLI is invoked, when gate check runs, then a normalized report is returned.',
        origin: {
          story_refs: [{ kind: 'acceptance_criteria', index: 0 }]
        }
      }
    ]
  });
  await git(repo, ['add', '.']);
  await git(repo, ['commit', '-m', 'feat: add spec fixture for gate check']);

  const baseline = await makeGitRepoWithStory('story-gate-check-baseline');
  const baselineResult = await runCli(['gate', 'check', baseline, '--story-id', 'story-gate-check-baseline', '--base', 'main', '--json']);

  const result = await runCli(['gate', 'check', repo, '--story-id', 'story-gate-check', '--base', 'main', '--json']);

  assert.ok(result.result.unresolved_gate_count < baselineResult.result.unresolved_gate_count);
  await rm(baseline, { recursive: true, force: true });
});

test('gate check reports exit code 0 when all required gates are satisfied for a story', async () => {
  const repo = await makeGitRepoWithStory('story-gate-check');
  await mkdir(path.join(repo, 'docs', 'management', 'stories', 'active'), { recursive: true });
  await mkdir(path.join(repo, 'docs', 'specs'), { recursive: true });
  // Use a title/body free of route-classification keywords (e.g. "gate",
  // "review", "agent") so this fixture resolves to the low-risk fast lane
  // instead of the "AI Agent Workflow" route, which carries additional
  // required judgment-spine/evidence-lifecycle gates unrelated to what this
  // test is verifying (the wrapper's pass/exit-0 contract).
  await writeFile(path.join(repo, 'docs', 'management', 'stories', 'active', 'story-gate-check.md'), `---
story_id: story-gate-check
title: Docs Only Update
architecture_docs:
  reason: CLI-only utility change
spec_docs:
  - ../../../specs/story-gate-check-spec.md
---

# Docs Only Update

## 受け入れ基準

- ドキュメントのみの変更である
`);
  await writeFile(path.join(repo, 'docs', 'specs', 'story-gate-check-spec.md'), `---
story_id: story-gate-check
title: Docs Only Update Spec
---

# Spec

- \`INV-CGC-1\`: Docs-only change stays documentation only.
`);
  await git(repo, ['add', '.']);
  await git(repo, ['commit', '-m', 'docs: add story doc and spec']);

  const decision = await runCli([
    'decision', 'record', repo,
    '--id', 'story-gate-check',
    '--type', 'waiver',
    '--summary', 'public contract blocker is temporarily waived with owner signoff',
    '--source', 'gate:judgment_axis_public_contract',
    '--reason', 'docs-only change; no public contract impact; follow-up tracked',
    '--artifact', 'docs/management/stories/active/story-gate-check.md',
    '--status', 'accepted',
    '--json'
  ]);
  assert.equal(decision.exitCode, 0);

  const adjudication = await runCli([
    'adjudicate', 'record', repo,
    '--id', 'story-gate-check',
    '--clause', 'AC-1',
    '--verdict', 'demonstrated',
    '--reason', 'docs-only fixture: the changed files are documentation only, which directly demonstrates the clause',
    '--agent-system', 'claude_code',
    '--agent-id', 'fixture-adjudicator',
    '--json'
  ]);
  assert.equal(adjudication.exitCode, 0);

  const verification = await runCli([
    'verify', 'record', repo,
    '--id', 'story-gate-check',
    '--kind', 'integration',
    '--status', 'pass',
    '--command', 'node --test test/vibepro-gate-check.test.js',
    '--summary', 'AC-1 docs-only contract is demonstrated by the committed fixture',
    '--target', 'docs/management/stories/active/story-gate-check.md',
    '--scenario', 'AC-1: ドキュメントのみの変更である',
    '--observed', 'changed_surface=story_and_spec_docs_only',
    '--json'
  ]);
  assert.equal(verification.exitCode, 0, JSON.stringify(verification, null, 2));

  const result = await runCli(['gate', 'check', repo, '--story-id', 'story-gate-check', '--base', 'main', '--ci', '--json']);

  assert.equal(result.exitCode, 0, JSON.stringify(result.result, null, 2));
  assert.equal(result.result.status, 'passed');
  assert.equal(result.result.overall_status, 'ready_for_review');
  assert.equal(result.result.ready_for_pr_create, true);
  assert.equal(result.result.unresolved_gate_count, 0);
  assert.equal(result.result.critical_unresolved_gate_count, 0);
  assert.ok(result.result.gates.length > 0);
  assert.ok(result.result.gates.every((gate) => gate.blocking === false));
});
