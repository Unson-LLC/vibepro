import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const storyId = 'story-vibepro-review-replacement-recovery';
const expectedNestedTests = [
  'delivery efficiency manual shutdown requires fresh authorization and latest replacement lineage',
  'unknown or missing close reason never infers a collected result',
  'completed and terminal close reasons preserve correction and replacement boundaries',
  'terminal review close reasons require explicit latest-lineage replacement',
  'review status authorizes before terminal replacement and only emits actions for the latest lifecycle per role',
  'emitted repair chain executes with one replacement lifecycle identity',
  'review repair replaces every already-closed terminal lifecycle without closing it again',
  'pr prepare routes every already-closed terminal lifecycle through replacement recovery'
];

test('VRR-E2E-001 replays terminal replacement and fail-closed recovery artifacts', async () => {
  const { NODE_TEST_CONTEXT: _nodeTestContext, ...childEnv } = process.env;
  const patterns = expectedNestedTests.join('|');
  const { stdout, stderr } = await execFileAsync(
    process.execPath,
    [
      '--test',
      '--test-concurrency=1',
      `--test-name-pattern=${patterns}`,
      'test/review-inspection-first.test.js',
      'test/review-repair.test.js',
      'test/vibepro-cli.test.js'
    ],
    {
      cwd: repoRoot,
      env: childEnv,
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024
    }
  );
  const tap = `${stdout}\n${stderr}`;

  for (const nestedTest of expectedNestedTests) {
    assert.match(tap, new RegExp(nestedTest), `${storyId} must execute ${nestedTest}`);
  }
  assert.match(
    tap,
    /delivery efficiency manual shutdown requires fresh authorization and latest replacement lineage/,
    `${storyId} S-001 ac:1 ac:2 ac:3 ac:4 ac:5 ac:7 ac:8 flow replay must bind authorization and replacement lineage`
  );
  assert.match(
    tap,
    /unknown or missing close reason never infers a collected result/,
    `${storyId} S-002 ac:1 ac:2 ac:3 ac:5 ac:6 ac:8 negative path must fail closed`
  );
  assert.match(
    tap,
    /emitted repair chain executes with one replacement lifecycle identity/,
    `${storyId} ac:7 artifact replay must preserve one lifecycle identity`
  );
  assert.doesNotMatch(tap, /not ok \d+ - (?:VRR|delivery efficiency|unknown or missing|completed and terminal|terminal review|review status authorizes|emitted repair|review repair replaces|pr prepare routes)/);
});
