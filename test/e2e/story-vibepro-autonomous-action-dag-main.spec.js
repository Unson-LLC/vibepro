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

  assert.match(result.stdout, /(?:#|ℹ) fail 0\b/);
  for (const scenario of [
    { clause: 'AC-1 S-002', pattern: /AAD-S-1 Guarded Run composes the autonomous DAG through closed action owners/ },
    { clause: 'AC-2 S-003', pattern: /AAD-S-2 policy-denied autonomous actions fail closed before their runner executes/ },
    { clause: 'AC-3', pattern: /AAD-S-3 autonomous checkpoints resume after recreating the Guarded Run session/ },
    { clause: 'AC-4', pattern: /AAD-S-4 only final_prepare may produce pr_ready/ },
    { clause: 'AC-5', pattern: /AAD-S-5 public CLI disables autonomous execution before resuming an existing Run/ },
    { clause: 'AC-6', pattern: /AAD-S-6 final_prepare waiting_for_runtime stops before dependent autonomous nodes/ },
    { clause: 'AC-7 S-003', pattern: /AAD-S-7 autonomous composition preserves canonical owner artifact references/ }
  ]) assert.match(result.stdout, scenario.pattern, `${scenario.clause} executable workflow replay`);
});
