import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const REPO_ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const CONTRACT_TESTS = [
  'test/human-decision-checkpoint.test.js',
  'test/guarded-run-session.test.js'
];

test('story-vibepro-human-decision-checkpoint AC-1 through AC-7 and S-001 acceptance replay', async () => {
  const { NODE_TEST_CONTEXT: _nodeTestContext, ...childEnv } = process.env;
  const result = await execFileAsync(process.execPath, ['--test', ...CONTRACT_TESTS], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    env: childEnv,
    maxBuffer: 8 * 1024 * 1024
  });

  assert.match(result.stdout, /# pass [1-9]\d*\b/);
  assert.match(result.stdout, /# fail 0\b/);

  const acceptanceBindings = [
    ['AC-1', /duplicate material questions reuse one typed pending artifact/],
    ['AC-2', /every supported material decision type persists and resolves through one contract/],
    ['AC-3', /waiting Run is side-effect free until the human decision is answered/],
    ['AC-3 resume cursor', /resumed orchestration preserves its cursor across an action failure and restart/],
    ['AC-4', /critical gate waiver is rejected without resolving the artifact/],
    ['AC-5', /Brainbase handoff reference is preserved as an opaque value/],
    ['AC-6', /resolved replay repairs the decision index before Run resume continues/],
    ['AC-6 journal', /answer binds to Run and HEAD and records reflection targets/],
    ['AC-7 duplicate and stale HEAD', /duplicate material reason on a new HEAD creates a new decision/],
    ['AC-7 malformed artifact', /malformed decision JSON fails with a typed error and remains inspectable/],
    ['AC-7 invalid and cancelled Run', /invalid type and cancelled Run are rejected/],
    ['S-001 restart recovery', /waiting Run resumes only after its typed decision is resolved/]
  ];

  for (const [binding, pattern] of acceptanceBindings) {
    assert.match(result.stdout, pattern, `${binding} must remain executable from the Story acceptance replay`);
  }

  assert.match(result.stdout, /duplicate material questions reuse one typed pending artifact/, 'story-vibepro-human-decision-checkpoint ac:1 deduplication and material reason remain executable');
  assert.match(result.stdout, /every supported material decision type persists and resolves through one contract/, 'story-vibepro-human-decision-checkpoint ac:2 typed decision contract remains executable');
  assert.match(result.stdout, /waiting Run is side-effect free until the human decision is answered/, 'story-vibepro-human-decision-checkpoint ac:3 waiting and resume cursor remain executable');
  assert.match(result.stdout, /critical gate waiver is rejected without resolving the artifact/, 'story-vibepro-human-decision-checkpoint ac:4 critical waiver rejection remains executable');
  assert.match(result.stdout, /Brainbase handoff reference is preserved as an opaque value/, 'story-vibepro-human-decision-checkpoint ac:5 upstream handoff boundary remains executable');
  assert.match(result.stdout, /resolved replay repairs the decision index before Run resume continues/, 'story-vibepro-human-decision-checkpoint ac:6 journal replay and index repair remain executable');
  assert.match(result.stdout, /invalid type and cancelled Run are rejected/, 'story-vibepro-human-decision-checkpoint ac:7 negative paths remain executable');
  assert.match(result.stdout, /waiting Run resumes only after its typed decision is resolved/, 'story-vibepro-human-decision-checkpoint S-001: A persisted waiting Run resumes from the same typed decision after a fresh process restart.');
});
