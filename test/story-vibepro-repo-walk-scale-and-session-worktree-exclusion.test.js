import './support/scratch-tmpdir.js';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { promisify } from 'node:util';

import { walkFiles } from '../src/pr-manager.js';

const STORY_ID = 'story-vibepro-repo-walk-scale-and-session-worktree-exclusion';
const execFileAsync = promisify(execFile);
const PR_MANAGER_MODULE = fileURLToPath(new URL('../src/pr-manager.js', import.meta.url));

async function makeWideDir(fileCount) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vibepro-walkfiles-'));
  const wideDir = path.join(root, 'generated');
  await mkdir(wideDir, { recursive: true });
  let batch = [];
  for (let index = 0; index < fileCount; index += 1) {
    batch.push(writeFile(path.join(wideDir, `entry-${index}.js`), ''));
    if (batch.length === 500) {
      await Promise.all(batch);
      batch = [];
    }
  }
  await Promise.all(batch);
  return root;
}

// ${STORY_ID} ac:RWS-S-2
// Regression for the same "Maximum call stack size exceeded" class PR #409 fixed for the
// other 8 walkers: the old recursive walkFiles in src/pr-manager.js spread each subtree's
// result into push(), which throws once a subtree accumulates more entries than V8 accepts
// as call arguments. --stack-size=200 shrinks that limit so 30k files reproduce the failure
// that needed ~127k files at the default stack size. Assert the full file count, not just
// that it did not throw, so a walker that silently drops entries would still fail this test.
test(`${STORY_ID} walkFiles survives a subtree larger than the spread-argument limit and returns the full count`, async () => {
  const fileCount = 30000;
  const root = await makeWideDir(fileCount);
  const script = `
import { walkFiles } from ${JSON.stringify(PR_MANAGER_MODULE)};
const files = await walkFiles(${JSON.stringify(root)});
process.stdout.write(String(files.length));
`;
  const { stdout } = await execFileAsync(
    process.execPath,
    ['--stack-size=200', '--input-type=module', '--eval', script],
    { timeout: 120000 }
  );
  assert.equal(Number(stdout), fileCount);
});

// ${STORY_ID} ac:RWS-S-3
// walkFiles' external contract must not change when its implementation moves from
// recursion+spread to an explicit queue: flat array of absolute paths including files
// nested at any depth, and a missing directory yields [] rather than throwing.
test(`${STORY_ID} walkFiles returns nested files as absolute paths and treats a missing directory as empty`, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vibepro-walkfiles-contract-'));
  await mkdir(path.join(root, 'a', 'b', 'c'), { recursive: true });
  await writeFile(path.join(root, 'top.txt'), 'top');
  await writeFile(path.join(root, 'a', 'mid.txt'), 'mid');
  await writeFile(path.join(root, 'a', 'b', 'c', 'deep.txt'), 'deep');

  const files = await walkFiles(root);

  assert.equal(files.length, 3);
  for (const file of files) {
    assert.ok(path.isAbsolute(file), `expected absolute path, got ${file}`);
  }
  const relative = files.map((file) => path.relative(root, file)).sort();
  assert.deepEqual(relative, [
    path.join('a', 'b', 'c', 'deep.txt'),
    path.join('a', 'mid.txt'),
    'top.txt'
  ].sort());

  const missing = await walkFiles(path.join(root, 'does-not-exist'));
  assert.deepEqual(missing, []);
});

// ${STORY_ID} ac:RWS-S-3
// The pre-existing walker tolerated ENOENT at every recursion level, not just for the root
// directory, so a subdirectory that vanishes mid-walk was skipped rather than failing the
// whole walk. The iterative rewrite must preserve that per-directory tolerance, while still
// propagating non-ENOENT errors (e.g. ENOTDIR from treating a file as a directory).
test(`${STORY_ID} walkFiles propagates non-ENOENT errors instead of swallowing them`, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vibepro-walkfiles-enotdir-'));
  const notADir = path.join(root, 'not-a-dir');
  await writeFile(notADir, 'this is a file, not a directory');

  await assert.rejects(
    () => walkFiles(notADir),
    (error) => error && error.code !== 'ENOENT'
  );
});
