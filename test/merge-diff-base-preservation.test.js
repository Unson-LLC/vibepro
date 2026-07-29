import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

import { collectMergeDiffLineStats } from '../src/merge-manager.js';
import { buildCanonicalEvidenceCostSummary } from '../src/evidence-cost-budget.js';

const run = promisify(execFile);

async function git(cwd, ...args) {
  const { stdout } = await run('git', args, { cwd });
  return stdout.trim();
}

// Builds a repository in the state `execute merge` observes when the PR has
// already landed: `origin/main` contains the branch head, so the pre-merge base
// is no longer reachable through the base branch.
async function buildMergedRepo({ squash = false } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vibepro-diff-base-'));
  await git(root, 'init', '--initial-branch=main');
  await git(root, 'config', 'user.email', 'test@example.com');
  await git(root, 'config', 'user.name', 'VibePro Test');

  await mkdir(path.join(root, 'src'), { recursive: true });
  await writeFile(path.join(root, 'src', 'app.js'), 'export const value = 1;\n');
  await git(root, 'add', '.');
  await git(root, 'commit', '-m', 'base');
  const forkPoint = await git(root, 'rev-parse', 'HEAD');

  await git(root, 'checkout', '-b', 'feature');
  await writeFile(path.join(root, 'src', 'app.js'), 'export const value = 1;\nexport const added = 2;\n');
  await mkdir(path.join(root, 'docs'), { recursive: true });
  await writeFile(path.join(root, 'docs', 'story.md'), 'story\ncontent\n');
  await git(root, 'add', '.');
  await git(root, 'commit', '-m', 'feature work');
  const headSha = await git(root, 'rev-parse', 'HEAD');

  await git(root, 'checkout', 'main');
  if (squash) {
    await git(root, 'merge', '--squash', 'feature');
    await git(root, 'commit', '-m', 'squashed feature');
  } else {
    await git(root, 'merge', '--no-ff', 'feature', '-m', 'Merge pull request #1');
  }
  const mergeCommitSha = await git(root, 'rev-parse', 'HEAD');
  // `origin/main` is what `execute merge` compares against, and after the merge
  // it contains the branch head.
  await git(root, 'update-ref', 'refs/remotes/origin/main', mergeCommitSha);

  return { root, headSha, mergeCommitSha, forkPoint };
}

test('DOE-S-3 refuses to report a post-merge base as an available zero-line diff', async (t) => {
  const { root, headSha } = await buildMergedRepo();
  t.after(() => rm(root, { recursive: true, force: true }));

  const collected = await collectMergeDiffLineStats(root, {
    baseBranch: 'main',
    currentHeadSha: headSha,
    pr: { base_ref_name: 'main', head_ref_oid: headSha }
  });

  assert.equal(collected.diff_stats.status, 'unavailable');
  assert.equal(collected.diff_line_stats, null);
  assert.equal(collected.diff_stats.refs.base_authority, 'unresolved');
  assert.match(collected.diff_stats.reason, /already contains/);
});

test('DOE-S-3 recovers the pre-merge base from the merge commit first parent', async (t) => {
  const { root, headSha, mergeCommitSha, forkPoint } = await buildMergedRepo();
  t.after(() => rm(root, { recursive: true, force: true }));

  const collected = await collectMergeDiffLineStats(root, {
    baseBranch: 'main',
    currentHeadSha: headSha,
    pr: { base_ref_name: 'main', head_ref_oid: headSha },
    mergeCommitSha
  });

  assert.equal(collected.diff_stats.status, 'available');
  assert.equal(collected.diff_stats.refs.base_authority, 'merge_commit_first_parent');
  assert.equal(collected.diff_stats.refs.base_sha, forkPoint);
  assert.equal(collected.diff_stats.refs.merge_commit_sha, mergeCommitSha);
  assert.deepEqual(Object.keys(collected.diff_line_stats).sort(), ['docs/story.md', 'src/app.js']);
  assert.equal(collected.diff_line_stats['src/app.js'].additions, 1);
});

test('DOE-S-3 recovers the pre-merge base after a squash merge', async (t) => {
  const { root, headSha, mergeCommitSha, forkPoint } = await buildMergedRepo({ squash: true });
  t.after(() => rm(root, { recursive: true, force: true }));

  const collected = await collectMergeDiffLineStats(root, {
    baseBranch: 'main',
    currentHeadSha: headSha,
    pr: { base_ref_name: 'main', head_ref_oid: headSha },
    mergeCommitSha
  });

  assert.equal(collected.diff_stats.status, 'available');
  assert.equal(collected.diff_stats.refs.base_authority, 'merge_commit_first_parent');
  assert.equal(collected.diff_stats.refs.base_sha, forkPoint);
  assert.equal(collected.diff_line_stats['src/app.js'].additions, 1);
});

test('DOE-S-3 still measures against the base branch before the merge lands', async (t) => {
  const { root, headSha, forkPoint } = await buildMergedRepo();
  t.after(() => rm(root, { recursive: true, force: true }));
  // Rewind the remote-tracking ref to the pre-merge state.
  await git(root, 'update-ref', 'refs/remotes/origin/main', forkPoint);

  const collected = await collectMergeDiffLineStats(root, {
    baseBranch: 'main',
    currentHeadSha: headSha,
    pr: { base_ref_name: 'main', head_ref_oid: headSha }
  });

  assert.equal(collected.diff_stats.status, 'available');
  assert.equal(collected.diff_stats.refs.base_authority, 'base_branch');
  assert.equal(collected.diff_line_stats['src/app.js'].additions, 1);
});

test('DOE-S-3 an unrecoverable diff base never becomes product_changed_lines: 0', async (t) => {
  const { root, headSha } = await buildMergedRepo();
  t.after(() => rm(root, { recursive: true, force: true }));

  const collected = await collectMergeDiffLineStats(root, {
    baseBranch: 'main',
    currentHeadSha: headSha,
    pr: { base_ref_name: 'main', head_ref_oid: headSha }
  });
  const cost = buildCanonicalEvidenceCostSummary({
    artifactLineCount: 3606,
    diffStats: collected.diff_line_stats,
    diffStatsProvenance: collected.diff_stats
  });

  assert.equal(cost.product_changed_lines, null);
  assert.notEqual(cost.product_changed_lines, 0);
  assert.equal(cost.product_changed_lines_status, 'unavailable');
  assert.equal(cost.change_surface.status, 'unknown');
  assert.equal(cost.budget_scope, 'implementation');
});
