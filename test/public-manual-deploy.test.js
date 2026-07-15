import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  resolveCleanSourceCommit,
  wranglerPagesArguments
} from '../scripts/deploy-public-manual.mjs';

test('public manual deployment rejects a dirty worktree before Wrangler', async (t) => {
  const repo = await mkdtemp(path.join(os.tmpdir(), 'vibepro-public-deploy-'));
  t.after(() => rm(repo, { recursive: true, force: true }));
  execFileSync('git', ['init', '-q'], { cwd: repo });
  execFileSync('git', ['config', 'user.email', 'vibepro-test@example.invalid'], { cwd: repo });
  execFileSync('git', ['config', 'user.name', 'VibePro Test'], { cwd: repo });
  await writeFile(path.join(repo, 'manual.md'), 'clean\n');
  execFileSync('git', ['add', 'manual.md'], { cwd: repo });
  execFileSync('git', ['commit', '-qm', 'test fixture'], { cwd: repo });

  const commitHash = resolveCleanSourceCommit(repo);
  assert.match(commitHash, /^[0-9a-f]{40}$/u);
  assert.deepEqual(wranglerPagesArguments(commitHash).slice(-3), [
    '--commit-hash',
    commitHash,
    '--commit-dirty=false'
  ]);

  await writeFile(path.join(repo, 'manual.md'), 'dirty\n');
  assert.throws(
    () => resolveCleanSourceCommit(repo),
    /requires a clean git worktree/
  );
});

test('public manual deployment rejects untracked source files before Wrangler', async (t) => {
  const repo = await mkdtemp(path.join(os.tmpdir(), 'vibepro-public-deploy-untracked-'));
  t.after(() => rm(repo, { recursive: true, force: true }));
  execFileSync('git', ['init', '-q'], { cwd: repo });
  execFileSync('git', ['config', 'user.email', 'vibepro-test@example.invalid'], { cwd: repo });
  execFileSync('git', ['config', 'user.name', 'VibePro Test'], { cwd: repo });
  await writeFile(path.join(repo, 'manual.md'), 'clean\n');
  execFileSync('git', ['add', 'manual.md'], { cwd: repo });
  execFileSync('git', ['commit', '-qm', 'test fixture'], { cwd: repo });

  await writeFile(path.join(repo, 'untracked-manual.md'), 'not committed\n');
  assert.throws(
    () => resolveCleanSourceCommit(repo),
    /requires a clean git worktree/
  );
});
