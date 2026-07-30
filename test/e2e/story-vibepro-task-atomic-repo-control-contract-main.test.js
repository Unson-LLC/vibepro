import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

test('TAR-INV-003 Task proof cannot bypass atomic authority in pr prepare', async () => {
  const repoRoot = path.resolve(import.meta.dirname, '../..');
  const { NODE_TEST_CONTEXT: _nodeTestContext, ...childEnv } = process.env;
  const { stdout, stderr } = await execFileAsync(process.execPath, [
    '--test',
    '--test-name-pattern=TAR-CLI-001',
    'test/vibepro-cli.test.js'
  ], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: childEnv,
    maxBuffer: 10 * 1024 * 1024
  });

  assert.match(stdout, /TAR-CLI-001/);
  assert.match(stdout, /pass 1/);
  assert.equal(stderr, '');
});
