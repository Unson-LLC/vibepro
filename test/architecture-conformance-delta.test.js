import './support/scratch-tmpdir.js';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

import { runArchitectureConformance, detectModuleCycles } from '../src/architecture-conformance.js';
import { computeConformanceDelta, runArchitectureConformanceDelta } from '../src/architecture-conformance-delta.js';

const execFileAsync = promisify(execFile);

async function git(repo, args) {
  return execFileAsync('git', args, { cwd: repo, encoding: 'utf8' });
}

async function initGitRepo(root) {
  await git(root, ['init', '-b', 'main']);
  await git(root, ['config', 'user.email', 'vibepro@example.com']);
  await git(root, ['config', 'user.name', 'VibePro Test']);
}

async function writeFiles(root, files) {
  for (const [file, content] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(root, file)), { recursive: true });
    await writeFile(path.join(root, file), content);
  }
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
      { name: 'infra', responsibility: 'shared kernel', paths: ['src/infra.js'] },
      { name: 'extra', responsibility: 'extra module', paths: ['src/extra.js'] }
    ],
    allowed_dependencies: {
      gate: ['story', 'infra'],
      story: ['infra']
    },
    budgets: { default_max_file_lines: 500, file_line_baseline: {} },
    ...overrides
  };
}

async function writeModel(root, overrides = {}) {
  await mkdir(path.join(root, 'docs', 'architecture'), { recursive: true });
  await writeFile(
    path.join(root, 'docs', 'architecture', 'target-model.json'),
    `${JSON.stringify(defaultModel(overrides), null, 2)}\n`
  );
}

async function makeRepo(files) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vibepro-conformance-delta-'));
  await writeModel(root);
  await writeFiles(root, files);
  return root;
}

const baselineFiles = () => ({
  'src/infra.js': 'export const infra = 1;\n',
  'src/story.js': "import { infra } from './infra.js';\n\nexport const story = infra + 1;\n",
  'src/gate.js': "import { story } from './story.js';\nimport { infra } from './infra.js';\n\nexport const gate = story + infra;\n"
});

// --- CDL-S-1 / CDL-S-2: stable id + reproducibility -----------------------

test('CDL-S-1: violation id is derived from the element\'s own semantic value, not array position', async () => {
  const root = await makeRepo({
    ...baselineFiles(),
    // gate -> extra is undeclared; extra is not referenced by any module path pattern surprise,
    // it is declared, so this is a genuine undeclared_dependency plus an orphan (removed file).
    'src/gate.js': "import { story } from './story.js';\nimport { infra } from './infra.js';\nimport { extra } from './extra.js';\n\nexport const gate = story + infra + extra;\n",
    'src/extra.js': 'export const extra = 1;\n',
    'src/orphan.js': 'export const orphan = 1;\n'
  });
  const result = await runArchitectureConformance(root, { write: false });
  const undeclared = result.violations.find((v) => v.kind === 'undeclared_dependency');
  assert.equal(undeclared.id, 'undeclared_dependency:gate->extra');
  const orphan = result.violations.find((v) => v.kind === 'orphan_file');
  assert.equal(orphan.id, 'orphan_file:src/orphan.js');
  // Adding an unrelated file must not perturb an already-computed id (no array-index dependence).
  await writeFile(path.join(root, 'src/unrelated-orphan.js'), 'export const unrelated = 1;\n');
  const result2 = await runArchitectureConformance(root, { write: false });
  const undeclared2 = result2.violations.find((v) => v.kind === 'undeclared_dependency');
  assert.equal(undeclared2.id, 'undeclared_dependency:gate->extra');
  const orphan2 = result2.violations.find((v) => v.kind === 'orphan_file' && v.file === 'src/orphan.js');
  assert.equal(orphan2.id, 'orphan_file:src/orphan.js');
});

test('CDL-S-2: scanning the same commit twice yields identical violation id sets and counts', async () => {
  const root = await makeRepo({
    ...baselineFiles(),
    'src/gate.js': "import { story } from './story.js';\nimport { infra } from './infra.js';\nimport { extra } from './extra.js';\n\nexport const gate = story + infra + extra;\n",
    'src/extra.js': 'export const extra = 1;\n',
    'src/orphan.js': 'export const orphan = 1;\n'
  });
  const run1 = await runArchitectureConformance(root, { write: false });
  const run2 = await runArchitectureConformance(root, { write: false });
  assert.deepEqual(
    new Set(run1.violations.map((v) => v.id)),
    new Set(run2.violations.map((v) => v.id))
  );
  assert.equal(run1.violations.length, run2.violations.length);
  assert.equal(run1.summary.violation_count, run2.summary.violation_count);
});

// --- CDL-S-6: module-level dependency cycles -------------------------------

test('CDL-S-6: detectModuleCycles finds a normalized 2-module cycle regardless of start node', () => {
  const cyclesA = detectModuleCycles([{ from: 'b', to: 'a' }, { from: 'a', to: 'b' }]);
  const cyclesB = detectModuleCycles([{ from: 'a', to: 'b' }, { from: 'b', to: 'a' }]);
  assert.deepEqual(cyclesA, [['a', 'b']]);
  assert.deepEqual(cyclesB, [['a', 'b']]);
});

test('CDL-S-6: a real bidirectional module import produces an independent dependency_cycle violation', async () => {
  const root = await makeRepo({
    'src/infra.js': 'export const infra = 1;\n',
    'src/story.js': "import { infra } from './infra.js';\nimport { gate } from './gate.js';\n\nexport const story = infra + gate;\n",
    'src/gate.js': "import { story } from './story.js';\nimport { infra } from './infra.js';\n\nexport const gate = story + infra;\n"
  }, { allowed_dependencies: { gate: ['story', 'infra'], story: ['infra', 'gate'] } });
  const result = await runArchitectureConformance(root, { write: false });
  const cycle = result.violations.find((v) => v.kind === 'dependency_cycle');
  assert.ok(cycle, 'expected a dependency_cycle violation even though both edges are individually allowed');
  assert.deepEqual(cycle.modules, ['gate', 'story']);
  assert.equal(cycle.id, 'dependency_cycle:gate->story');
  assert.equal(result.summary.dependency_cycle_count, 1);
});

async function makeRepo2(files, overrides) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vibepro-conformance-delta-'));
  await writeModel(root, overrides);
  await writeFiles(root, files);
  return root;
}

// --- CDL-S-3 / CDL-S-4: base/head delta + multi-dimensional summary -------

test('CDL-S-3/S-4: base/head delta classifies new/resolved/unchanged by stable id with a multi-dimensional summary', async () => {
  const root = await makeRepo2(baselineFiles());
  await initGitRepo(root);
  await git(root, ['add', '.']);
  await git(root, ['commit', '-m', 'base: clean baseline']);
  await git(root, ['tag', 'base-ref']);

  // head: resolve nothing pre-existing (baseline had zero violations) and introduce one new
  // undeclared dependency (gate -> extra, extra is a declared module) plus one new orphan file
  // (src/leftover.js, which matches no module path pattern at all).
  await writeFiles(root, {
    'src/extra.js': 'export const extra = 1;\n',
    'src/leftover.js': 'export const leftover = 1;\n',
    'src/gate.js': "import { story } from './story.js';\nimport { infra } from './infra.js';\nimport { extra } from './extra.js';\n\nexport const gate = story + infra + extra;\n"
  });
  await git(root, ['add', '.']);
  await git(root, ['commit', '-m', 'head: add undeclared dependency + orphan']);

  const output = await runArchitectureConformanceDelta(root, {
    baseRef: 'base-ref',
    headRef: 'HEAD',
    write: false
  });

  assert.equal(output.base.status, 'ok');
  assert.equal(output.head.status, 'ok');
  assert.equal(output.delta.status, 'ok');
  assert.equal(output.delta.summary.new_count, 2);
  // Base declares an 'extra' module (path src/extra.js) that does not exist yet, so base itself
  // carries one pre-existing stale_pattern violation; adding src/extra.js on head resolves it.
  // This is intentional: it demonstrates new/resolved are independent dimensions, not a single
  // violation_count distance metric (a new undeclared_dependency + orphan_file must not be masked
  // by an unrelated stale_pattern resolving in the same head).
  assert.equal(output.delta.summary.resolved_count, 1);
  assert.equal(output.delta.summary.by_kind.stale_pattern.resolved, 1);
  assert.equal(output.delta.summary.new_by_severity.review, 2);
  assert.equal(output.delta.summary.by_kind.undeclared_dependency.new, 1);
  assert.equal(output.delta.summary.by_kind.orphan_file.new, 1);
  const newIds = output.delta.new.map((v) => v.id).sort();
  assert.deepEqual(newIds, ['orphan_file:src/leftover.js', 'undeclared_dependency:gate->extra'].sort());
});

test('CDL-S-3/S-4: a resolved violation on head is classified as resolved, not merely absent from a flat count', async () => {
  const root = await makeRepo2({
    ...baselineFiles(),
    'src/extra.js': 'export const extra = 1;\n',
    'src/leftover.js': 'export const leftover = 1;\n',
    'src/gate.js': "import { story } from './story.js';\nimport { infra } from './infra.js';\nimport { extra } from './extra.js';\n\nexport const gate = story + infra + extra;\n"
  });
  await initGitRepo(root);
  await git(root, ['add', '.']);
  await git(root, ['commit', '-m', 'base: has an undeclared dependency']);
  await git(root, ['tag', 'base-ref']);

  // head: remove the undeclared import (resolve it); the unrelated orphan file stays.
  await writeFiles(root, {
    'src/gate.js': "import { story } from './story.js';\nimport { infra } from './infra.js';\n\nexport const gate = story + infra;\n"
  });
  await git(root, ['add', '.']);
  await git(root, ['commit', '-m', 'head: resolve the undeclared dependency']);

  const output = await runArchitectureConformanceDelta(root, { baseRef: 'base-ref', headRef: 'HEAD', write: false });
  assert.equal(output.delta.status, 'ok');
  assert.equal(output.delta.summary.resolved_count, 1);
  assert.equal(output.delta.summary.by_kind.undeclared_dependency.resolved, 1);
  assert.equal(output.delta.resolved[0].id, 'undeclared_dependency:gate->extra');
  // The still-present orphan file (src/leftover.js, unrelated to the resolved import) is unchanged.
  assert.equal(output.delta.summary.by_kind.orphan_file.unchanged, 1);
});

// --- CDL-S-5: inconclusive semantics ---------------------------------------

test('CDL-S-5: a missing target model degrades to inconclusive, not violation_count 0', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vibepro-conformance-delta-'));
  await writeFiles(root, baselineFiles());
  await initGitRepo(root);
  await git(root, ['add', '.']);
  await git(root, ['commit', '-m', 'no target model committed']);
  await git(root, ['tag', 'base-ref']);

  const output = await runArchitectureConformanceDelta(root, { baseRef: 'base-ref', headRef: 'HEAD', write: false });
  assert.equal(output.head.status, 'inconclusive');
  assert.match(output.head.reason, /target model が存在しない/);
  assert.equal(output.delta.status, 'inconclusive');
  assert.equal(output.delta.head_status, 'inconclusive');
});

test('CDL-S-5: an unscannable scope (zero .js files) degrades to inconclusive via computeConformanceDelta', () => {
  const inconclusiveSnapshot = { status: 'inconclusive', reason: 'scope_roots (src) 配下に .js/.mjs/.cjs ファイルが見つからない' };
  const okSnapshot = { status: 'ok', result: { violations: [], summary: {} } };
  const delta = computeConformanceDelta({ base: inconclusiveSnapshot, head: okSnapshot });
  assert.equal(delta.status, 'inconclusive');
  assert.equal(delta.base_status, 'inconclusive');
  assert.equal(delta.head_status, 'ok');
  assert.match(delta.base_reason, /ファイルが見つからない/);
});

test('CDL-S-5: missing --base ref itself is reported as inconclusive rather than throwing', async () => {
  const root = await makeRepo2(baselineFiles());
  await initGitRepo(root);
  await git(root, ['add', '.']);
  await git(root, ['commit', '-m', 'only commit']);
  const output = await runArchitectureConformanceDelta(root, { baseRef: null, headRef: 'HEAD', write: false });
  assert.equal(output.base.status, 'inconclusive');
  assert.equal(output.delta.status, 'inconclusive');
});

// --- CDL-S-7: artifact persistence ------------------------------------------

test('CDL-S-7: persisting the delta writes a head conformance.json and a delta.json under .vibepro/architecture/conformance', async () => {
  const root = await makeRepo2(baselineFiles());
  await initGitRepo(root);
  await git(root, ['add', '.']);
  await git(root, ['commit', '-m', 'base']);
  await git(root, ['tag', 'base-ref']);
  await writeFiles(root, { 'src/extra.js': 'export const extra = 1;\n' });
  await git(root, ['add', '.']);
  await git(root, ['commit', '-m', 'head']);

  const output = await runArchitectureConformanceDelta(root, { baseRef: 'base-ref', headRef: 'HEAD' });
  assert.ok(output.artifacts.conformance);
  assert.ok(output.artifacts.delta);
  const { readFile } = await import('node:fs/promises');
  const conformanceOnDisk = JSON.parse(await readFile(path.join(root, output.artifacts.conformance), 'utf8'));
  assert.ok(Array.isArray(conformanceOnDisk.violations));
  const deltaOnDisk = JSON.parse(await readFile(path.join(root, output.artifacts.delta), 'utf8'));
  assert.equal(deltaOnDisk.delta.status, 'ok');
});
