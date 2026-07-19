import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const REPO_ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));

test('story-vibepro-agent-runtime-adapters AC-1 through AC-7 and S-002 acceptance replay', async () => {
  const { NODE_TEST_CONTEXT: _nodeTestContext, ...childEnv } = process.env;
  const result = await execFileAsync(process.execPath, [
    '--test',
    'test/agent-runtime-adapter.test.js',
    'test/guarded-run-session.test.js'
  ], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    env: childEnv,
    maxBuffer: 8 * 1024 * 1024
  });

  assert.match(result.stdout, /# pass [1-9]\d*\b/);
  assert.match(result.stdout, /# fail 0\b/);

  const acceptanceBindings = [
    ['AC-1', /provider-neutral contract reports quota wait before start/],
    ['AC-2', /waiting runtime dispatch re-probes after capability recovery/],
    ['AC-3', /successful implementation result is structured and HEAD-bearing/],
    ['AC-4', /review requires review capability before provider start/],
    ['AC-5', /duplicate dispatch is reused and cancel confirms terminal runtime/],
    ['AC-6', /timeout and malformed success never become completion/],
    ['AC-7', /adapter definition rejects incomplete provider contracts/],
    ['S-002 success', /successful implementation result is structured and HEAD-bearing/],
    ['S-002 quota', /provider-neutral contract reports quota wait before start/],
    ['S-002 timeout', /start timeout invokes dispatch-scoped force containment/],
    ['S-002 cancel', /cancel escalates to force before declaring an orphan/],
    ['S-002 orphan', /nonterminal cancel fails closed as orphaned agent/],
    ['S-002 duplicate', /duplicate dispatch is reused and cancel confirms terminal runtime/],
    ['S-002 reviewer', /review requires separate identity and closed parallel provenance/]
  ];

  for (const [binding, pattern] of acceptanceBindings) {
    assert.match(result.stdout, pattern, `${binding} must remain executable from the Story acceptance replay`);
  }
});
