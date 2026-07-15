import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  assertBuiltSourceCommit,
  deployBuildEnvironment,
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

test('public manual deployment fixes build provenance to the clean HEAD', async (t) => {
  const repo = await mkdtemp(path.join(os.tmpdir(), 'vibepro-public-deploy-provenance-'));
  t.after(() => rm(repo, { recursive: true, force: true }));
  const commitHash = '1234567890abcdef1234567890abcdef12345678';
  const environment = deployBuildEnvironment(commitHash, {
    CF_PAGES_COMMIT_SHA: 'ffffffffffff0000',
    KEEP_ME: 'yes'
  });

  assert.equal(environment.VIBEPRO_SOURCE_COMMIT, '1234567890ab');
  assert.equal(environment.CF_PAGES_COMMIT_SHA, undefined);
  assert.equal(environment.KEEP_ME, 'yes');

  const dist = path.join(repo, 'docs/.vitepress/dist');
  await mkdir(dist, { recursive: true });
  await writeFile(path.join(dist, 'index.html'), '<meta name="vibepro-source-commit" content="1234567890ab">');
  assert.doesNotThrow(() => assertBuiltSourceCommit(repo, commitHash));

  await writeFile(path.join(dist, 'index.html'), '<meta name="vibepro-source-commit" content="ffffffffffff">');
  assert.throws(
    () => assertBuiltSourceCommit(repo, commitHash),
    /source commit mismatch/
  );
});
