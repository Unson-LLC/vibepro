import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

import { listE2eTsSpecs, runE2eTsSpecs } from '../../scripts/run-e2e-ts-specs.mjs';
import {
  detectProductExecutionSignals,
  listE2eTestFiles,
  lintE2eProductExecution
} from '../../scripts/lint-e2e-product-execution.mjs';

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const childEnv = { ...process.env };
delete childEnv.NODE_TEST_CONTEXT;

// This Story exists because test/e2e held files that asserted a locally-defined
// string against a regex built from that same string. This acceptance spec must
// not repeat that mistake, so every assertion below is bound to either a real
// child-process run of a behavioural suite or a real call into product code.
//
// The child's reporter differs by Node version and TTY: spec prints "ℹ fail 0"
// while tap prints "# fail 0". Accept either rather than pinning one format.
const REPORTER_FAIL_ZERO = /(?:ℹ|#) fail 0/;
const REPORTER_PASS_COUNT = /(?:ℹ|#) pass (\d+)/;

function replay(...testFiles: string[]) {
  return execFileAsync(process.execPath, ['--test', ...testFiles], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: childEnv,
    maxBuffer: 16 * 1024 * 1024
  });
}

// The files this Story removed, and the behavioural suites that already execute
// their Story acceptance criteria against real git repos and real CLI runs.
const REMOVED_VACUOUS_FILES = [
  'test/e2e/story-vibepro-cli-status-honesty-main.spec.ts',
  'test/e2e/story-vibepro-cli-status-honesty-main.test.js',
  'test/e2e/story-vibepro-engineering-judgment-activation-precision-main.spec.ts',
  'test/e2e/story-vibepro-engineering-judgment-activation-precision-main.test.js',
  'test/e2e/story-vibepro-evidence-user-fingerprint-main.spec.ts',
  'test/e2e/story-vibepro-execute-merge-command-flow.spec.ts',
  'test/e2e/story-vibepro-execute-merge-command-main.test.js',
  'test/e2e/story-vibepro-execution-judgment-status-integrity-main.spec.ts',
  'test/e2e/story-vibepro-keyword-gate-structured-migration-main.spec.ts',
  'test/e2e/story-vibepro-managed-worktree-execution-dag-main.spec.ts',
  'test/e2e/story-vibepro-managed-worktree-gate-main.spec.ts',
  'test/e2e/story-vibepro-managed-worktree-policy-resync-main.spec.ts',
  'test/e2e/story-vibepro-merge-delta-review-reuse-main.test.js',
  'test/e2e/story-vibepro-pr-ship-command-main.spec.ts',
  'test/e2e/story-vibepro-pr-ship-command-main.test.js',
  'test/e2e/story-vibepro-review-status-required-only-main.spec.ts',
  'test/e2e/story-vibepro-usage-report-main.spec.ts'
];

const REPLACEMENT_SUITES = [
  'test/cli-status-honesty.test.js',
  'test/engineering-judgment-activation-precision.test.js',
  'test/managed-worktree-policy-resync.test.js',
  'test/traceability-usage-report.test.js'
];

const replacementRun = replay(...REPLACEMENT_SUITES);
const executionStateRun = replay('test/e2e/story-vibepro-execution-judgment-status-integrity-main.test.js');
const managedWorktreeRun = replay('test/e2e/story-vibepro-managed-worktree-gate-main.test.js');
const specGateRun = replay('test/node20-e2e-ts-ci-visibility.test.js');
const lintRun = replay('test/e2e-product-execution-lint.test.js');

test('story-vibepro-vacuous-e2e-test-elimination ac:2 VET-S-2 the removed files leave no coverage hole: their Story ACs still execute in behavioural suites', async () => {
  for (const removed of REMOVED_VACUOUS_FILES) {
    assert.equal(
      existsSync(path.join(repoRoot, removed)),
      false,
      `${removed} must be removed by this Story`
    );
  }

  const { stdout } = await replacementRun;
  assert.match(stdout, REPORTER_FAIL_ZERO);
  assert.doesNotMatch(stdout, /^not ok/m);
  const passed = Number(REPORTER_PASS_COUNT.exec(stdout)?.[1] ?? 0);
  assert.ok(passed > 0, `replacement coverage suites must execute tests, saw ${passed}`);

  // Each replacement suite must actually drive product code rather than assert
  // on its own literals: that is the defect this Story removes.
  for (const suite of REPLACEMENT_SUITES) {
    const source = readFileSync(path.join(repoRoot, suite), 'utf8');
    assert.match(
      source,
      /from '\.\.\/src\/|require\('\.\.\/src\/|VIBEPRO_BIN|bin\/vibepro\.js/,
      `${suite} must import product code or run the CLI to be real replacement coverage`
    );
  }
});

test('story-vibepro-vacuous-e2e-test-elimination ac:3 S-001 the execution-state merged -> agent_review derivation is executed, not asserted about', async () => {
  const { stdout } = await executionStateRun;
  assert.match(
    stdout,
    /story-vibepro-execution-judgment-status-integrity ac:1 ac:2 S-001 a merged artifact without explicit delivery leaves neither agent_review_recorded nor pr_created pending/
  );
  assert.match(
    stdout,
    /story-vibepro-execution-judgment-status-integrity ac:1 ac:2 S-003 an explicit delivery artifact does not infer agent review completion/
  );
  assert.match(stdout, REPORTER_FAIL_ZERO);
  assert.doesNotMatch(stdout, /^not ok/m);

  // The branch under test must still exist in the product source; if it is
  // deleted the replacement test above is no longer covering anything.
  const source = readFileSync(path.join(repoRoot, 'src/execution-state.js'), 'utf8');
  assert.match(source, /deriveCompletedPhases/);
  assert.match(source, /hasExplicitDelivery/);
});

test('story-vibepro-vacuous-e2e-test-elimination ac:4 S-002 the managed-worktree bypassed branch is reached through an accepted waiver decision record', async () => {
  const { stdout } = await managedWorktreeRun;
  assert.match(
    stdout,
    /story-vibepro-managed-worktree-gate ac:5 an accepted waiver decision record turns the gate bypassed and names the decision/
  );
  assert.match(
    stdout,
    /story-vibepro-managed-worktree-gate ac:5 a waiver that is still open does not bypass the gate/
  );
  assert.match(stdout, REPORTER_FAIL_ZERO);
  assert.doesNotMatch(stdout, /^not ok/m);

  const source = readFileSync(path.join(repoRoot, 'src/managed-worktree-gate.js'), 'utf8');
  assert.match(source, /findAcceptedManagedWorktreeBypass/);
});

test('story-vibepro-vacuous-e2e-test-elimination ac:6 INV-003 the .spec.ts gate still fails closed on an empty spec set after the deletions', async () => {
  // Real call into the runner used by `npm run test:e2e:ts`.
  const specs = listE2eTsSpecs(repoRoot);
  assert.ok(specs.length > 0, 'the .spec.ts gate must not degrade into a silent no-op');
  assert.ok(
    specs.includes(path.join('test', 'e2e', 'story-vibepro-vacuous-e2e-test-elimination-acceptance.spec.ts')),
    'this acceptance spec must itself be part of the gated spec set'
  );

  // Mutation check: with no specs the runner must fail, not pass quietly.
  const emptyLog: string[] = [];
  const emptyStatus = runE2eTsSpecs({
    rootDir: path.join(repoRoot, 'src'),
    log: (line: string) => emptyLog.push(line),
    spawn: () => {
      throw new Error('the runner must never spawn a child when the spec set is empty');
    }
  });
  assert.equal(emptyStatus, 1);
  assert.ok(emptyLog.some((line) => line.includes('silent no-op')));

  const { stdout } = await specGateRun;
  assert.match(stdout, REPORTER_FAIL_ZERO);
  assert.doesNotMatch(stdout, /^not ok/m);
});

test('story-vibepro-vacuous-e2e-test-elimination ac:1 VET-S-1 no file under test/e2e executes zero product behaviour', async () => {
  // Real run of the lint against the real repository directory.
  const lines: string[] = [];
  const status = lintE2eProductExecution({
    rootDir: repoRoot,
    log: (line: string) => lines.push(line)
  });
  const output = lines.join('\n');
  assert.equal(status, 0, output);
  assert.match(output, /all execute product behaviour/);

  // The count the lint reports must be the directory it actually inspected,
  // not a constant: otherwise a moved directory would still read as clean.
  const inspected = Number(/e2e-product-execution: (\d+) e2e test file/.exec(output)?.[1] ?? 0);
  assert.ok(inspected > 0);
  assert.equal(inspected, listE2eTestFiles(path.join(repoRoot, 'test', 'e2e')).length);
});

test('story-vibepro-vacuous-e2e-test-elimination ac:5 VET-S-5 the lint detects a vacuous file and fails closed when it cannot scan', async () => {
  // The exact shape this Story removed: a literal asserted against a regex
  // built from that same literal.
  const vacuous = [
    "import test from 'node:test';",
    "import assert from 'node:assert/strict';",
    "test('x', () => {",
    "  assert.match('activation_candidates activation_signals activation_precision', /activation_precision/);",
    '});'
  ].join('\n');
  assert.deepEqual(detectProductExecutionSignals(vacuous), []);

  const detected: string[] = [];
  const detectedStatus = lintE2eProductExecution({
    rootDir: repoRoot,
    log: (line: string) => detected.push(line),
    readdir: () => ['story-vacuous-main.test.js'],
    readFile: () => vacuous
  });
  assert.equal(detectedStatus, 1);
  assert.match(detected.join('\n'), /story-vacuous-main\.test\.js/);

  // Second clause of VET-S-5: an unscannable directory must also fail.
  const unscannable: string[] = [];
  const unscannableStatus = lintE2eProductExecution({
    rootDir: repoRoot,
    log: (line: string) => unscannable.push(line),
    readdir: () => {
      throw Object.assign(new Error('ENOENT: no such file or directory'), { code: 'ENOENT' });
    }
  });
  assert.equal(unscannableStatus, 1);
  assert.match(unscannable.join('\n'), /Could not scan/);

  // And the lint's own suite must be green, so the two clauses above are
  // backed by a maintained test file rather than only by this replay.
  const { stdout } = await lintRun;
  assert.match(stdout, /LINT-1 VET-S-5 a test file that executes no product behaviour fails the lint and is named/);
  assert.match(stdout, /LINT-2 VET-S-5 the lint fails closed when it cannot scan the e2e directory/);
  assert.match(stdout, REPORTER_FAIL_ZERO);
  assert.doesNotMatch(stdout, /^not ok/m);
});
