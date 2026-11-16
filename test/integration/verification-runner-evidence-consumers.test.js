import '../support/scratch-tmpdir.js';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

import { runCli } from '../../src/cli.js';

const execFileAsync = promisify(execFile);
const STORY_ID = 'story-test-runner-consumers';

// The runner adds fields to verification-evidence.json, which several existing consumers
// read. This exercises that seam end to end: a real command execution on one side, the
// unchanged consumers on the other, so an additive field cannot quietly break them.
async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vibepro-runner-consumers-'));
  await mkdir(path.join(root, 'tests'), { recursive: true });
  await writeFile(path.join(root, 'tests', 'subject.test.js'), `import test from 'node:test';
import assert from 'node:assert/strict';
test('subject holds', () => assert.equal(1, 1));
`);
  await execFileAsync('git', ['init', '-b', 'main'], { cwd: root });
  await execFileAsync('git', ['config', 'user.email', 'vibepro@example.com'], { cwd: root });
  await execFileAsync('git', ['config', 'user.name', 'VibePro Test'], { cwd: root });
  await runCli(['init', root, '--story-id', STORY_ID, '--title', 'Runner evidence consumers']);
  await execFileAsync('git', ['add', '.'], { cwd: root });
  await execFileAsync('git', ['commit', '-m', 'init'], { cwd: root });
  return root;
}

async function readEvidence(root) {
  return JSON.parse(await readFile(path.join(root, '.vibepro', 'pr', STORY_ID, 'verification-evidence.json'), 'utf8'));
}

test('a failing runner-direct run is recorded as failing and is not reported as a passing claim', async () => {
  const root = await fixture();
  await writeFile(path.join(root, 'tests', 'subject.test.js'), `import test from 'node:test';
import assert from 'node:assert/strict';
test('subject breaks', () => assert.equal(1, 2));
`);
  // negative_path: the same command shape, an outcome the agent cannot talk out of.
  const result = await runCli([
    'verify', 'run', root, '--id', STORY_ID, '--kind', 'unit',
    '--target', 'tests/subject.test.js',
    '--scenario', 'negative_path: a failing command is recorded as failing',
    '--', 'node', '--test', 'tests/subject.test.js'
  ]);
  assert.equal(result.exitCode, 1);
  const record = (await readEvidence(root)).commands.find((item) => item.kind === 'unit');
  assert.equal(record.status, 'fail');
  assert.equal(record.observation.values.fail, '1');
  assert.equal(record.evidence_source, 'runner_direct');
});

