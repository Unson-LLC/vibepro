import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

test('TAR-INV-003 Task proof cannot bypass atomic authority in pr prepare', async () => {
  const repoRoot = path.resolve(import.meta.dirname, '../..');
  const { NODE_TEST_CONTEXT: _nodeTestContext, ...childEnv } = process.env;
  const criteria = [
    'TAR-S-1からTAR-S-6を満たす',
    'Taskなし・不正Taskはfail-closedを維持する',
    'machine-readable evidenceにTask bindingを残す'
  ];
  const markers = [
    'story-vibepro-task-atomic-repo-control-contract ac:1',
    'story-vibepro-task-atomic-repo-control-contract ac:2',
    'story-vibepro-task-atomic-repo-control-contract ac:3'
  ];
  const { stdout, stderr } = await execFileAsync(process.execPath, [
    '--test',
    '--test-name-pattern=TAR-CLI-00[1-5]',
    'test/vibepro-cli.test.js'
  ], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: childEnv,
    maxBuffer: 10 * 1024 * 1024
  });

  assert.match(stdout, /TAR-CLI-001/, `${markers[0]} ${criteria[0]}`);
  assert.match(stdout, /TAR-CLI-002/, `${markers[1]} ${criteria[1]}`);
  assert.match(stdout, /TAR-CLI-001/, `${markers[2]} ${criteria[2]}`);
  assert.match(stdout, /pass 5/);
  assert.equal(stderr, '');
});
