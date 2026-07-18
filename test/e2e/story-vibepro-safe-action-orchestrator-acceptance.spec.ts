import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const REPO_ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const ORCHESTRATOR_TEST = 'test/safe-action-orchestrator.test.js';
const RUN_CONTRACT_TEST = 'test/guarded-run-session.test.js';

test('story-vibepro-safe-action-orchestrator ac:1 ac:2 ac:3 ac:4 ac:5 ac:6 ac:7 S-008 acceptance and scenario replay', async () => {
  const { NODE_TEST_CONTEXT: _nodeTestContext, ...childEnv } = process.env;
  const result = await execFileAsync(process.execPath, ['--test', ORCHESTRATOR_TEST, RUN_CONTRACT_TEST], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    env: childEnv,
    maxBuffer: 4 * 1024 * 1024
  });

  assert.match(result.stdout, /# pass [1-9]\d*\b/, 'focused Safe Action suites must pass');
  assert.match(result.stdout, /# fail 0\b/, 'focused Safe Action suites must have no failures');

  assert.match(result.stdout, /SAO-S-1 injected plan cannot omit, reorder, or duplicate canonical dependencies/,
    'SAO-S-1 binds execution to the closed dependency-ordered plan');
  assert.match(result.stdout, /SAO-S-4 forbidden action never invokes a runner/,
    'SAO-S-2 binds execution to typed allowlisted Actions instead of shell text');
  assert.match(result.stdout, /SAO-S-5 safe autopilot classifies missing and failed current evidence without executing commands/,
    'SAO-S-3 preserves verification and human-decision stops from the existing autopilot contract');
  assert.match(result.stdout, /SAO-S-2 completed same Run node and HEAD is skipped/,
    'SAO-S-4 binds repeated execution to the persisted idempotency checkpoint');
  assert.match(result.stdout, /SAO-S-3 action failure stops and records action_failed/,
    'SAO-S-5 prevents failed Actions from advancing implicitly');
  assert.match(result.stdout, /SAO-S-2 pr_ready is revoked until a changed HEAD passes the Gate DAG/,
    'SAO-S-6 rebinds changed repositories to current-HEAD Gate evaluation');
  assert.match(result.stdout, /SAO-S-8 external safe autopilot options stop before preparation/,
    'S-008 keeps CI, PR, import, and arbitrary environment operations behind human approval');

  for (const requiredScenario of [
    /SAO-S-1 dry-run returns a closed plan without invoking a runner/,
    /SAO-S-2 C-004 resume retries only the failed action and preserves the completed checkpoint/,
    /SAO-S-5 verification block persists failed kinds for public JSON and human status/,
    /SAO-S-5 production safe adapter maps critical and human Gate outcomes/,
    /SAO-S-4 forbidden action never invokes a runner/
  ]) {
    assert.match(result.stdout, requiredScenario, 'SAO-S-7 requires executable coverage for every safety scenario');
  }
});
