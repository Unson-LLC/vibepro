import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  collectEnumerationCoverage,
  collectEnumerationScenarios,
  extractEnumerableLiterals,
  isProductSourcePath,
  parseEnumerationScenario,
  reproductionCommand,
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
    async readTextFile(file) {
      return headFiles.get(file) ?? null;
    },
    async countSites(identifier, paths) {
      const key = `${identifier}::${paths.join(',')}`;
      return counts.get(key) ?? { lines: 0, files: 0, missing_paths: [] };
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
      counts: new Map([['cost_missing::src', { lines: 3, files: 2, missing_paths: [] }]])
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
      counts: new Map([['cost_missing::src,ghost', { lines: 3, files: 2, missing_paths: ['ghost'] }]])
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
      counts: new Map([['cost_missing::src', { lines: 3, files: 2, missing_paths: [] }]])
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
    headFileCounts: new Map([['cost_missing', 3], ['local_only', 1], ['already_known', 9]])
  });
  assert.deepEqual(required.map((item) => item.identifier), ['cost_missing']);
  assert.deepEqual(
    skipped.map((item) => [item.identifier, item.reason]).sort(),
    [['already_known', 'pre_existing_in_base'], ['local_only', 'single_product_source_file']]
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
      counts: new Map([['other_thing::src', { lines: 2, files: 1, missing_paths: [] }]])
    })
  });
  assert.equal(report.status, 'needs_evidence');
  assert.deepEqual(report.missing, ['cost_missing']);
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
      counts: new Map([['ghost_state::src', { lines: 0, files: 0, missing_paths: [] }]])
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
      counts: new Map([['cost_missing::src', { lines: 3, files: 2, missing_paths: [] }]])
    })
  });
  assert.equal(report.status, 'needs_evidence');
  assert.deepEqual(report.missing, ['cost_missing']);
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
