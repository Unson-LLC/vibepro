import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { runCli } from '../src/cli.js';
import { runArchitectureConformance } from '../src/architecture-conformance.js';

async function makeConformanceRepo({ model, graph, files } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vibepro-conformance-'));
  await mkdir(path.join(root, 'docs', 'architecture'), { recursive: true });
  await mkdir(path.join(root, 'src'), { recursive: true });
  await mkdir(path.join(root, '.vibepro', 'graphify'), { recursive: true });
  for (const [file, content] of Object.entries(files ?? defaultFiles())) {
    await writeFile(path.join(root, file), content);
  }
  if (model !== null) {
    await writeFile(
      path.join(root, 'docs', 'architecture', 'target-model.json'),
      typeof model === 'string' ? model : `${JSON.stringify(model ?? defaultModel(), null, 2)}\n`
    );
  }
  if (graph !== null) {
    await writeFile(
      path.join(root, '.vibepro', 'graphify', 'graph.json'),
      typeof graph === 'string' ? graph : `${JSON.stringify(graph ?? defaultGraph(), null, 2)}\n`
    );
  }
  return root;
}

function defaultFiles() {
  return {
    'src/story.js': 'export const story = 1;\n',
    'src/gate.js': 'export const gate = 1;\n',
    'src/infra.js': 'export const infra = 1;\n'
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

function defaultGraph({ links } = {}) {
  return {
    nodes: [
      { id: 'n_story', source_file: 'src/story.js' },
      { id: 'n_gate', source_file: 'src/gate.js' },
      { id: 'n_infra', source_file: 'src/infra.js' }
    ],
    links: links ?? [
      { source: 'n_gate', target: 'n_story', relation: 'calls' },
      { source: 'n_story', target: 'n_infra', relation: 'calls' }
    ]
  };
}

test('declared dependencies produce no violations', async () => {
  const root = await makeConformanceRepo();
  const result = await runArchitectureConformance(root, { write: false });
  assert.equal(result.summary.undeclared_dependency_count, 0);
  assert.equal(result.summary.violation_count, 0);
});

test('undeclared module dependency is reported with edge evidence', async () => {
  const root = await makeConformanceRepo({
    graph: defaultGraph({
      links: [
        { source: 'n_story', target: 'n_gate', relation: 'calls' },
        { source: 'n_story', target: 'n_gate', relation: 'imports_from' }
      ]
    })
  });
  const result = await runArchitectureConformance(root, { write: false });
  assert.equal(result.summary.undeclared_dependency_count, 1);
  const violation = result.violations.find((entry) => entry.kind === 'undeclared_dependency');
  assert.equal(violation.from_module, 'story');
  assert.equal(violation.to_module, 'gate');
  assert.equal(violation.edge_count, 2);
  assert.ok(violation.example_edges[0].includes('src/story.js -> src/gate.js'));
});

test('wildcard allowed dependency suppresses violations', async () => {
  const root = await makeConformanceRepo({
    model: defaultModel({
      allowed_dependencies: { story: ['*'], gate: ['story', 'infra'], infra: [] }
    }),
    graph: defaultGraph({
      links: [{ source: 'n_story', target: 'n_gate', relation: 'calls' }]
    })
  });
  const result = await runArchitectureConformance(root, { write: false });
  assert.equal(result.summary.undeclared_dependency_count, 0);
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
  const stale = result.violations.find((entry) => entry.kind === 'stale_pattern');
  assert.equal(stale.pattern, 'src/removed-file.js');
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

test('missing graph.json fails loud instead of returning empty success', async () => {
  const root = await makeConformanceRepo({ graph: null });
  await assert.rejects(
    () => runArchitectureConformance(root, { write: false }),
    /graph\.json が存在しない/
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

test('cli conformance is dry-run by default and strict only via --strict', async () => {
  const root = await makeConformanceRepo({
    graph: defaultGraph({
      links: [{ source: 'n_story', target: 'n_gate', relation: 'calls' }]
    })
  });
  const io = { stdout: { write: () => {} }, stderr: { write: () => {} } };
  const dryRun = await runCli(['architecture', 'conformance', root], io);
  assert.equal(dryRun.exitCode, 0);
  assert.equal(dryRun.result.summary.undeclared_dependency_count, 1);
  const strict = await runCli(['architecture', 'conformance', root, '--strict'], io);
  assert.equal(strict.exitCode, 2);
});

test('cli conformance writes json and markdown artifacts', async () => {
  const root = await makeConformanceRepo();
  const io = { stdout: { write: () => {} }, stderr: { write: () => {} } };
  const run = await runCli(['architecture', 'conformance', root, '--json'], io);
  assert.equal(run.exitCode, 0);
  assert.equal(run.result.artifacts.json, '.vibepro/architecture/conformance/conformance.json');
  assert.equal(run.result.artifacts.markdown, '.vibepro/architecture/conformance/conformance.md');
});
