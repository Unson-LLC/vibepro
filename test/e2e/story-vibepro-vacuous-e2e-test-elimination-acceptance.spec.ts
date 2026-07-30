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

// VET-S-2 is a per-file claim: each removed file's Story acceptance criteria
// must still be executed by a behavioural test elsewhere. Asserting that the
// replacement suites merely CONTAIN the string "../src/" would be the same
// defect this Story removes, so each removed path is mapped to a named test
// case and that case is required to actually run and pass.
const REPLACEMENT_COVERAGE: { removed: string[]; suite: string; testName: string }[] = [
  {
    removed: [
      'test/e2e/story-vibepro-cli-status-honesty-main.spec.ts',
      'test/e2e/story-vibepro-cli-status-honesty-main.test.js'
    ],
    suite: 'test/cli-status-honesty.test.js',
    testName: 'DRS-CONTRACT-005 execute status fails closed when execution state is missing'
  },
  {
    removed: [
      'test/e2e/story-vibepro-execute-merge-command-flow.spec.ts',
      'test/e2e/story-vibepro-execute-merge-command-main.test.js'
    ],
    suite: 'test/cli-status-honesty.test.js',
    testName: 'GDO-S-3 execute merge fails closed on a corrupt local gate outcome ledger without losing verified delivery'
  },
  {
    removed: [
      'test/e2e/story-vibepro-engineering-judgment-activation-precision-main.spec.ts',
      'test/e2e/story-vibepro-engineering-judgment-activation-precision-main.test.js'
    ],
    suite: 'test/engineering-judgment-activation-precision.test.js',
    testName: 'non-text workflow corroboration activates execution topology axis'
  },
  {
    removed: ['test/e2e/story-vibepro-managed-worktree-policy-resync-main.spec.ts'],
    suite: 'test/managed-worktree-policy-resync.test.js',
    testName: 'refreshManagedWorktree resyncs policy sections while non-policy sections stay frozen'
  },
  {
    removed: ['test/e2e/story-vibepro-usage-report-main.spec.ts'],
    suite: 'test/traceability-usage-report.test.js',
    testName: 'declared and merged_outside states surface as separate signals'
  },
  {
    removed: ['test/e2e/story-vibepro-managed-worktree-execution-dag-main.spec.ts'],
    suite: 'test/execution-state.test.js',
    testName: 'execution DAG preserves external delivery without inventing historical merge readiness'
  },
  {
    removed: ['test/e2e/story-vibepro-evidence-user-fingerprint-main.spec.ts'],
    suite: 'test/vibepro-cli.test.js',
    testName: 'pr prepare keeps legacy full-fingerprint evidence stale when tracked VibePro manifest changes'
  },
  {
    removed: ['test/e2e/story-vibepro-keyword-gate-structured-migration-main.spec.ts'],
    suite: 'test/vibepro-cli.test.js',
    testName: 'pr prepare rejects legacy keyword evidence for atomic changed-path coverage'
  },
  {
    removed: ['test/e2e/story-vibepro-merge-delta-review-reuse-main.test.js'],
    suite: 'test/vibepro-cli.test.js',
    testName: 'review status keeps content-bound review current after merge delta outside inspected inputs'
  },
  {
    removed: [
      'test/e2e/story-vibepro-pr-ship-command-main.spec.ts',
      'test/e2e/story-vibepro-pr-ship-command-main.test.js'
    ],
    suite: 'test/vibepro-cli.test.js',
    testName: 'pr ship dry-run reruns prepare and stops with Agent Review commands instead of raw gh create'
  },
  {
    removed: ['test/e2e/story-vibepro-review-status-required-only-main.spec.ts'],
    suite: 'test/vibepro-cli.test.js',
    testName: 'review status focuses required current blockers and moves optional history behind flags'
  },
  // These two were rewritten into behavioural tests rather than deleted, so the
  // covering case lives in the surviving file itself.
  {
    removed: ['test/e2e/story-vibepro-execution-judgment-status-integrity-main.spec.ts'],
    suite: 'test/e2e/story-vibepro-execution-judgment-status-integrity-main.test.js',
    testName: 'story-vibepro-execution-judgment-status-integrity ac:1 ac:2 S-001 a merged artifact without explicit delivery leaves neither agent_review_recorded nor pr_created pending'
  },
  {
    removed: ['test/e2e/story-vibepro-managed-worktree-gate-main.spec.ts'],
    suite: 'test/e2e/story-vibepro-managed-worktree-gate-main.test.js',
    testName: 'story-vibepro-managed-worktree-gate ac:5 an accepted waiver decision record turns the gate bypassed and names the decision'
  }
];

function escapeForTestNamePattern(name: string) {
  return name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// One targeted child run per suite, selecting only the mapped cases by name.
// test/vibepro-cli.test.js is far too large to replay whole, and replaying it
// whole would prove less: a named-pattern run fails loudly if a mapped case has
// been renamed or removed, because the child then reports zero matching tests.
const replacementRuns = new Map<string, ReturnType<typeof execFileAsync>>();
for (const suite of new Set(REPLACEMENT_COVERAGE.map((entry) => entry.suite))) {
  const names = REPLACEMENT_COVERAGE
    .filter((entry) => entry.suite === suite)
    .map((entry) => `^${escapeForTestNamePattern(entry.testName)}$`);
  replacementRuns.set(suite, execFileAsync(process.execPath, [
    '--test',
    '--test-name-pattern',
    names.join('|'),
    suite
  ], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: childEnv,
    maxBuffer: 16 * 1024 * 1024
  }));
}
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

  // Every removed path must map to a named case, or the mapping has drifted
  // away from the deletion set and this clause is no longer being checked.
  const mapped = new Set(REPLACEMENT_COVERAGE.flatMap((entry) => entry.removed));
  assert.deepEqual(
    REMOVED_VACUOUS_FILES.filter((removed) => !mapped.has(removed)),
    [],
    'every removed file must be mapped to a named replacement test case'
  );

  // Each mapped case must actually have run and passed in its child process.
  for (const [suite, run] of replacementRuns) {
    const { stdout } = await run;
    assert.match(stdout, REPORTER_FAIL_ZERO, `${suite} replacement run must have no failures`);
    assert.doesNotMatch(stdout, /^not ok/m);

    const expected = REPLACEMENT_COVERAGE.filter((entry) => entry.suite === suite);
    for (const entry of expected) {
      assert.ok(
        stdout.includes(entry.testName),
        `${entry.suite} must still contain and execute "${entry.testName}" as replacement coverage for ${entry.removed.join(', ')}`
      );
    }

    // A renamed or deleted case makes --test-name-pattern select nothing, which
    // would otherwise report a vacuous "fail 0". The per-name assertions above
    // already catch that; this floor additionally rejects a run that reported no
    // passing test at all. It is a floor rather than an equality because a
    // matched subtest also marks its parent suite passed.
    const passed = Number(REPORTER_PASS_COUNT.exec(stdout)?.[1] ?? 0);
    assert.ok(
      passed >= expected.length,
      `${suite} must execute at least the ${expected.length} mapped case(s), saw ${passed}`
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

test('story-vibepro-vacuous-e2e-test-elimination ac:6 INV-001 the .spec.ts gate still fails closed on an empty spec set after the deletions', async () => {
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
