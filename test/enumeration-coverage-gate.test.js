import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  classifySites,
  collectEnumerationCoverage,
  collectEnumerationScenarios,
  extractEnumerableLiterals,
  isProductSourcePath,
  parseAddedLineMap,
  summarizeCountProvenance,
  parseEnumerationScenario,
  reproductionCommand,
  scenarioTemplate,
  selectRequiredIdentifiers,
  validateEnumerationClaim
} from '../src/enumeration-evidence.js';

const WELL_FORMED = 'enumeration: grepped cost_missing across src, test; 7 sites found, 5 updated, 2 unchanged because both are doc examples';

function evidenceWithScenarios(...scenarios) {
  return {
    commands: [
      {
        kind: 'unit',
        binding: { status: 'current' },
        observation: { targets: ['src'], scenarios, values: {} }
      }
    ]
  };
}

/**
 * A provider stub standing in for the git/fs tree, so the decision logic is
 * testable without spawning git.
 */
function stubProvider({ added = [], base = [], headFiles = new Map(), counts = new Map() } = {}) {
  return {
    async addedLiterals() {
      return new Set(added);
    },
    async baseLiterals() {
      return base === null ? null : new Set(base);
    },
    async productSourceFiles() {
      return [...headFiles.keys()];
    },
    async scanFile(file, onLine) {
      const content = headFiles.get(file);
      if (content === undefined) return 'skipped';
      for (const line of content.split('\n')) onLine(line);
      return 'scanned';
    },
    async countSites(identifier, paths) {
      const key = `${identifier}::${paths.join(',')}`;
      return counts.get(key) ?? { lines: 0, files: 0, product_source_lines: 0, product_source_files: 0, product_source_file_list: [], missing_paths: [], unscannable_paths: [] };
    }
  };
}

// --- ENUM-S-1: contract grammar -------------------------------------------

test('ENUM-S-1 parses a well formed enumeration scenario into structured parts', () => {
  const parsed = parseEnumerationScenario(WELL_FORMED);
  assert.equal(parsed.matched, true);
  assert.equal(parsed.ok, true);
  assert.deepEqual(parsed.claim.paths, ['src', 'test']);
  assert.equal(parsed.claim.identifier, 'cost_missing');
  assert.equal(parsed.claim.found, 7);
  assert.equal(parsed.claim.updated, 5);
  assert.equal(parsed.claim.unchanged, 2);
  assert.equal(parsed.claim.reason, 'both are doc examples');
});

test('ENUM-S-1 rejects count-free narration that announces itself as enumeration', () => {
  // This is the exact shape the prior story's reviewers used in prose and the
  // implementer never used at all: a sweep claim with no numbers.
  const parsed = parseEnumerationScenario('enumeration: swept src, skills, docs, scripts, bin and .github');
  assert.equal(parsed.matched, true);
  assert.equal(parsed.ok, false);
  assert.equal(parsed.rejection.id, 'enumeration_scenario_malformed');
});

test('ENUM-S-1 leaves non-enumeration scenarios untouched', () => {
  const parsed = parseEnumerationScenario('schema_failure: invalid payload is rejected');
  assert.equal(parsed.matched, false);
  assert.equal(parsed.rejection, null);
});

test('ENUM-S-1 rejects an enumeration scenario with no searchable path', () => {
  const parsed = parseEnumerationScenario('enumeration: grepped cost_missing across  ; 2 sites found, 2 updated, 0 unchanged');
  assert.equal(parsed.matched, true);
  assert.equal(parsed.ok, false);
  assert.ok(['enumeration_paths_missing', 'enumeration_scenario_malformed'].includes(parsed.rejection.id));
});

// --- ENUM-S-2: count coherence --------------------------------------------

test('ENUM-S-2 rejects counts that do not partition the discovered sites', () => {
  const parsed = parseEnumerationScenario('enumeration: grepped cost_missing across src; 9 sites found, 5 updated, 2 unchanged because x');
  assert.equal(parsed.ok, false);
  assert.equal(parsed.rejection.id, 'enumeration_counts_unbalanced');
  assert.match(parsed.rejection.reason, /5 updated \+ 2 unchanged = 7/);
});

test('ENUM-S-2 rejects a zero-site sweep as a discovery failure, not coverage', () => {
  const parsed = parseEnumerationScenario('enumeration: grepped cost_missing across src; 0 sites found, 0 updated, 0 unchanged');
  assert.equal(parsed.ok, false);
  assert.equal(parsed.rejection.id, 'enumeration_found_zero');
});

test('ENUM-S-2 requires a reason whenever sites are deliberately left unchanged', () => {
  const parsed = parseEnumerationScenario('enumeration: grepped cost_missing across src; 3 sites found, 2 updated, 1 unchanged');
  assert.equal(parsed.ok, false);
  assert.equal(parsed.rejection.id, 'enumeration_unchanged_reason_missing');
});

test('ENUM-S-2 accepts a fully updated sweep without a because clause', () => {
  const parsed = parseEnumerationScenario('enumeration: grepped cost_missing across src; 3 sites found, 3 updated, 0 unchanged');
  assert.equal(parsed.ok, true);
  assert.equal(parsed.claim.reason, null);
});

test('ENUM-S-2 validateEnumerationClaim rejects non-integer counts', () => {
  const result = validateEnumerationClaim({
    identifier: 'cost_missing', paths: ['src'], found: Number.NaN, updated: 1, unchanged: 0, reason: null, scenario: 'x'
  });
  assert.equal(result.ok, false);
  assert.equal(result.rejection.id, 'enumeration_counts_invalid');
});

// --- ENUM-S-3: recount against the tree -----------------------------------

test('ENUM-S-3 fails closed when the claimed count does not match the recount', async () => {
  const report = await collectEnumerationCoverage({
    verificationEvidence: evidenceWithScenarios('enumeration: grepped cost_missing across src; 7 sites found, 7 updated, 0 unchanged'),
    provider: stubProvider({
      added: ['cost_missing'],
      base: [],
      headFiles: new Map([
        ['src/a.js', "const x = 'cost_missing';"],
        ['src/b.js', "if (v === 'cost_missing') {}"]
      ]),
      // The tree really contains 3 sites; the claim said 7.
      counts: new Map([['cost_missing::src', { lines: 3, files: 2, product_source_lines: 3, product_source_files: 2, product_source_file_list: ['src/a.js', 'src/b.js'], missing_paths: [], unscannable_paths: [] }]])
    })
  });
  assert.equal(report.status, 'failed');
  assert.equal(report.rejections.length, 1);
  assert.equal(report.rejections[0].id, 'enumeration_count_mismatch');
  assert.match(report.rejections[0].reason, /observes 3/);
});

test('ENUM-S-3 fails closed when a declared path does not exist', async () => {
  const report = await collectEnumerationCoverage({
    verificationEvidence: evidenceWithScenarios('enumeration: grepped cost_missing across src, ghost; 3 sites found, 3 updated, 0 unchanged'),
    provider: stubProvider({
      added: ['cost_missing'],
      base: [],
      headFiles: new Map([
        ['src/a.js', "const x = 'cost_missing';"],
        ['src/b.js', "if (v === 'cost_missing') {}"]
      ]),
      counts: new Map([['cost_missing::src,ghost', { lines: 3, files: 2, product_source_lines: 3, product_source_files: 2, product_source_file_list: ['src/a.js', 'src/b.js'], missing_paths: ['ghost'], unscannable_paths: [] }]])
    })
  });
  assert.equal(report.status, 'failed');
  assert.equal(report.rejections[0].id, 'enumeration_path_missing');
});

test('ENUM-S-3 passes only when the claimed count survives the recount', async () => {
  const report = await collectEnumerationCoverage({
    verificationEvidence: evidenceWithScenarios('enumeration: grepped cost_missing across src; 3 sites found, 2 updated, 1 unchanged because the third site is a comment'),
    provider: stubProvider({
      added: ['cost_missing'],
      base: [],
      headFiles: new Map([
        ['src/a.js', "const x = 'cost_missing';"],
        ['src/b.js', "if (v === 'cost_missing') {}"]
      ]),
      counts: new Map([['cost_missing::src', { lines: 3, files: 2, product_source_lines: 3, product_source_files: 2, product_source_file_list: ['src/a.js', 'src/b.js'], missing_paths: [], unscannable_paths: [] }]])
    })
  });
  assert.equal(report.status, 'passed');
  assert.deepEqual(report.missing, []);
  assert.equal(report.rejections.length, 0);
});

test('ENUM-S-3 publishes a reproduction command that names the same range', () => {
  const command = reproductionCommand('cost_missing', ['src', 'test']);
  assert.match(command, /grep -rIn/);
  assert.match(command, /--exclude-dir=\.vibepro/);
  assert.match(command, /-w -- cost_missing src test/);
});

// --- ENUM-S-4: applicability ----------------------------------------------

test('ENUM-S-4 requires enumeration only for new identifiers spanning 2+ source files', () => {
  const { required, skipped } = selectRequiredIdentifiers({
    addedLiterals: new Set(['cost_missing', 'local_only', 'already_known']),
    baseLiterals: new Set(['already_known']),
    headFileCounts: new Map([['cost_missing', 3], ['local_only', 1], ['already_known', 9]]),
    headSiteCounts: new Map([['cost_missing', 5], ['local_only', 1], ['already_known', 20]])
  });
  assert.deepEqual(required.map((item) => item.identifier), ['cost_missing']);
  assert.deepEqual(
    skipped.map((item) => [item.identifier, item.reason]).sort(),
    [['already_known', 'pre_existing_in_base'], ['local_only', 'single_product_source_site']]
  );
});

test('ENUM-S-4 resolves not_applicable for a change with no new cross-file identifier', async () => {
  const report = await collectEnumerationCoverage({
    verificationEvidence: evidenceWithScenarios('unit: docs only change'),
    provider: stubProvider({ added: [], base: ['already_known'], headFiles: new Map() })
  });
  assert.equal(report.status, 'not_applicable');
  assert.deepEqual(report.required, []);
});

test('ENUM-S-4 treats a docs-only change (no product source diff) as not_applicable', async () => {
  // A docs-only change contributes no added literals under src/bin/lib/scripts,
  // so the gate must not manufacture evidence work for it.
  const report = await collectEnumerationCoverage({
    verificationEvidence: { commands: [] },
    provider: stubProvider({ added: [], base: ['not_applicable'], headFiles: new Map() })
  });
  assert.equal(report.status, 'not_applicable');
});

test('ENUM-S-4 reports inconclusive, not pass, when the base tree cannot be read', async () => {
  const report = await collectEnumerationCoverage({
    verificationEvidence: { commands: [] },
    baseRef: 'origin/main',
    provider: stubProvider({ added: ['cost_missing'], base: null })
  });
  assert.equal(report.status, 'inconclusive');
  assert.match(report.reason, /could not be scanned/);
});

// --- ENUM-S-5: the gate blocks --------------------------------------------

test('ENUM-S-5 reports needs_evidence when a required identifier has no claim', async () => {
  const report = await collectEnumerationCoverage({
    verificationEvidence: evidenceWithScenarios('unit: the new state is handled'),
    provider: stubProvider({
      added: ['cost_missing'],
      base: [],
      headFiles: new Map([
        ['src/a.js', "const x = 'cost_missing';"],
        ['src/b.js', "if (v === 'cost_missing') {}"]
      ])
    })
  });
  assert.equal(report.status, 'needs_evidence');
  assert.deepEqual(report.missing, ['cost_missing']);
});

test('ENUM-S-5 a claim for a different identifier does not close the required one', async () => {
  const report = await collectEnumerationCoverage({
    verificationEvidence: evidenceWithScenarios('enumeration: grepped other_thing across src; 2 sites found, 2 updated, 0 unchanged'),
    provider: stubProvider({
      added: ['cost_missing'],
      base: [],
      headFiles: new Map([
        ['src/a.js', "const x = 'cost_missing';"],
        ['src/b.js', "if (v === 'cost_missing') {}"]
      ]),
      counts: new Map([['other_thing::src', { lines: 2, files: 1, product_source_lines: 2, product_source_files: 1, product_source_file_list: ['src/a.js'], missing_paths: [], unscannable_paths: [] }]])
    })
  });
  assert.equal(report.status, 'needs_evidence');
  assert.deepEqual(report.missing, ['cost_missing']);
});

// --- ENUM-S-5: the gate actually blocks, in BOTH predicates ----------------
//
// These assertions exist because a review found the execution-state predicate
// was dead code: the gate node's type was absent from that file's collector
// allowlist, so the predicate could never see the node. Nothing in the suite
// asserted either predicate, which is why it survived.

test('ENUM-S-5 the pr-manager blocking predicate treats every non-resolved status as critical', async () => {
  const { isCriticalUnresolvedGate } = await import('../src/pr-manager.js');
  for (const status of ['needs_evidence', 'failed', 'inconclusive']) {
    assert.equal(
      isCriticalUnresolvedGate({ id: 'gate:enumeration_coverage', type: 'enumeration_coverage_gate', status }),
      true,
      `${status} must block PR creation`
    );
  }
  for (const status of ['passed', 'not_applicable']) {
    assert.equal(
      isCriticalUnresolvedGate({ id: 'gate:enumeration_coverage', type: 'enumeration_coverage_gate', status }),
      false,
      `${status} must not block`
    );
  }
});

test('ENUM-S-5 the execution-state blocking predicate agrees with its pr-manager twin', async () => {
  const executionState = await import('../src/execution-state.js');
  for (const status of ['needs_evidence', 'failed', 'inconclusive']) {
    assert.equal(
      executionState.isCriticalUnresolvedGate({ id: 'gate:enumeration_coverage', type: 'enumeration_coverage_gate', status }),
      true,
      `${status} must block managed execution`
    );
  }
  for (const status of ['passed', 'not_applicable']) {
    assert.equal(
      executionState.isCriticalUnresolvedGate({ id: 'gate:enumeration_coverage', type: 'enumeration_coverage_gate', status }),
      false,
      `${status} must not block managed execution`
    );
  }
});

test('ENUM-S-5 the execution-state collector admits the gate node type so its predicate is reachable', async () => {
  const { collectUnresolvedRequiredGates } = await import('../src/execution-state.js');
  const unresolved = collectUnresolvedRequiredGates({
    nodes: [{
      id: 'gate:enumeration_coverage',
      type: 'enumeration_coverage_gate',
      label: 'Enumeration Coverage Gate',
      status: 'needs_evidence',
      required: true
    }]
  });
  const ids = unresolved.map((gate) => gate.id);
  assert.ok(
    ids.includes('gate:enumeration_coverage'),
    'the gate type must be in the collector allowlist, otherwise the blocking predicate is unreachable'
  );
});

test('ENUM-S-5 the gate node sits on the DAG between failure mode coverage and decision record', async () => {
  const source = await readFile(new URL('../src/pr-manager.js', import.meta.url), 'utf8');
  assert.match(source, /\{ from: 'gate:failure_mode_coverage', to: 'gate:enumeration_coverage' \}/);
  assert.match(source, /\{ from: 'gate:enumeration_coverage', to: 'gate:decision_record' \}/);
});

test('ENUM-S-5 every gate DAG status classifier behaviourally treats inconclusive as unresolved', async () => {
  // Rounds 1-5 each found this registration half closed. A source-text scan
  // recognises one spelling and missed html-report.js entirely; assert the
  // behaviour of each classifier instead, so any spelling that stops rejecting
  // the status fails here.
  const node = { id: 'gate:enumeration_coverage', type: 'enumeration_coverage_gate', status: 'inconclusive', required: true };

  const { isGateDagBlockingStatus } = await import('../src/scan-status.js');
  assert.equal(isGateDagBlockingStatus('inconclusive'), true, 'shared predicate');

  const { isUnresolvedGateStatus } = await import('../src/pr-manager.js');
  assert.equal(isUnresolvedGateStatus('inconclusive'), true, 'pr-manager');

  const executionState = await import('../src/execution-state.js');
  assert.equal(
    executionState.isCriticalUnresolvedGate(node),
    true,
    'execution-state blocking predicate'
  );

  const { UNRESOLVED_STATUSES } = await import('../src/checkpoint-manager.js');
  assert.ok(UNRESOLVED_STATUSES.has('inconclusive'), 'checkpoint-manager');

  const ledger = await import('../src/gate-outcome-ledger.js');
  assert.ok(ledger.UNRESOLVED_STATUSES.has('inconclusive'), 'gate-outcome-ledger');

  const htmlReport = await import('../src/html-report.js');
  assert.equal(htmlReport.isUnresolvedStatus('inconclusive'), true, 'html-report unresolved list');
  assert.notEqual(htmlReport.toneForStatus('inconclusive'), 'neutral', 'html-report must not render it as neutral');

  const uiux = await import('../src/uiux-prepare.js');
  assert.equal(
    uiux.summarizeBlockingGates({ status: 'available', path: 'x', data: { nodes: [node] } }).count,
    1,
    'uiux prepare must count an inconclusive required gate as blocking'
  );

  // The two surfaces round 8 proved were claimed but not asserted. Reverting
  // either one used to leave the whole suite green, which is how the recorded
  // "all four surfaces asserted behaviourally" claim survived being false.
  const seniorGap = await import('../src/senior-gap-judgment.js');
  assert.ok(
    seniorGap.UNRESOLVED_STATUSES.has('inconclusive'),
    'senior-gap-judgment keeps its own copy of the vocabulary and must reject the status'
  );

  const playbook = await import('../src/playbook-exporter.js');
  assert.deepEqual(
    playbook.summarizeGates({ nodes: [{ ...node, required: false }] }).items.map((item) => item.id),
    ['gate:enumeration_coverage'],
    'playbook export must surface a non-required inconclusive gate through the shared predicate'
  );
  assert.deepEqual(
    playbook.summarizeGates({ nodes: [{ ...node, required: false, status: 'passed' }] }).items,
    [],
    'and must not surface a passing non-required gate'
  );

  const selfDogfood = await import('../src/self-dogfood-scanner.js');
  assert.equal(
    selfDogfood.isCriticalGateDag({ nodes: [{ ...node, type: 'verification_gate' }] }),
    true,
    'self-dogfood scanner'
  );
});

test('ENUM-S-5 the shared gate DAG blocking predicate treats inconclusive as unresolved', async () => {
  const { isGateDagBlockingStatus, GATE_DAG_BLOCKING_STATUSES } = await import('../src/scan-status.js');
  assert.equal(isGateDagBlockingStatus('inconclusive'), true);
  assert.equal(isGateDagBlockingStatus('passed'), false);
  assert.equal(isGateDagBlockingStatus('not_applicable'), false);
  assert.ok(GATE_DAG_BLOCKING_STATUSES.includes('inconclusive'));

  // Behavioural, not textual: each classifier must actually reject the status.
  const { isUnresolvedGateStatus } = await import('../src/pr-manager.js');
  assert.equal(isUnresolvedGateStatus('inconclusive'), true);
  const { isCriticalUnresolvedGate } = await import('../src/execution-state.js');
  assert.equal(
    isCriticalUnresolvedGate({ id: 'gate:enumeration_coverage', type: 'enumeration_coverage_gate', status: 'inconclusive' }),
    true
  );
});

test('a repeated or nested declared path cannot inflate coverage past the floor', () => {
  // Reproduced by review: naming one file five times reached the numeric floor
  // for a five-file class, and the published grep double-counted identically.
  const { required } = selectRequiredIdentifiers({
    addedLiterals: new Set(['new_status']),
    baseLiterals: new Set(),
    headFileCounts: new Map([['new_status', 5]]),
    headSiteCounts: new Map([['new_status', 5]]),
    headFileSets: new Map([['new_status', new Set(['src/a.js', 'src/b.js', 'src/c.js', 'src/d.js', 'src/e.js'])]])
  });
  assert.deepEqual(required[0].product_source_file_list, ['src/a.js', 'src/b.js', 'src/c.js', 'src/d.js', 'src/e.js']);
});

test('an enumeration-prefixed scenario that is not recognised as a claim is surfaced', () => {
  const scenarios = collectEnumerationScenarios(evidenceWithScenarios(
    'enumeration: covered every registration of gate:foo across src',
    'unit: unrelated'
  ));
  assert.equal(scenarios.length, 0);
  assert.equal(scenarios.unrecognized.length, 1);
  assert.match(scenarios.unrecognized[0].scenario, /covered every registration/);
});

// binary_paths was wired at the consumer and never produced, so the gate node
// reported [] while real files were being excluded. The first repair produced
// it on the success path only and hard-coded [] on the unreadable early return
// — the one return that actually holds a populated list — and the test that
// claimed "every return" used a fixture with no unreadable file at all, so no
// mutation of the early returns failed anything. Both returns are exercised
// here, each with a binary file present.
function providerWithBinary({ unreadableFile = null } = {}) {
  const files = ['src/a.js', 'src/blob.js'];
  if (unreadableFile) files.push(unreadableFile);
  return {
    async addedLiterals() { return new Set(['cost_missing']); },
    async baseLiterals() { return new Set(); },
    async productSourceFiles() { return files; },
    async scanFile(file, onLine) {
      if (file === 'src/blob.js') return 'binary';
      if (file === unreadableFile) return 'unreadable';
      onLine("const x = 'cost_missing';");
      return 'scanned';
    },
    async countSites() {
      return { lines: 0, files: 0, product_source_lines: 0, product_source_files: 0, product_source_file_list: [], missing_paths: [], unscannable_paths: [], binary_paths: [] };
    }
  };
}

test('the success return produces the binary path list rather than an empty default', async () => {
  const report = await collectEnumerationCoverage({
    verificationEvidence: { commands: [] },
    provider: providerWithBinary()
  });
  assert.notEqual(report.status, 'inconclusive');
  assert.deepEqual(report.binary_paths, ['src/blob.js']);
});

test('the unreadable early return carries the binary paths it already collected', async () => {
  const report = await collectEnumerationCoverage({
    verificationEvidence: { commands: [] },
    provider: providerWithBinary({ unreadableFile: 'src/vendor.min.js' })
  });
  assert.equal(report.status, 'inconclusive');
  assert.equal(report.inconclusive_cause, 'product_source_unreadable');
  assert.deepEqual(report.unreadable_product_source, ['src/vendor.min.js']);
  // The head scan has already run at this return, so [] here is a dropped
  // measurement, not an absent one.
  assert.deepEqual(
    report.binary_paths,
    ['src/blob.js'],
    'the unreadable return must report the binary exclusions the scan observed'
  );
});

test('every return shape of the coverage report declares binary_paths', async () => {
  // The three pre-scan returns have no binary data yet, but the key must exist
  // so a consumer never distinguishes "none excluded" from "field missing".
  const unreadableBase = await collectEnumerationCoverage({
    verificationEvidence: { commands: [] },
    provider: {
      async baseLiterals() { return null; },
      async addedLiterals() { return new Set(); },
      async productSourceFiles() { return []; },
      async scanFile() { return 'scanned'; },
      async countSites() { return { lines: 0, files: 0, product_source_lines: 0, product_source_files: 0, product_source_file_list: [], missing_paths: [], unscannable_paths: [], binary_paths: [] }; }
    }
  });
  assert.equal(unreadableBase.inconclusive_cause, 'base_ref_unresolved');
  assert.ok(Array.isArray(unreadableBase.binary_paths));

  const unreadableDiff = await collectEnumerationCoverage({
    verificationEvidence: { commands: [] },
    provider: {
      async baseLiterals() { return new Set(); },
      async addedLiterals() { return null; },
      async productSourceFiles() { return []; },
      async scanFile() { return 'scanned'; },
      async countSites() { return { lines: 0, files: 0, product_source_lines: 0, product_source_files: 0, product_source_file_list: [], missing_paths: [], unscannable_paths: [], binary_paths: [] }; }
    }
  });
  assert.equal(unreadableDiff.inconclusive_cause, 'diff_unreadable');
  assert.ok(Array.isArray(unreadableDiff.binary_paths));
});

function unreadableReport(overrides = {}) {
  return {
    status: 'inconclusive',
    inconclusive_cause: 'product_source_unreadable',
    unreadable_product_source: ['src/vendor.min.js'],
    reason: 'product source file(s) could not be read',
    required: [], missing: [], skipped: [], claims: [], rejections: [], unrecognized_scenarios: [], binary_paths: [],
    ...overrides
  };
}

const acceptedFor = (artifact) => ({
  decisions: [{
    id: 'd1', type: 'needs_review', status: 'accepted',
    source: 'gate:enumeration_coverage',
    reason: 'vendored bundle cannot be made readable',
    artifact
  }]
});

test('the unreadable-file inconclusive has no gate-specific escape', async () => {
  // An escape existed here and was reviewed twice. Both rounds found it
  // releasing more than it advertised: the product_source_unreadable early
  // return fires before the recount loop, so a consumer-side guard could not see
  // a rejection the producer had not computed yet, and an unrecounted false
  // claim shipped whenever any unrelated file happened to be unreadable.
  // Binding it to the unreadable file narrowed it without closing it — naming
  // one of several excused them all — and the two blocking-predicate exemptions
  // it needed were unreachable dead code throughout. It is deleted rather than
  // patched a third time, so this asserts its absence.
  const { buildEnumerationCoverageGate, collectUnresolvedRequiredGates } = await import('../src/pr-manager.js');
  const executionState = await import('../src/execution-state.js');

  const accepted = {
    decisions: [{
      id: 'd1', type: 'needs_review', status: 'accepted',
      source: 'gate:enumeration_coverage',
      reason: 'vendored bundle cannot be made readable',
      artifact: 'src/vendor.min.js'
    }]
  };

  // Whatever decision records exist, the status is the report's own.
  for (const decisionRecords of [undefined, accepted]) {
    const gate = buildEnumerationCoverageGate({ storyId: 's', enumerationCoverage: unreadableReport(), decisionRecords });
    assert.equal(gate.status, 'inconclusive', 'an accepted decision must not convert the status');
    assert.equal(gate.accepted_decision, undefined, 'the gate node must carry no escape decision');
    for (const [label, collect] of [
      ['pr-manager', (nodes) => collectUnresolvedRequiredGates({ nodes })],
      ['execution-state', (nodes) => executionState.collectUnresolvedRequiredGates({ nodes })]
    ]) {
      assert.ok(
        collect([gate]).map((entry) => entry.id).includes('gate:enumeration_coverage'),
        `${label} must keep reporting the unsized class as unresolved`
      );
    }
  }
});

test('the unreadable-file action routes to the generic auditable waiver, not a bespoke bypass', async () => {
  // The gate previously printed a decision-record command it did not honour,
  // then one it honoured too broadly. It now names the route that actually
  // exists at pr create/pr ship, so the remediation and the behaviour agree.
  const { buildEnumerationCoverageGate } = await import('../src/pr-manager.js');
  const actions = buildEnumerationCoverageGate({ storyId: 's', enumerationCoverage: unreadableReport() }).required_actions;
  assert.ok(actions.some((action) => /could not be read/.test(action)), 'the action must name the real cause');
  assert.ok(actions.some((action) => action.includes('src/vendor.min.js')), 'and the file it could not read');
  assert.ok(
    actions.some((action) => /--allow-needs-verification --verification-waiver/.test(action)),
    'the printed route must be the generic waiver that exists'
  );
  assert.ok(
    !actions.some((action) => /decision record .*--source gate:enumeration_coverage/.test(action)),
    'no gate-specific decision-record escape may be advertised'
  );
});

// --- regression guards on the gate's own failure modes ---------------------

test('a base tree with no enumerable literal is an empty set, not an unreadable tree', async () => {
  // git grep exits 1 when it matches nothing. Reading that as "base unknown"
  // would report inconclusive, and therefore block, on every repository whose
  // base tree has no product source literals.
  const report = await collectEnumerationCoverage({
    verificationEvidence: { commands: [] },
    provider: stubProvider({ added: [], base: [], headFiles: new Map() })
  });
  assert.equal(report.status, 'not_applicable');
});

test('a false claim fails the gate even when this change required no enumeration', async () => {
  const report = await collectEnumerationCoverage({
    verificationEvidence: evidenceWithScenarios('enumeration: grepped ghost_state across src; 40 sites found, 40 updated, 0 unchanged'),
    provider: stubProvider({
      added: [],
      base: [],
      headFiles: new Map(),
      counts: new Map([['ghost_state::src', { lines: 0, files: 0, product_source_lines: 0, product_source_files: 0, missing_paths: [], unscannable_paths: [] }]])
    })
  });
  assert.equal(report.status, 'failed');
  assert.equal(report.rejections[0].id, 'enumeration_count_mismatch');
});

test('a stale-bound enumeration claim does not close the gate', async () => {
  const report = await collectEnumerationCoverage({
    verificationEvidence: {
      commands: [
        {
          kind: 'unit',
          binding: { status: 'stale' },
          observation: {
            targets: ['src'],
            scenarios: ['enumeration: grepped cost_missing across src; 3 sites found, 3 updated, 0 unchanged'],
            values: {}
          }
        }
      ]
    },
    provider: stubProvider({
      added: ['cost_missing'],
      base: [],
      headFiles: new Map([
        ['src/a.js', "const x = 'cost_missing';"],
        ['src/b.js', "if (v === 'cost_missing') {}"]
      ]),
      counts: new Map([['cost_missing::src', { lines: 3, files: 2, product_source_lines: 3, product_source_files: 2, product_source_file_list: ['src/a.js', 'src/b.js'], missing_paths: [], unscannable_paths: [] }]])
    })
  });
  assert.equal(report.status, 'needs_evidence');
  assert.deepEqual(report.missing, ['cost_missing']);
});

test('a trivially narrow declared range cannot close a required identifier', async () => {
  // A review demonstrated a passing gate over 1 of 16 sites by declaring a
  // single file: the recount only ever validated the range the claimant chose.
  const report = await collectEnumerationCoverage({
    verificationEvidence: evidenceWithScenarios('enumeration: grepped cost_missing across src/a.js; 1 sites found, 1 updated, 0 unchanged'),
    provider: stubProvider({
      added: ['cost_missing'],
      base: [],
      headFiles: new Map([
        ['src/a.js', "const x = 'cost_missing';"],
        ['src/b.js', "if (v === 'cost_missing') {}"],
        ['src/c.js', "log('cost_missing');"]
      ]),
      counts: new Map([['cost_missing::src/a.js', { lines: 1, files: 1, product_source_lines: 1, product_source_files: 1, product_source_file_list: ['src/a.js'], missing_paths: [], unscannable_paths: [] }]])
    })
  });
  assert.equal(report.status, 'failed');
  assert.equal(report.rejections[0].id, 'enumeration_range_too_narrow');
  assert.match(report.rejections[0].reason, /never reaches 2 of 3 product source file/);
});

test('a range reaching zero product source files cannot close a required identifier', async () => {
  // A review reproduced `passed` over a range containing no src/ at all: the
  // floor compared any-file coverage against a product-source expectation.
  const report = await collectEnumerationCoverage({
    verificationEvidence: evidenceWithScenarios('enumeration: grepped cost_missing across docs; 4 sites found, 4 updated, 0 unchanged'),
    provider: stubProvider({
      added: ['cost_missing'],
      base: [],
      headFiles: new Map([
        ['src/a.js', "const x = 'cost_missing';"],
        ['src/b.js', "if (v === 'cost_missing') {}"]
      ]),
      counts: new Map([['cost_missing::docs', {
        lines: 4, files: 4, product_source_lines: 0, product_source_files: 0, product_source_file_list: [], missing_paths: [], unscannable_paths: []
      }]])
    })
  });
  assert.equal(report.status, 'failed');
  assert.equal(report.rejections[0].id, 'enumeration_range_too_narrow');
  assert.match(report.rejections[0].reason, /never reaches 2 of 2 product source file/);
});

test('an unreadable product source file makes the class size unknown, not smaller', async () => {
  const report = await collectEnumerationCoverage({
    verificationEvidence: { commands: [] },
    provider: {
      async addedLiterals() { return new Set(['cost_missing']); },
      async baseLiterals() { return new Set(); },
      async productSourceFiles() { return ['src/a.js', 'src/big.js']; },
      async scanFile(file, onLine) {
        if (file === 'src/big.js') return 'unreadable';
        onLine("const x = 'cost_missing';");
        return 'scanned';
      },
      async countSites() { return { lines: 0, files: 0, product_source_lines: 0, product_source_files: 0, product_source_file_list: [], missing_paths: [], unscannable_paths: [] }; }
    }
  });
  assert.equal(report.status, 'inconclusive');
  assert.match(report.reason, /src\/big\.js/);
});

test('a range containing a file the recount cannot read fails closed instead of undercounting', async () => {
  // grep -I has no size cap, so silently skipping a large file would make the
  // recount disagree with the command the gate tells operators to run.
  const report = await collectEnumerationCoverage({
    verificationEvidence: evidenceWithScenarios('enumeration: grepped cost_missing across docs; 3 sites found, 3 updated, 0 unchanged'),
    provider: stubProvider({
      added: ['cost_missing'],
      base: [],
      headFiles: new Map([
        ['src/a.js', "const x = 'cost_missing';"],
        ['src/b.js', "if (v === 'cost_missing') {}"]
      ]),
      counts: new Map([['cost_missing::docs', { lines: 3, files: 2, product_source_lines: 3, product_source_files: 2, product_source_file_list: ['src/a.js', 'src/b.js'], missing_paths: [], unscannable_paths: ['docs/huge-ledger.json'] }]])
    })
  });
  assert.equal(report.status, 'failed');
  assert.equal(report.rejections[0].id, 'enumeration_range_unscannable');
  assert.match(report.rejections[0].reason, /docs\/huge-ledger\.json/);
});

test('an identifier registered twice inside one file still requires enumeration', () => {
  // The file-only threshold was blind to the registration class: a gate id
  // written as a node type plus a collector allowlist entry lives in one file.
  const { required, skipped } = selectRequiredIdentifiers({
    addedLiterals: new Set(['enumeration_coverage_gate', 'truly_single_use']),
    baseLiterals: new Set(),
    headFileCounts: new Map([['enumeration_coverage_gate', 1], ['truly_single_use', 1]]),
    headSiteCounts: new Map([['enumeration_coverage_gate', 2], ['truly_single_use', 1]])
  });
  assert.deepEqual(required.map((item) => item.identifier), ['enumeration_coverage_gate']);
  assert.deepEqual(skipped.map((item) => item.reason), ['single_product_source_site']);
});

test('ordinary prose beginning with the enumeration prefix still records', () => {
  // Claiming every "enumeration:"-prefixed scenario made verify record throw
  // for text that recorded fine before this contract existed.
  const parsed = parseEnumerationScenario('enumeration: covered all statuses');
  assert.equal(parsed.matched, false);
  assert.equal(parsed.rejection, null);
});

test('count-free sweep narration is still claimed and rejected', () => {
  const parsed = parseEnumerationScenario('enumeration: swept src, skills, docs, scripts, bin and .github');
  assert.equal(parsed.matched, true);
  assert.equal(parsed.ok, false);
  assert.equal(parsed.rejection.id, 'enumeration_scenario_malformed');
});

test('an unreadable diff is inconclusive, not a silent not_applicable', async () => {
  const report = await collectEnumerationCoverage({
    baseRef: 'origin/main',
    verificationEvidence: { commands: [] },
    provider: {
      async addedLiterals() { return null; },
      async baseLiterals() { return new Set(); },
      async productSourceFiles() { return []; },
      async scanFile() { return 'skipped'; },
      async countSites() { return { lines: 0, files: 0, product_source_lines: 0, product_source_files: 0, product_source_file_list: [], missing_paths: [], unscannable_paths: [] }; }
    }
  });
  assert.equal(report.status, 'inconclusive');
  assert.match(report.reason, /diff/);
});

test('a declared path escaping the repository is treated as missing', async () => {
  const { createGitTreeProvider } = await import('../src/enumeration-evidence.js');
  const provider = createGitTreeProvider({ repoRoot: process.cwd(), baseRef: 'HEAD', headRef: 'HEAD' });
  const observed = await provider.countSites('cost_missing', ['../../..', 'src']);
  assert.ok(observed.missing_paths.includes('../../..'));
});

test('the base-tree grep pattern and the in-process scan pattern accept the same literals', async () => {
  // Producer/consumer split guard: baseLiterals() greps the base tree with a
  // literal ERE string while extractEnumerableLiterals() uses a JS regex. When
  // the two drifted apart, pre-existing namespaced literals such as
  // 'node:path' looked newly introduced and were demanded as enumerations.
  const source = await readFile(new URL('../src/enumeration-evidence.js', import.meta.url), 'utf8');
  const grepPattern = source.match(/'\['"\]\(\?:\)?.*?\['"\]'/) ?? source.match(/"\['\\"\]\[a-z\].*?\['\\"\]"/);
  assert.ok(grepPattern, 'the git grep pattern literal should be findable in the module source');
  const asRegExp = new RegExp(grepPattern[0].slice(1, -1).replaceAll('\\"', '"'), 'g');
  for (const sample of ["'needs_evidence'", "'gate:enumeration_coverage'", "'gate:e2e'"]) {
    assert.ok(asRegExp.test(sample), `base grep pattern should match ${sample}`);
    asRegExp.lastIndex = 0;
    assert.equal(extractEnumerableLiterals(sample).size, 1, `scan pattern should match ${sample}`);
  }
  // Prose and separator-free words are excluded by both.
  assert.equal(extractEnumerableLiterals("'a prose message'").size, 0);
  assert.equal(extractEnumerableLiterals("'pass'").size, 0);
});

test('node builtin specifiers are never demanded as enumerable identifiers', () => {
  assert.equal(extractEnumerableLiterals("import path from 'node:path';").size, 0);
  assert.equal(extractEnumerableLiterals("'node:child_process'").size, 0);
});

// --- supporting units ------------------------------------------------------

test('extractEnumerableLiterals keeps snake_case values and drops prose', () => {
  const literals = extractEnumerableLiterals(
    "+  const status = 'needs_evidence';\n+  throw new Error('this is a prose message');\n+  const single = 'pass';"
  );
  assert.deepEqual([...literals].sort(), ['needs_evidence']);
});

test('isProductSourcePath accepts source modules and rejects tests and docs', () => {
  assert.equal(isProductSourcePath('src/pr-manager.js'), true);
  assert.equal(isProductSourcePath('bin/vibepro.js'), true);
  assert.equal(isProductSourcePath('test/foo.test.js'), false);
  assert.equal(isProductSourcePath('docs/a.md'), false);
  assert.equal(isProductSourcePath('src/spec-schema.json'), false);
});

test('collectEnumerationScenarios reads scenarios out of recorded verification evidence', () => {
  const scenarios = collectEnumerationScenarios(evidenceWithScenarios(WELL_FORMED, 'unit: unrelated'));
  assert.equal(scenarios.length, 1);
  assert.equal(scenarios[0].claim.identifier, 'cost_missing');
  assert.equal(scenarios[0].kind, 'unit');
  assert.equal(scenarios[0].binding, 'current');
});

// --- CEA-S-2: the count is computed, never written -------------------------
//
// The counted form was never broken by the gate's recount — six review rounds
// tried. What it cost was the round trip: the numbers in it went stale every
// time any commit touched a declared path, and across this Story's eight rounds
// the same six claims were hand-recounted and rewritten eight times, three of
// them changing on a commit that touched neither identifier's meaning. The
// declaration form removes the field the number goes in.

/**
 * A provider whose tree and diff are both controllable, so the computed split
 * can be asserted against a known answer rather than against git.
 */
function computingProvider({ files = new Map(), addedLines = new Map(), diffReadable = true } = {}) {
  return {
    async addedLiterals() { return new Set(['ghost_state']); },
    async baseLiterals() { return new Set(); },
    async productSourceFiles() { return [...files.keys()].filter(isProductSourcePath); },
    async scanFile(file, onLine) {
      const content = files.get(file);
      if (content === undefined) return 'skipped';
      for (const line of content.split('\n')) onLine(line);
      return 'scanned';
    },
    async countSites(identifier, paths) {
      const matcher = new RegExp(`(?<![A-Za-z0-9_])${identifier.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![A-Za-z0-9_])`);
      const sites = [];
      const productSourceFileList = [];
      let lines = 0;
      for (const [file, content] of files) {
        if (!paths.some((p) => file === p || file.startsWith(`${p}/`))) continue;
        const hits = [];
        content.split('\n').forEach((line, index) => {
          if (matcher.test(line)) hits.push(index + 1);
        });
        if (hits.length === 0) continue;
        lines += hits.length;
        sites.push([file, hits]);
        if (isProductSourcePath(file)) productSourceFileList.push(file);
      }
      return {
        lines,
        files: sites.length,
        product_source_lines: lines,
        product_source_files: productSourceFileList.length,
        product_source_file_list: productSourceFileList.sort(),
        missing_paths: [],
        unscannable_paths: [],
        binary_paths: [],
        sites
      };
    },
    async addedLineMap() { return diffReadable ? addedLines : null; }
  };
}

const TWO_FILE_TREE = new Map([
  ['src/a.js', "const a = 'ghost_state';\nconst untouched = 'ghost_state';"],
  ['src/b.js', "export const b = 'ghost_state';"]
]);

test('CEA-S-2 a declaration parses with no counts and is marked computed', () => {
  const parsed = parseEnumerationScenario('enumeration: count ghost_state across src, test');
  assert.equal(parsed.matched, true);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.claim.identifier, 'ghost_state');
  assert.deepEqual(parsed.claim.paths, ['src', 'test']);
  assert.equal(parsed.claim.count_source, 'computed');
  // The three fields an agent used to fill in do not exist on this form.
  assert.equal(parsed.claim.found, null);
  assert.equal(parsed.claim.updated, null);
  assert.equal(parsed.claim.unchanged, null);
});

test('CEA-S-2 the legacy counted form is still accepted and marked agent_declared', () => {
  const parsed = parseEnumerationScenario(WELL_FORMED);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.claim.count_source, 'agent_declared');
  assert.equal(parsed.claim.found, 7);
});

test('CEA-S-2 the gate fills in the counts the declaration does not carry', async () => {
  const report = await collectEnumerationCoverage({
    verificationEvidence: evidenceWithScenarios(
      'enumeration: count ghost_state across src; unchanged because the second site is a doc example left as is'
    ),
    provider: computingProvider({
      files: TWO_FILE_TREE,
      // This change wrote src/a.js line 1 and src/b.js line 1; a.js line 2 predates it.
      addedLines: new Map([['src/a.js', new Set([1])], ['src/b.js', new Set([1])]])
    })
  });
  const claim = report.claims[0];
  assert.equal(claim.count_source, 'computed');
  assert.equal(claim.found, 3, 'three sites exist across the declared range');
  assert.equal(claim.updated, 2, 'two of them sit on lines this change wrote');
  assert.equal(claim.unchanged, 1, 'the third predates the change');
  assert.equal(claim.verified, true);
  // Nothing the agent typed produced any of those three numbers.
  assert.equal(claim.agent_declared_found, null);
});

test('CEA-S-2 a computed claim demands the judgment it cannot measure, and supplies the number', async () => {
  const report = await collectEnumerationCoverage({
    verificationEvidence: evidenceWithScenarios('enumeration: count ghost_state across src'),
    provider: computingProvider({
      files: TWO_FILE_TREE,
      addedLines: new Map([['src/a.js', new Set([1])], ['src/b.js', new Set([1])]])
    })
  });
  assert.equal(report.status, 'failed');
  const rejection = report.rejections.find((entry) => entry.id === 'enumeration_unchanged_reason_missing');
  assert.ok(rejection, 'leaving sites untouched without saying why must be rejected');
  // The operator is never asked to count: the rejection carries the numbers.
  assert.match(rejection.reason, /found 3 site\(s\), of which this change wrote 2 and left 1 untouched/);
});

test('CEA-S-2 an unreadable diff reports the split as unknown rather than as a full sweep', async () => {
  const report = await collectEnumerationCoverage({
    verificationEvidence: evidenceWithScenarios('enumeration: count ghost_state across src'),
    provider: computingProvider({ files: TWO_FILE_TREE, diffReadable: false })
  });
  assert.equal(report.status, 'failed');
  assert.ok(report.rejections.some((entry) => entry.id === 'enumeration_split_unknown'));
});

test('CEA-S-2 a declaration survives a tree change that invalidates the equivalent counted claim', async () => {
  // This is the whole point. Same identifier, same range, same sweep — one
  // claim writes the number and one does not. A commit adds a site.
  const before = TWO_FILE_TREE;
  const after = new Map([...TWO_FILE_TREE, ['src/c.js', "const c = 'ghost_state';"]]);
  const addedBefore = new Map([['src/a.js', new Set([1])], ['src/b.js', new Set([1])]]);
  const addedAfter = new Map([...addedBefore, ['src/c.js', new Set([1])]]);

  const declaration = 'enumeration: count ghost_state across src; unchanged because the doc example is left as is';
  const counted = 'enumeration: grepped ghost_state across src; 3 sites found, 2 updated, 1 unchanged because the doc example is left as is';

  const run = (scenario, files, addedLines) => collectEnumerationCoverage({
    verificationEvidence: evidenceWithScenarios(scenario),
    provider: computingProvider({ files, addedLines })
  });

  // Both hold on the tree they were written against.
  assert.equal((await run(declaration, before, addedBefore)).claims[0].verified, true);
  assert.equal((await run(counted, before, addedBefore)).claims[0].verified, true);

  // A commit adds one site. The counted claim is now false and must be
  // rewritten by hand; the declaration re-measures and stays true.
  const countedAfter = await run(counted, after, addedAfter);
  assert.equal(countedAfter.claims[0].verified, false);
  assert.ok(countedAfter.rejections.some((entry) => entry.id === 'enumeration_count_mismatch'));

  const declarationAfter = await run(declaration, after, addedAfter);
  assert.equal(declarationAfter.claims[0].verified, true, 'the declaration needs no rewrite');
  assert.equal(declarationAfter.claims[0].found, 4, 'and reports the new number itself');
  assert.equal(declarationAfter.claims[0].updated, 3);
});

test('CEA-S-2 the artifact distinguishes computed evidence from agent-written evidence', async () => {
  const report = await collectEnumerationCoverage({
    verificationEvidence: evidenceWithScenarios(
      'enumeration: count ghost_state across src; unchanged because the doc example is left as is',
      'enumeration: grepped ghost_state across src; 3 sites found, 2 updated, 1 unchanged because the doc example is left as is'
    ),
    provider: computingProvider({
      files: TWO_FILE_TREE,
      addedLines: new Map([['src/a.js', new Set([1])], ['src/b.js', new Set([1])]])
    })
  });
  const computed = report.claims.find((claim) => claim.count_source === 'computed');
  const declared = report.claims.find((claim) => claim.count_source === 'agent_declared');
  assert.ok(computed && declared, 'both provenances must be present and labelled');
  // Same identifier, same range, same numbers — distinguishable only because
  // the provenance is recorded rather than inferred.
  assert.equal(computed.found, declared.found);
  assert.equal(computed.agent_declared_found, null);
  assert.equal(declared.agent_declared_found, 3);
  assert.deepEqual(report.count_provenance, { computed: 1, agent_declared: 1 });
});

test('CEA-S-2 the gate publishes the form that has no number in it', () => {
  const template = scenarioTemplate('ghost_state', ['src', 'test']);
  assert.equal(template, 'enumeration: count ghost_state across src, test');
  assert.ok(!/<N>|<M>|<K>|sites found/.test(template), 'the published template must offer no field for a count');
});

test('CEA-S-2 parseAddedLineMap maps hunk headers onto head line numbers', () => {
  const map = parseAddedLineMap([
    'diff --git a/src/a.js b/src/a.js',
    '--- a/src/a.js',
    '+++ b/src/a.js',
    '@@ -0,0 +1,2 @@',
    '+one',
    '+two',
    '@@ -5,0 +10 @@',
    '+ten',
    'diff --git a/src/gone.js b/src/gone.js',
    '--- a/src/gone.js',
    '+++ /dev/null'
  ].join('\n'));
  assert.deepEqual([...map.get('src/a.js')].sort((x, y) => x - y), [1, 2, 10]);
  assert.equal(map.has('/dev/null'), false);
});

test('CEA-S-2 classifySites returns null when the diff is unavailable', () => {
  assert.equal(classifySites([['src/a.js', [1, 2]]], null), null);
  assert.deepEqual(
    classifySites([['src/a.js', [1, 2]]], new Map([['src/a.js', new Set([2])]])),
    { found: 2, updated: 1, unchanged: 1 }
  );
});

// --- CEA-S-2 round 2: findings from the three-role gate review ---------------

test('CEA-S-2 count_provenance is produced on every return shape, not only the terminal one', async () => {
  // binary_paths shipped on the success return only and had to be repaired
  // twice. count_provenance was written the same way. A field the consumer
  // reads but the producer sometimes omits is indistinguishable from a field
  // that is legitimately empty — and the inconclusive returns are exactly where
  // an operator needs to know whether any claim in play was agent-written.
  const counted = 'enumeration: grepped ghost_state across src; 3 sites found, 3 updated, 0 unchanged';
  const shapes = [
    ['base_ref_unresolved', { baseLiterals: async () => null, addedLiterals: async () => new Set() }],
    ['diff_unreadable', { baseLiterals: async () => new Set(), addedLiterals: async () => null }]
  ];
  for (const [cause, overrides] of shapes) {
    const report = await collectEnumerationCoverage({
      verificationEvidence: evidenceWithScenarios(counted),
      provider: {
        async productSourceFiles() { return []; },
        async scanFile() { return 'scanned'; },
        async countSites() { return { lines: 0, files: 0, product_source_lines: 0, product_source_files: 0, product_source_file_list: [], missing_paths: [], unscannable_paths: [], binary_paths: [], sites: [] }; },
        async addedLineMap() { return new Map(); },
        ...overrides
      }
    });
    assert.equal(report.inconclusive_cause, cause);
    assert.deepEqual(
      report.count_provenance,
      { computed: 0, agent_declared: 1 },
      `${cause} must report provenance for the claims it is carrying`
    );
  }

  const unreadable = await collectEnumerationCoverage({
    verificationEvidence: evidenceWithScenarios(counted),
    provider: { ...providerWithBinary({ unreadableFile: 'src/vendor.min.js' }), async addedLineMap() { return new Map(); } }
  });
  assert.equal(unreadable.inconclusive_cause, 'product_source_unreadable');
  assert.deepEqual(unreadable.count_provenance, { computed: 0, agent_declared: 1 });
});

test('CEA-S-2 parseAddedLineMap does not mistake added content for a file header', () => {
  // In git diff -U0 an added line whose content starts with "++ " is emitted as
  // "+++ ...". Treating every +++ line as a header dropped the real file out of
  // the map so its sites read untouched; skipping "++++" content shifted every
  // later added line one low, which can mark an untouched site as updated and
  // remove the judgment requirement entirely.
  const map = parseAddedLineMap([
    'diff --git a/src/a.js b/src/a.js',
    '--- a/src/a.js',
    '+++ b/src/a.js',
    '@@ -1,0 +2,3 @@',
    '++ bullet TOKEN_A',
    '+++plus prefixed',
    '+normal'
  ].join('\n'));
  assert.deepEqual([...(map.get('src/a.js') ?? [])].sort((x, y) => x - y), [2, 3, 4]);
  assert.equal(map.has('bullet TOKEN_A'), false, 'added content must never become a file key');
});

test('CEA-S-2 parseAddedLineMap unquotes a non-ASCII path before stripping the b/ prefix', () => {
  const map = parseAddedLineMap([
    'diff --git "a/src/\\346\\227\\245.js" "b/src/\\346\\227\\245.js"',
    '--- "a/src/\\346\\227\\245.js"',
    '+++ "b/src/\\346\\227\\245.js"',
    '@@ -0,0 +1 @@',
    '+const x = 1;'
  ].join('\n'));
  assert.deepEqual([...map.keys()], ['src/日.js'], 'a quoted path must resolve to the scan candidate spelling');
});

test('CEA-S-2 the production provider fails closed when there is no base ref to diff against', async () => {
  // The split_unknown assertion drives a stub. This drives the real provider:
  // git diff -U0 ...HEAD succeeds with empty output when baseRef is absent, so
  // returning a map there would report every site as untouched — a wrong split
  // presented as a measured one.
  const { createGitTreeProvider } = await import('../src/enumeration-evidence.js');
  // An empty base ref is the dangerous one: `git diff -U0 ...HEAD` is accepted
  // by git and returns empty output, so without the guard the map comes back
  // empty and every site reads as untouched. A null base ref happens to fail in
  // git's own argument parsing, so it proves nothing about the guard.
  const emptyBase = createGitTreeProvider({ repoRoot: process.cwd(), baseRef: '', headRef: 'HEAD' });
  assert.equal(await emptyBase.addedLineMap(), null, 'an empty base ref must be unknown, not an empty diff');

  const noBase = createGitTreeProvider({ repoRoot: process.cwd(), baseRef: null, headRef: 'HEAD' });
  assert.equal(await noBase.addedLineMap(), null);

  const badBase = createGitTreeProvider({ repoRoot: process.cwd(), baseRef: 'refs/heads/definitely-not-a-ref-xyz', headRef: 'HEAD' });
  assert.equal(await badBase.addedLineMap(), null);

  const realBase = createGitTreeProvider({ repoRoot: process.cwd(), baseRef: 'HEAD', headRef: 'HEAD' });
  assert.ok((await realBase.addedLineMap()) instanceof Map, 'a resolvable base must produce a map, not null');
});
