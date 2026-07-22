import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const REPO_ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));

test('story-vibepro-independent-review-orchestration AC-1 through AC-8 S-001 S-002 flow replay', async () => {
  const { NODE_TEST_CONTEXT: _nodeTestContext, ...childEnv } = process.env;
  const result = await execFileAsync(process.execPath, [
    '--test',
    'test/independent-review-orchestrator.test.js',
    'test/guarded-run-session.test.js'
  ], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    env: childEnv,
    maxBuffer: 8 * 1024 * 1024
  });

  assert.match(result.stdout, /# pass [1-9]\d*\b/);
  assert.match(result.stdout, /# fail 0\b/);

  const bindings = [
    // story-vibepro-independent-review-orchestration ac:1
    ['AC-1', /runs roles in a stage concurrently and keeps the next stage behind its record barrier/],
    // story-vibepro-independent-review-orchestration ac:2
    ['AC-2', /production review fails closed without actual implementation runtime provenance/],
    // story-vibepro-independent-review-orchestration ac:3 S-001
    ['AC-3 S-001', /restart reuses every completed journal operation exactly once/],
    // story-vibepro-independent-review-orchestration ac:4
    ['AC-4', /preserves existing pass, needs_changes, and block verdicts/],
    // story-vibepro-independent-review-orchestration ac:5
    ['AC-5', /timeout, schema_failure, retry_or_async_failure, auth_denied, workflow_state_regression, and provenance stops never become pass/],
    // story-vibepro-independent-review-orchestration ac:6 S-002
    ['AC-6 S-002', /same-session\/runtime rejection and a needs_changes result are contained/],
    // story-vibepro-independent-review-orchestration ac:7
    ['AC-7', /Guarded Run adapter completes serial stages and preserves needs_changes for repair/],
    // story-vibepro-independent-review-orchestration ac:8
    ['AC-8', /Guarded Run executes the independent review action owner in the canonical DAG/]
  ];

  for (const [clause, pattern] of bindings) {
    assert.match(result.stdout, pattern, `${clause} must remain executable in the Story flow replay`);
  }

  assert.match(result.stdout, /restart reuses every completed journal operation exactly once/, 'story-vibepro-independent-review-orchestration ac:3 S-001 checkpoint restart is executable');
  assert.match(result.stdout, /same-session\/runtime rejection and a needs_changes result are contained/, 'story-vibepro-independent-review-orchestration ac:6 S-002 failure and repair matrix is executable');
});
