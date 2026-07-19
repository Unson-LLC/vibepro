import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const REPO_ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));

test('story-vibepro-next-best-action-controller ac:1 ac:2 ac:3 ac:4 ac:5 NBA-S-1..NBA-S-8 flow replay', async () => {
  const { NODE_TEST_CONTEXT: _nodeTestContext, ...childEnv } = process.env;
  const result = await execFileAsync(process.execPath, ['--test', 'test/next-best-action-controller.test.js'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    env: childEnv,
    maxBuffer: 2 * 1024 * 1024
  });

  assert.match(result.stdout, /# fail 0\b/, 'focused Next Best Action suite must have no failures');
  for (const scenario of [
    /NBA-S-1 excludes policy, dependency, and classification violations/,
    /NBA-S-2 and NBA-S-4 record every metric and preserve unknown costs/,
    /NBA-S-3 selection and tie-break are deterministic/,
    /NBA-S-5 reuses a decision when no material state changed/,
    /NBA-S-6 prefers a cheap uncertainty reduction before expensive validation/,
    /NBA-S-7 two no-progress checkpoints force an explicit escape action/,
    /NBA-S-8 decision record contains bounded rationale, not raw transcript/,
    /NBA-S-1 controller consumes only dependency-ready Safe Action registry candidates/
  ]) {
    assert.match(result.stdout, scenario, 'registry -> eligibility -> ranking -> bounded decision flow must remain executable');
  }
});
