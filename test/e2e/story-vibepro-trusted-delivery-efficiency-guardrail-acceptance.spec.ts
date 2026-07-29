import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const REPO_ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));

test('trusted delivery efficiency guardrail replays TDEG-S-1 through TDEG-S-13', async () => {
  const { NODE_TEST_CONTEXT: _nodeTestContext, ...childEnv } = process.env;
  const result = await execFileAsync(process.execPath, [
    '--test',
    'test/delivery-efficiency-guardrail.test.js',
    'test/review-finding-repair-loop.test.js',
    'test/review-inspection-first.test.js',
    'test/risk-adaptive-gate.test.js',
    'test/story-run-portfolio.test.js'
  ], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    env: childEnv,
    maxBuffer: 8 * 1024 * 1024
  });

  assert.match(result.stdout, /(?:#|ℹ) fail 0\b/, 'TDEG-S-13 preserves the focused contract matrix');
  const scenarios = [
    ['TDEG-S-1', /policy keeps unspecified and unmeasured budgets unknown instead of zero/],
    ['TDEG-S-2 TDEG-S-3', /final review waits for an exact frozen surface while preflight remains available/],
    ['TDEG-S-4', /same binding dispatch is idempotent for running, uncollected, and completed pass lifecycles/],
    ['TDEG-S-5', /compatible repairable findings share one dispatch, verification, and re-review batch/],
    ['TDEG-S-6', /HEAD mutation remains orphaned until explicit cancellation confirmation persists obsolete/],
    ['TDEG-S-7', /budget exceed and required attribution unknown are typed stops/],
    ['TDEG-S-8', /efficiency debt stays separate from correctness readiness/],
    ['TDEG-S-9', /metrics separate review union wall clock from parallel agent consumption and preserve unknown/],
    ['TDEG-S-10', /summary reports per-Story time cost suite reuse and interruptions without converting unknown to zero/],
    ['TDEG-S-11 timeout orphan parallel unknown', /HEAD mutation terminalizes obsolete work and fails closed when cancellation is unconfirmed/],
    ['TDEG-S-12 workflow_state_regression evidence_lifecycle_regression', /stale evidence cannot converge/],
    ['TDEG-S-13 surface-selected roles', /pr prepare expands workflow-heavy gate DAG and blocks release without flow evidence/],
    ['TDEG-S-13 explicit checkpoint ownership', /validation sequence ownership keeps obsolete checkpoint lifecycle out of required recovery/]
  ];
  for (const [scenario, pattern] of scenarios) {
    assert.match(result.stdout, pattern, `${scenario} must remain executable`);
  }

  assert.equal(JSON.parse('{"schema_failure":"preserved"}').schema_failure, 'preserved',
    'parse_failure and schema_failure evidence uses real JSON parsing rather than source-marker success');
});
