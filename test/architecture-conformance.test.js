import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { runCli } from '../src/cli.js';
import {
  runArchitectureConformance,
  extractImportSpecifiers,
  resolveRelativeImport,
  buildImportDependencyEdges
} from '../src/architecture-conformance.js';

async function makeConformanceRepo({ model, graph, files } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vibepro-conformance-'));
  await mkdir(path.join(root, 'docs', 'architecture'), { recursive: true });
  await mkdir(path.join(root, 'src'), { recursive: true });
  await mkdir(path.join(root, '.vibepro', 'graphify'), { recursive: true });
  for (const [file, content] of Object.entries(files ?? defaultFiles())) {
    await mkdir(path.dirname(path.join(root, file)), { recursive: true });
    await writeFile(path.join(root, file), content);
  }
  if (model !== null) {
    await writeFile(
      path.join(root, 'docs', 'architecture', 'target-model.json'),
      typeof model === 'string' ? model : `${JSON.stringify(model ?? defaultModel(), null, 2)}\n`
    );
  }
  if (graph !== undefined && graph !== null) {
    await writeFile(
      path.join(root, '.vibepro', 'graphify', 'graph.json'),
      typeof graph === 'string' ? graph : `${JSON.stringify(graph, null, 2)}\n`
    );
  }
  return root;
}

// Default files declare their dependencies via real import statements that
// match defaultModel()'s allowed_dependencies (gate -> story, infra; story ->
// infra; infra -> nothing), so the baseline repo has zero violations.
function defaultFiles() {
  return {
    'src/infra.js': 'export const infra = 1;\n',
    'src/story.js': "import { infra } from './infra.js';\n\nexport const story = infra + 1;\n",
    'src/gate.js': "import { story } from './story.js';\nimport { infra } from './infra.js';\n\nexport const gate = story + infra;\n"
  };
}

function defaultModel(overrides = {}) {
  return {
    schema_version: '0.1.0',
    status: 'draft',
    adjudicated_by: null,
    scope_roots: ['src'],
    modules: [
      { name: 'story', responsibility: 'story', paths: ['src/story.js'] },
      { name: 'gate', responsibility: 'gate', paths: ['src/gate.js'] },
      { name: 'infra', responsibility: 'shared kernel', paths: ['src/infra.js'] }
    ],
    allowed_dependencies: {
      gate: ['story', 'infra'],
      story: ['infra'],
      infra: []
    },
    budgets: { default_max_file_lines: 1500, file_line_baseline: {} },
    ...overrides
  };
}

test('declared dependencies produce no violations', async () => {
  const root = await makeConformanceRepo();
  const result = await runArchitectureConformance(root, { write: false });
  assert.equal(result.summary.undeclared_dependency_count, 0);
  assert.equal(result.summary.violation_count, 0);
  assert.equal(result.edge_source, 'import_scan');
});

test('undeclared module dependency is reported with edge evidence from real imports', async () => {
  const root = await makeConformanceRepo({
    files: {
      ...defaultFiles(),
      // story is only allowed to depend on infra; importing gate twice (once
      // static, once dynamic) via distinct specifiers must surface as 2 edges.
      'src/story.js':
        "import { gate } from './gate.js';\n" +
        "async function lazy() { return import('./gate'); }\n" +
        'export const story = 1;\n' +
        'export { lazy };\n'
    }
  });
  const result = await runArchitectureConformance(root, { write: false });
  assert.equal(result.summary.undeclared_dependency_count, 1);
  const violation = result.violations.find((entry) => entry.kind === 'undeclared_dependency');
  assert.equal(violation.from_module, 'story');
  assert.equal(violation.to_module, 'gate');
  assert.equal(violation.edge_count, 2);
  assert.ok(violation.example_edges[0].includes('src/story.js -> src/gate.js'));
  assert.equal(violation.rule_id, 'R-004');
});

test('undeclared dependency from workspace-infra is attributed to rule R-001', async () => {
  const root = await makeConformanceRepo({
    model: defaultModel({
      modules: [
        { name: 'story', responsibility: 'story', paths: ['src/story.js'] },
        { name: 'gate', responsibility: 'gate', paths: ['src/gate.js'] },
        { name: 'workspace-infra', responsibility: 'shared kernel', paths: ['src/infra.js'] }
      ],
      allowed_dependencies: { story: ['workspace-infra'], gate: ['story', 'workspace-infra'], 'workspace-infra': [] }
    }),
    files: {
      ...defaultFiles(),
      // workspace-infra (src/infra.js) must depend on nothing; a real import
      // back into story.js is the violation this test proves gets R-001.
      'src/infra.js': "import { story } from './story.js';\nexport const infra = story + 1;\n"
    }
  });
  const result = await runArchitectureConformance(root, { write: false });
  const violation = result.violations.find((entry) => entry.kind === 'undeclared_dependency');
  assert.equal(violation.from_module, 'workspace-infra');
  assert.equal(violation.to_module, 'story');
  assert.equal(violation.rule_id, 'R-001');
});

test('undeclared dependency into cli is attributed to rule R-002', async () => {
  const root = await makeConformanceRepo({
    model: defaultModel({
      modules: [
        { name: 'story', responsibility: 'story', paths: ['src/story.js'] },
        { name: 'cli', responsibility: 'cli', paths: ['src/gate.js'] },
        { name: 'infra', responsibility: 'infra', paths: ['src/infra.js'] }
      ],
      allowed_dependencies: { story: ['infra'], cli: ['*'], infra: [] }
    }),
    files: {
      ...defaultFiles(),
      // story is only allowed to depend on infra; a real import into the cli
      // module (src/gate.js) is the violation this test proves gets R-002.
      'src/story.js': "import { gate } from './gate.js';\nexport const story = 1;\n"
    }
  });
  const result = await runArchitectureConformance(root, { write: false });
  const violation = result.violations.find((entry) => entry.kind === 'undeclared_dependency');
  assert.equal(violation.from_module, 'story');
  assert.equal(violation.to_module, 'cli');
  assert.equal(violation.rule_id, 'R-002');
});

test('undeclared dependency both from workspace-infra and into cli still prefers R-001', async () => {
  const root = await makeConformanceRepo({
    model: defaultModel({
      modules: [
        { name: 'workspace-infra', responsibility: 'shared kernel', paths: ['src/infra.js'] },
        { name: 'cli', responsibility: 'cli', paths: ['src/gate.js'] },
        { name: 'story', responsibility: 'story', paths: ['src/story.js'] }
      ],
      allowed_dependencies: { 'workspace-infra': [], cli: ['*'], story: ['workspace-infra'] }
    }),
    files: {
      ...defaultFiles(),
      // Real import from workspace-infra (src/infra.js) into the cli module
      // (src/gate.js): both derivation branches match, R-001 must win.
      'src/infra.js': "import { gate } from './gate.js';\nexport const infra = 1;\n"
    }
  });
  const result = await runArchitectureConformance(root, { write: false });
  const violation = result.violations.find((entry) => entry.kind === 'undeclared_dependency');
  assert.equal(violation.from_module, 'workspace-infra');
  assert.equal(violation.to_module, 'cli');
  assert.equal(violation.rule_id, 'R-001');
});

test('wildcard allowed dependency suppresses violations', async () => {
  const root = await makeConformanceRepo({
    model: defaultModel({
      allowed_dependencies: { story: ['*'], gate: ['story', 'infra'], infra: [] }
    }),
    files: {
      ...defaultFiles(),
      'src/story.js': "import { gate } from './gate.js';\nexport const story = 1;\n"
    }
  });
  const result = await runArchitectureConformance(root, { write: false });
  assert.equal(result.summary.undeclared_dependency_count, 0);
});

test('graphify "calls" noise does not create a violation without a real import (regression)', async () => {
  // Reproduces the PR #387 finding: Graphify attributed a "calls" edge in the
  // wrong direction (infra -> story) even though no such import exists.
  // Import-scan based conformance must ignore it.
  const root = await makeConformanceRepo({
    files: defaultFiles(),
    graph: {
      nodes: [
        { id: 'n_story', source_file: 'src/story.js' },
        { id: 'n_infra', source_file: 'src/infra.js' }
      ],
      links: [{ source: 'n_infra', target: 'n_story', relation: 'calls' }]
    }
  });
  const result = await runArchitectureConformance(root, { write: false });
  assert.equal(result.summary.undeclared_dependency_count, 0);
  assert.equal(result.summary.violation_count, 0);
  assert.equal(result.graph_context.available, true);
  assert.equal(result.graph_context.calls_edge_count, 1);
});

test('file over default line budget is a violation, baseline freezes existing giants until they grow', async () => {
  const bigBody = `${'export const x = 1;\n'.repeat(30)}`;
  const root = await makeConformanceRepo({
    model: defaultModel({
      budgets: {
        default_max_file_lines: 10,
        file_line_baseline: { 'src/gate.js': 31 }
      }
    }),
    files: {
      'src/story.js': bigBody,
      'src/gate.js': bigBody,
      'src/infra.js': 'export const infra = 1;\n'
    }
  });
  const result = await runArchitectureConformance(root, { write: false });
  const budgetViolations = result.violations.filter((entry) => entry.kind === 'budget_violation');
  assert.equal(budgetViolations.length, 1);
  assert.equal(budgetViolations[0].file, 'src/story.js');
  assert.equal(budgetViolations[0].baseline, false);
  assert.equal(budgetViolations[0].rule_id, 'R-003');
});

test('growth beyond frozen baseline is a violation', async () => {
  const root = await makeConformanceRepo({
    model: defaultModel({
      budgets: {
        default_max_file_lines: 100,
        file_line_baseline: { 'src/gate.js': 3 }
      }
    }),
    files: {
      'src/story.js': 'export const story = 1;\n',
      'src/gate.js': `${'export const x = 1;\n'.repeat(10)}`,
      'src/infra.js': 'export const infra = 1;\n'
    }
  });
  const result = await runArchitectureConformance(root, { write: false });
  const violation = result.violations.find((entry) => entry.kind === 'budget_violation');
  assert.equal(violation.file, 'src/gate.js');
  assert.equal(violation.baseline, true);
  assert.ok(violation.summary.includes('baseline'));
  assert.equal(violation.rule_id, 'R-003');
});

test('module max_files budget is enforced', async () => {
  const root = await makeConformanceRepo({
    model: defaultModel({
      modules: [
        { name: 'story', responsibility: 'story', paths: ['src/story.js', 'src/gate.js'], max_files: 1 },
        { name: 'infra', responsibility: 'infra', paths: ['src/infra.js'] }
      ],
      allowed_dependencies: { story: ['infra'], infra: [] }
    })
  });
  const result = await runArchitectureConformance(root, { write: false });
  const violation = result.violations.find((entry) => entry.kind === 'budget_violation' && entry.module === 'story');
  assert.ok(violation);
  assert.equal(violation.file_count, 2);
  assert.equal(violation.rule_id, 'R-003');
});

test('files outside every module are orphans and unmatched patterns are stale', async () => {
  const root = await makeConformanceRepo({
    model: defaultModel({
      modules: [
        { name: 'story', responsibility: 'story', paths: ['src/story.js', 'src/removed-file.js'] },
        { name: 'infra', responsibility: 'infra', paths: ['src/infra.js'] }
      ],
      allowed_dependencies: { story: ['infra'], infra: [] }
    })
  });
  const result = await runArchitectureConformance(root, { write: false });
  const orphan = result.violations.find((entry) => entry.kind === 'orphan_file');
  assert.equal(orphan.file, 'src/gate.js');
  assert.equal(orphan.rule_id, null);
  const stale = result.violations.find((entry) => entry.kind === 'stale_pattern');
  assert.equal(stale.pattern, 'src/removed-file.js');
  assert.equal(stale.rule_id, null);
});

test('draft model carries advisory notice, adjudicated model does not', async () => {
  const draftRoot = await makeConformanceRepo();
  const draftResult = await runArchitectureConformance(draftRoot, { write: false });
  assert.ok(draftResult.advisory_notice);
  const adjudicatedRoot = await makeConformanceRepo({
    model: defaultModel({ status: 'adjudicated', adjudicated_by: 'sato_keigo' })
  });
  const adjudicatedResult = await runArchitectureConformance(adjudicatedRoot, { write: false });
  assert.equal(adjudicatedResult.advisory_notice, null);
});

test('missing graph.json is optional context and does not fail the run', async () => {
  const root = await makeConformanceRepo({ graph: null });
  const result = await runArchitectureConformance(root, { write: false });
  assert.equal(result.graph_context.available, false);
  assert.equal(result.edge_source, 'import_scan');
  assert.equal(result.summary.violation_count, 0);
});

test('missing target model fails loud', async () => {
  const root = await makeConformanceRepo({ model: null });
  await assert.rejects(
    () => runArchitectureConformance(root, { write: false }),
    /target model が存在しない/
  );
});

test('scope_roots resolving to zero .js/.mjs/.cjs files fails loud instead of a silent zero-violation success', async () => {
  // Regression test for a genuinely new fail-loud path introduced by the
  // import-scan migration: unlike the prior implementation (which would
  // silently return violation_count=0 for an unscannable scope), the scan
  // cannot proceed at all if there is nothing to scan, so it must throw
  // rather than report a false-positive-free result.
  const root = await makeConformanceRepo({ files: {} });
  await assert.rejects(
    () => runArchitectureConformance(root, { write: false }),
    /scope_roots.*配下に.*ファイルが見つからない/
  );
});

test('invalid graph or model json fails loud', async () => {
  const badGraphRoot = await makeConformanceRepo({ graph: '{not json' });
  await assert.rejects(
    () => runArchitectureConformance(badGraphRoot, { write: false }),
    /parseに失敗/
  );
  const badModelRoot = await makeConformanceRepo({ model: '{not json' });
  await assert.rejects(
    () => runArchitectureConformance(badModelRoot, { write: false }),
    /JSONが不正/
  );
});

test('integration e2e: cli conformance is dry-run by default and strict only via --strict', async () => {
  const root = await makeConformanceRepo({
    files: {
      ...defaultFiles(),
      'src/story.js': "import { gate } from './gate.js';\nexport const story = 1;\n"
    }
  });
  const io = { stdout: { write: () => {} }, stderr: { write: () => {} } };
  const dryRun = await runCli(['architecture', 'conformance', root], io);
  assert.equal(dryRun.exitCode, 0);
  assert.equal(dryRun.result.summary.undeclared_dependency_count, 1);
  const strict = await runCli(['architecture', 'conformance', root, '--strict']);
  assert.equal(strict.exitCode, 2);
});

test('integration e2e: cli conformance writes json and markdown artifacts', async () => {
  const root = await makeConformanceRepo();
  const io = { stdout: { write: () => {} }, stderr: { write: () => {} } };
  const run = await runCli(['architecture', 'conformance', root, '--json'], io);
  assert.equal(run.exitCode, 0);
  assert.equal(run.result.artifacts.json, '.vibepro/architecture/conformance/conformance.json');
  assert.equal(run.result.artifacts.markdown, '.vibepro/architecture/conformance/conformance.md');
});

// --- import scanner unit tests -------------------------------------------

test('extractImportSpecifiers finds static import, export-from, dynamic import, and require', () => {
  const source = [
    "import def, { a, b } from './a.js';",
    "import '../side-effect.js';",
    "export { c } from './c.js';",
    "export * from './d.js';",
    "const lazy = () => import('./e.js');",
    "const legacy = require('./f.js');",
    "import fs from 'node:fs';",
    "import chalk from 'chalk';",
    '// import { ghost } from \'./ghost.js\';',
    '/* import { ghost2 } from \'./ghost2.js\'; */',
    "const url = 'https://example.com/x';"
  ].join('\n');
  const specifiers = extractImportSpecifiers(source);
  assert.deepEqual(
    new Set(specifiers),
    new Set(['./a.js', '../side-effect.js', './c.js', './d.js', './e.js', './f.js', 'node:fs', 'chalk'])
  );
  assert.ok(!specifiers.includes('./ghost.js'), 'commented-out import must not be extracted');
  assert.ok(!specifiers.includes('./ghost2.js'), 'block-commented import must not be extracted');
});

test('resolveRelativeImport resolves exact file, missing extension, and directory index', () => {
  const allFiles = new Set(['src/a.js', 'src/b/index.js', 'src/c.mjs']);
  assert.equal(resolveRelativeImport('src/story.js', './a.js', allFiles), 'src/a.js');
  assert.equal(resolveRelativeImport('src/story.js', './a', allFiles), 'src/a.js');
  assert.equal(resolveRelativeImport('src/story.js', './b', allFiles), 'src/b/index.js');
  assert.equal(resolveRelativeImport('src/story.js', './c', allFiles), 'src/c.mjs');
  assert.equal(resolveRelativeImport('src/story.js', './does-not-exist', allFiles), null);
});

test('buildImportDependencyEdges excludes node builtins and npm packages, includes only resolvable relative imports', () => {
  const jsFiles = [
    {
      file: 'src/story.js',
      content: "import fs from 'node:fs';\nimport chalk from 'chalk';\nimport { infra } from './infra.js';\n"
    },
    { file: 'src/infra.js', content: 'export const infra = 1;\n' }
  ];
  const allFiles = new Set(['src/story.js', 'src/infra.js']);
  const { edges, unresolvedReferenceCount } = buildImportDependencyEdges({ jsFiles, allFiles });
  assert.deepEqual(edges, [{ source_file: 'src/story.js', target_file: 'src/infra.js' }]);
  assert.equal(unresolvedReferenceCount, 0);
});

test('buildImportDependencyEdges counts unresolved relative references without throwing', () => {
  const jsFiles = [{ file: 'src/story.js', content: "import { x } from './missing.js';\n" }];
  const allFiles = new Set(['src/story.js']);
  const { edges, unresolvedReferenceCount } = buildImportDependencyEdges({ jsFiles, allFiles });
  assert.equal(edges.length, 0);
  assert.equal(unresolvedReferenceCount, 1);
});
