import { execFile } from 'node:child_process';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { promisify } from 'node:util';

import { runCli } from '../src/cli.js';
import { collectWorkspaceStatus, parseWorktreePorcelain, renderWorkspaceStatus } from '../src/workspace-status.js';

const execFileAsync = promisify(execFile);

async function git(repo, args) {
  return execFileAsync('git', args, { cwd: repo, encoding: 'utf8' });
}

async function writeArtifact(worktree, storyId, artifact) {
  const dir = path.join(worktree, '.vibepro', 'pr', storyId);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, 'pr-prepare.json'), JSON.stringify(artifact));
}

test('parseWorktreePorcelain preserves branch and detached state', () => {
  const parsed = parseWorktreePorcelain('worktree /repo\nHEAD abc\nbranch refs/heads/main\n\nworktree /repo/wt\nHEAD def\ndetached\n');
  assert.deepEqual(parsed, [
    { path: '/repo', head_sha: 'abc', branch: 'main' },
    { path: '/repo/wt', head_sha: 'def', detached: true }
  ]);

  const nulParsed = parseWorktreePorcelain('worktree /repo/日本語\0HEAD abc\0branch refs/heads/main\0\0');
  assert.deepEqual(nulParsed, [
    { path: '/repo/日本語', head_sha: 'abc', branch: 'main' }
  ]);
});

test('workspace status derives readiness per worktree without trusting canonical health', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'vibepro-workspace-status-'));
  const linked = path.join(root, 'linked-日本語');
  const emptyLinked = path.join(root, 'empty-linked');
  const prunable = path.join(root, 'prunable-linked');
  await git(root, ['init', '-b', 'main']);
  await git(root, ['config', 'user.email', 'test@example.com']);
  await git(root, ['config', 'user.name', 'Test']);
  await writeFile(path.join(root, 'README.md'), 'initial\n');
  await git(root, ['add', 'README.md']);
  await git(root, ['commit', '-m', 'initial']);
  const oldHead = (await git(root, ['rev-parse', 'HEAD'])).stdout.trim();
  await git(root, ['worktree', 'add', '-b', 'feature/ready', linked]);
  await writeFile(path.join(linked, 'feature.txt'), 'ready\n');
  await git(linked, ['add', 'feature.txt']);
  await git(linked, ['commit', '-m', 'feature']);
  const linkedHead = (await git(linked, ['rev-parse', 'HEAD'])).stdout.trim();
  await git(root, ['worktree', 'add', '-b', 'feature/empty', emptyLinked]);
  await git(root, ['worktree', 'add', '-b', 'feature/prunable', prunable]);
  await rm(prunable, { recursive: true, force: true });

  await writeArtifact(linked, 'story-ready', {
    story: { story_id: 'story-ready', title: 'Ready' },
    gate_status: { overall_status: 'ready_for_review', ready_for_pr_create: true },
    artifact_freshness: { artifact_head_sha: linkedHead }
  });
  await writeArtifact(linked, 'story-stale', {
    story: { story_id: 'story-stale' },
    gate_status: { overall_status: 'ready_for_review', ready_for_pr_create: true },
    artifact_freshness: { artifact_head_sha: oldHead }
  });
  await writeArtifact(linked, 'story-missing-head', {
    story: { story_id: 'story-missing-head' },
    gate_status: { overall_status: 'ready_for_review', ready_for_pr_create: true }
  });
  await writeArtifact(linked, 'story-blocked', {
    story: { story_id: 'story-blocked' },
    gate_status: { overall_status: 'needs_verification', ready_for_pr_create: false },
    artifact_freshness: { artifact_head_sha: linkedHead }
  });
  await writeArtifact(linked, 'story-inconsistent', {
    story: { story_id: 'story-inconsistent' },
    gate_status: { overall_status: 'needs_verification', ready_for_pr_create: true },
    artifact_freshness: { artifact_head_sha: linkedHead }
  });
  const malformedDir = path.join(linked, '.vibepro', 'pr', 'story-malformed');
  await mkdir(malformedDir, { recursive: true });
  await writeFile(path.join(malformedDir, 'pr-prepare.json'), '{not json');

  await writeFile(path.join(root, 'canonical-dirty.txt'), 'dirty\n');
  const before = (await git(root, ['status', '--porcelain'])).stdout;
  const result = await collectWorkspaceStatus(linked);
  const after = (await git(root, ['status', '--porcelain'])).stdout;

  assert.equal(after, before, 'derive-only status must not change repository state');
  assert.equal(result.repository.canonical_worktree, await realpath(root));
  const canonical = result.worktrees.find((worktree) => worktree.is_canonical);
  const linkedRealpath = await realpath(linked);
  const feature = result.worktrees.find((worktree) => worktree.path === linkedRealpath);
  assert.equal(canonical.dirty, true);
  assert.deepEqual(canonical.stories, []);
  assert.equal(feature.stories.find((story) => story.story_id === 'story-ready').status, 'active_ready');
  assert.equal(feature.stories.find((story) => story.story_id === 'story-stale').status, 'stale_artifact');
  assert.equal(feature.stories.find((story) => story.story_id === 'story-missing-head').status, 'stale_artifact');
  assert.equal(feature.stories.find((story) => story.story_id === 'story-blocked').status, 'active_blocked');
  assert.equal(feature.stories.find((story) => story.story_id === 'story-inconsistent').status, 'active_blocked');
  assert.equal(feature.stories.find((story) => story.story_id === 'story-inconsistent').reason, 'overall_status_not_ready');
  assert.equal(feature.stories.find((story) => story.story_id === 'story-malformed').status, 'unknown');
  const empty = result.worktrees.find((worktree) => worktree.branch === 'feature/empty');
  const missing = result.worktrees.find((worktree) => worktree.branch === 'feature/prunable');
  assert.equal(empty.stories[0].reason, 'no_pr_prepare_artifact');
  assert.equal(missing.available, false);
  assert.equal(missing.stories[0].reason, 'prunable_worktree');
  assert.deepEqual(result.summary.story_status_counts, {
    active_ready: 1,
    active_blocked: 2,
    stale_artifact: 2,
    unknown: 3
  });

  const human = renderWorkspaceStatus(result);
  assert.match(human, /active_ready: story-ready/);
  assert.match(human, /unknown: \(no story\) \(prunable_worktree\)/);

  let stdout = '';
  await runCli(['workspace', 'status', linked, '--json'], {
    stdout: { write: (chunk) => { stdout += chunk; } },
    stderr: { write: () => {} }
  });
  const cliResult = JSON.parse(stdout);
  assert.equal(cliResult.schema_version, '0.1.0');
  assert.equal(cliResult.summary.worktree_count, 4);
  assert.equal(cliResult.worktrees.find((worktree) => worktree.branch === 'feature/prunable').stories[0].status, 'unknown');
});
