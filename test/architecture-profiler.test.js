import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { promisify } from 'node:util';

import { profileArchitecture } from '../src/architecture-profiler.js';

const execFileAsync = promisify(execFile);
const PROFILER_MODULE = fileURLToPath(new URL('../src/architecture-profiler.js', import.meta.url));

async function makeWideRepo(fileCount) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vibepro-profiler-'));
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

test('profileArchitecture walks nested directories and honors ignore/size rules', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vibepro-profiler-'));
  await mkdir(path.join(root, 'src', 'nested', 'deep'), { recursive: true });
  await mkdir(path.join(root, 'node_modules', 'pkg'), { recursive: true });
  await writeFile(path.join(root, 'package.json'), JSON.stringify({ dependencies: { next: '15.0.0' } }));
  await writeFile(path.join(root, 'src', 'nested', 'deep', 'module.ts'), 'export const x = 1;');
  await writeFile(path.join(root, 'node_modules', 'pkg', 'index.js'), 'ignored');
  await writeFile(path.join(root, 'huge.bin'), Buffer.alloc(1024 * 1024 + 1));

  const profile = await profileArchitecture(root);

  assert.ok(profile.frameworks.includes('nextjs'));
  assert.ok(profile.languages.includes('typescript'));
});

test('profileArchitecture survives a subtree larger than the spread-argument limit', async () => {
  // Regression for "Maximum call stack size exceeded" in story diagnose:
  // the old recursive walker spread each subtree's result into push(), which
  // throws once one directory subtree accumulates more entries than V8 accepts
  // as call arguments. --stack-size=200 shrinks that limit so 30k files
  // reproduce the failure that needed ~127k files at the default stack size.
  const fileCount = 30000;
  const root = await makeWideRepo(fileCount);
  const script = `
import { profileArchitecture } from ${JSON.stringify(PROFILER_MODULE)};
const profile = await profileArchitecture(${JSON.stringify(root)});
if (!profile || typeof profile !== 'object') throw new Error('profile missing');
process.stdout.write('profiled');
`;
  const { stdout } = await execFileAsync(
    process.execPath,
    ['--stack-size=200', '--input-type=module', '--eval', script],
    { timeout: 120000 }
  );
  assert.equal(stdout, 'profiled');
});
