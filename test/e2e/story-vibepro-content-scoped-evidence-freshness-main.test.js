import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const childEnv = { ...process.env };
delete childEnv.NODE_TEST_CONTEXT;

test('story-vibepro-content-scoped-evidence-freshness executes AC-1 through AC-9 behavior', async () => {
  const { stdout, stderr } = await execFileAsync(process.execPath, [
    '--test',
    'test/content-scoped-evidence-freshness.test.js',
    'test/review-inspection-first.test.js'
  ], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: childEnv,
    maxBuffer: 10 * 1024 * 1024
  });

  assert.doesNotMatch(stderr, /not ok|Warning:/);
  assert.match(stdout, /CEF-S-1\/2\/5 verification evidence stays current/);
  assert.match(stdout, /CEF-S-3 review evidence uses inspected input content binding/);
  assert.match(stdout, /CEF-S-4 strict HEAD binding still invalidates/);
  assert.match(stdout, /high-risk gate roles strict by default/);
  assert.match(stdout, /global strict HEAD default is rejected/);
  assert.match(stdout, /without inspection flags rejects gate_evidence pass/);
  assert.match(stdout, /rejects generated workspace artifacts as the only inspection input/);
  assert.match(stdout, /preserving inspected files/);
  assert.match(stdout, /fail 0/);
});
