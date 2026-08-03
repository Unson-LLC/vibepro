import './support/scratch-tmpdir.js';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const testDir = path.join(repoRoot, 'test');
const helperPath = path.join(repoRoot, 'test/support/scratch-tmpdir.js');
const helperUrl = pathToFileURL(helperPath).href;

function walkTestFiles(dir) {
  const results = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkTestFiles(entryPath));
    } else if (entry.isFile() && /\.(test|spec)\.[cm]?[jt]sx?$/.test(entry.name)) {
      results.push(entryPath);
    }
  }
  return results;
}

test('GATE conformance: every test/**/*.{test,spec}.{js,ts,jsx,tsx,cjs,mjs} file that calls mkdtemp/mkdtempSync or tmpdir()/os.tmpdir() imports the scratch-tmpdir helper', () => {
  const offenders = [];
  for (const filePath of walkTestFiles(testDir)) {
    if (filePath === path.join(repoRoot, 'test/support/scratch-tmpdir.js')) {
      continue;
    }
    const source = readFileSync(filePath, 'utf8');
    if (/\bmkdtemp(?:Sync)?\s*\(|\btmpdir\s*\(/.test(source) && !source.includes('support/scratch-tmpdir.js')) {
      offenders.push(path.relative(repoRoot, filePath));
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `The following test files use mkdtemp/os.tmpdir() without importing test/support/scratch-tmpdir.js: ${offenders.join(', ')}`,
  );
});

test('GATE behavioral: importing the helper redirects mkdtemp(os.tmpdir()) into a private scratch root that is removed on exit', async () => {
  const script = `
    import { mkdtemp } from 'node:fs/promises';
    import os from 'node:os';
    import path from 'node:path';
    import { scratchRoot } from '${helperUrl}';

    const created = await mkdtemp(path.join(os.tmpdir(), 'leak-check-'));
    process.stdout.write(JSON.stringify({ created, scratchRoot }));
  `;
  const { stdout } = await execFileAsync(process.execPath, ['--input-type=module', '-e', script]);
  const { created, scratchRoot } = JSON.parse(stdout.trim());

  const realTmpDir = os.tmpdir();
  const scratchDirName = path.basename(scratchRoot);
  assert.match(scratchDirName, /^vibepro-scratch-/);
  assert.equal(path.dirname(scratchRoot), realTmpDir);
  assert.ok(
    created.startsWith(scratchRoot + path.sep) || created === scratchRoot,
    `expected mkdtemp result ${created} to be created inside scratch root ${scratchRoot}`,
  );

  assert.equal(
    statSyncSafe(scratchRoot),
    false,
    `expected scratch root ${scratchRoot} to be removed after child process exit`,
  );
});

test('GATE behavioral: the self-healing sweep removes stale vibepro-scratch-* directories on import', async () => {
  const realTmpDir = os.tmpdir();
  const staleDir = mkdtempSync(path.join(realTmpDir, 'vibepro-scratch-stale-test-'));
  mkdirSync(path.join(staleDir, 'nested'), { recursive: true });
  writeFileSync(path.join(staleDir, 'nested', 'marker.txt'), 'stale');

  const twentyFiveHoursAgo = new Date(Date.now() - 25 * 60 * 60 * 1000);
  utimesSync(staleDir, twentyFiveHoursAgo, twentyFiveHoursAgo);

  try {
    const script = `
      import '${helperUrl}';
      process.stdout.write('ok');
    `;
    await execFileAsync(process.execPath, ['--input-type=module', '-e', script]);

    assert.equal(
      statSyncSafe(staleDir),
      false,
      `expected stale scratch dir ${staleDir} to be swept away by the self-healing sweep`,
    );
  } finally {
    try {
      rmSync(staleDir, { recursive: true, force: true });
    } catch {
      // Already removed by the sweep, or never existed; ignore.
    }
  }
});

function statSyncSafe(target) {
  try {
    statSync(target);
    return true;
  } catch {
    return false;
  }
}
