import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const REPO_ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));

test('story-vibepro-autonomous-action-dag AAD-S-1 through AAD-S-7 workflow replay', async () => {
  const { NODE_TEST_CONTEXT: _nodeTestContext, ...childEnv } = process.env;
  const result = await execFileAsync(process.execPath, [
    '--test',
    'test/guarded-run-session.test.js',
    'test/safe-action-orchestrator.test.js',
    'test/next-best-action-controller.test.js'
  ], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    env: childEnv,
    maxBuffer: 8 * 1024 * 1024
  });

  assert.match(result.stdout, /# fail 0\b/);
  for (const scenario of [
    /AAD-S-1 Guarded Run composes the autonomous DAG through closed action owners/,
    /AAD-S-2 policy-denied autonomous actions fail closed before their runner executes/,
    /AAD-S-3 autonomous checkpoints resume after recreating the Guarded Run session/,
    /AAD-S-4 only final_prepare may produce pr_ready/,
    /AAD-S-5 explicitly selecting legacy keeps the two-node rollback path/,
    /AAD-S-6 waiting_for_runtime stops before dependent autonomous nodes/,
    /AAD-S-7 autonomous composition preserves canonical owner artifact references/
  ]) assert.match(result.stdout, scenario);
});
