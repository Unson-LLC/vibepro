import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { access, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

import { runCli } from '../src/cli.js';
import { buildTraceability } from '../src/traceability.js';

const execFileAsync = promisify(execFile);

async function git(repo, args) {
  return execFileAsync('git', args, { cwd: repo, encoding: 'utf8' });
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'));
}

async function fileExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function storyDoc(storyId, status) {
  return `---\nstory_id: ${storyId}\ntitle: ${storyId}\nstatus: ${status}\n---\n\n# ${storyId}\n`;
}

test('buildTraceability replaces generated PR verification evidence instead of keeping stale rows', () => {
  const traceability = buildTraceability({
    evidence: [
      {
        type: 'verification_evidence',
        ref: 'old-test',
        binding_status: 'current',
        current_head_sha: 'old-head'
      },
      {
        type: 'git_log',
        ref: 'abc123',
        summary: 'historical merge evidence'
      }
    ]
  }, {
    storyId: 'story-traceability-evidence-refresh',
    source: 'pr_prepare',
    lifecycle: 'in_progress',
    evidence: [
      {
        type: 'verification_evidence',
        ref: 'new-test',
        binding_status: 'current',
        current_head_sha: 'new-head'
      }
    ],
    now: '2026-06-25T00:00:00.000Z'
  });

  assert.deepEqual(
    traceability.evidence.filter((item) => item.type === 'verification_evidence').map((item) => item.ref),
    ['new-test']
  );
  assert.equal(
    traceability.evidence.some((item) => item.type === 'git_log' && item.ref === 'abc123'),
    true
  );
});

async function setupBackfillRepo() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vibepro-trace-backfill-'));
  await git(root, ['init', '-b', 'main']);
  await git(root, ['config', 'user.email', 'vibepro@example.com']);
  await git(root, ['config', 'user.name', 'VibePro Test']);
  await runCli(['init', root]);
  const storyDir = path.join(root, 'docs', 'management', 'stories', 'active');
  await mkdir(storyDir, { recursive: true });
  // story-aa-merged: git evidence exists (commit message mentions the story id)
  await writeFile(path.join(storyDir, 'story-aa-merged.md'), storyDoc('story-aa-merged', 'active'));
  // story-bb-backlog: no evidence, explicit backlog status
  await writeFile(path.join(storyDir, 'story-bb-backlog.md'), storyDoc('story-bb-backlog', 'backlog'));
  // story-cc-claims-merged: doc claims merged but no git evidence
  await writeFile(path.join(storyDir, 'story-cc-claims-merged.md'), storyDoc('story-cc-claims-merged', 'merged'));
  // story-dd-has-artifact: already has a real PR artifact
  await writeFile(path.join(storyDir, 'story-dd-has-artifact.md'), storyDoc('story-dd-has-artifact', 'active'));
  // story-ee-active: active status, no evidence anywhere
  await writeFile(path.join(storyDir, 'story-ee-active.md'), storyDoc('story-ee-active', 'active'));
  // story-ff-worktree: artifacts exist only in a linked worktree
  await writeFile(path.join(storyDir, 'story-ff-worktree.md'), storyDoc('story-ff-worktree', 'active'));
  await git(root, ['add', '.']);
  await git(root, ['commit', '-m', 'docs: add story docs']);
  await writeFile(path.join(root, 'feature.txt'), 'feature\n');
  await git(root, ['add', 'feature.txt']);
  await git(root, ['commit', '-m', 'feat: implement story-aa-merged feature']);
  const prDir = path.join(root, '.vibepro', 'pr', 'story-dd-has-artifact');
  await mkdir(prDir, { recursive: true });
  await writeFile(path.join(prDir, 'pr-prepare.json'), JSON.stringify({
    schema_version: '0.1.0',
    created_at: new Date().toISOString(),
    story: { story_id: 'story-dd-has-artifact' }
  }, null, 2));
  const linkedWorktree = await mkdtemp(path.join(os.tmpdir(), 'vibepro-trace-linked-'));
  await execFileAsync('rm', ['-rf', linkedWorktree]);
  await git(root, ['worktree', 'add', '--detach', linkedWorktree, 'HEAD']);
  const linkedPrDir = path.join(linkedWorktree, '.vibepro', 'pr', 'story-ff-worktree');
  await mkdir(linkedPrDir, { recursive: true });
  await writeFile(path.join(linkedPrDir, 'pr-prepare.json'), JSON.stringify({
    schema_version: '0.1.0',
    created_at: new Date().toISOString(),
    story: { story_id: 'story-ff-worktree' }
  }, null, 2));
  return root;
}

test('backfill classifies merged_without_vibepro_evidence with git evidence', async () => {
  const root = await setupBackfillRepo();
  const { result } = await runCli(['trace', 'backfill', root, '--json']);
  const entry = result.candidates.find((item) => item.story_id === 'story-aa-merged');
  assert.ok(entry, 'story-aa-merged must be a backfill candidate');
  assert.equal(entry.lifecycle, 'merged_without_vibepro_evidence');
  assert.ok(entry.evidence.length > 0, 'git evidence must be recorded');
  assert.equal(entry.evidence[0].type, 'git_log');
  assert.ok(entry.evidence[0].ref, 'evidence ref must contain a commit sha');
  const artifact = await readJson(path.join(root, '.vibepro', 'pr', 'story-aa-merged', 'traceability.json'));
  assert.equal(artifact.lifecycle, 'merged_without_vibepro_evidence');
  assert.equal(artifact.source, 'trace_backfill');
  assert.equal(artifact.evidence[0].type, 'git_log');
});

test('backfill classifies declared_not_started without git evidence', async () => {
  const root = await setupBackfillRepo();
  const { result } = await runCli(['trace', 'backfill', root, '--json']);
  const entry = result.candidates.find((item) => item.story_id === 'story-bb-backlog');
  assert.ok(entry, 'story-bb-backlog must be a backfill candidate');
  assert.equal(entry.lifecycle, 'declared_not_started');
  assert.deepEqual(entry.evidence, []);
  const artifact = await readJson(path.join(root, '.vibepro', 'pr', 'story-bb-backlog', 'traceability.json'));
  assert.equal(artifact.lifecycle, 'declared_not_started');
});

test('backfill classifies merged-claimed story without evidence as unknown', async () => {
  const root = await setupBackfillRepo();
  const { result } = await runCli(['trace', 'backfill', root, '--json']);
  const entry = result.candidates.find((item) => item.story_id === 'story-cc-claims-merged');
  assert.ok(entry, 'story-cc-claims-merged must be a backfill candidate');
  assert.equal(entry.lifecycle, 'unknown');
});

test('backfill keeps active story without evidence as unknown instead of claiming not started', async () => {
  const root = await setupBackfillRepo();
  const { result } = await runCli(['trace', 'backfill', root, '--json']);
  const entry = result.candidates.find((item) => item.story_id === 'story-ee-active');
  assert.ok(entry, 'story-ee-active must be a backfill candidate');
  assert.equal(entry.lifecycle, 'unknown');
});

test('backfill classifies evidence_in_other_worktree when artifacts live in a linked worktree', async () => {
  const root = await setupBackfillRepo();
  const { result } = await runCli(['trace', 'backfill', root, '--json']);
  const entry = result.candidates.find((item) => item.story_id === 'story-ff-worktree');
  assert.ok(entry, 'story-ff-worktree must be a backfill candidate');
  assert.equal(entry.lifecycle, 'evidence_in_other_worktree');
  assert.equal(entry.evidence[0].type, 'worktree_artifact');
  assert.match(entry.evidence[0].ref, /story-ff-worktree/);
});

test('trace declare records a manual declaration with provenance', async () => {
  const root = await setupBackfillRepo();
  const { result } = await runCli([
    'trace', 'declare', root,
    '--story-id', 'story-ee-active',
    '--lifecycle', 'declared_not_started',
    '--reason', 'backlog idea, confirmed unstarted by operator',
    '--json'
  ]);
  assert.equal(result.lifecycle, 'declared_not_started');
  assert.equal(result.source, 'manual_declaration');
  const artifact = await readJson(path.join(root, '.vibepro', 'pr', 'story-ee-active', 'traceability.json'));
  assert.equal(artifact.lifecycle, 'declared_not_started');
  assert.equal(artifact.source, 'manual_declaration');
  assert.ok(artifact.evidence.some((item) => item.type === 'manual_declaration' && /operator/.test(item.summary)));
});

test('trace declare rejects lifecycles that require evidence', async () => {
  const root = await setupBackfillRepo();
  const result = await runCli([
    'trace', 'declare', root,
    '--story-id', 'story-ee-active',
    '--lifecycle', 'merged_without_vibepro_evidence',
    '--json'
  ]);
  assert.notEqual(result.exitCode, 0, 'evidence-backed lifecycle must not be manually declarable');
});

test('backfill skips stories that already have real PR artifacts', async () => {
  const root = await setupBackfillRepo();
  const { result } = await runCli(['trace', 'backfill', root, '--json']);
  assert.ok(!result.candidates.some((item) => item.story_id === 'story-dd-has-artifact'));
});

test('dry-run does not write files', async () => {
  const root = await setupBackfillRepo();
  const { result } = await runCli(['trace', 'backfill', root, '--dry-run', '--json']);
  assert.equal(result.dry_run, true);
  assert.ok(result.candidates.length >= 3, 'classification must still be reported');
  assert.equal(
    await fileExists(path.join(root, '.vibepro', 'pr', 'story-aa-merged', 'traceability.json')),
    false,
    'dry-run must not write traceability.json'
  );
});
