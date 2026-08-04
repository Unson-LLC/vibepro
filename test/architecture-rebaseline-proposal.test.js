import './support/scratch-tmpdir.js';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { runCli } from '../src/cli.js';
import {
  assignFilesToModules,
  loadTargetModel,
  runArchitectureConformance
} from '../src/architecture-conformance.js';
import { runArchitectureConformanceDelta } from '../src/architecture-conformance-delta.js';
import { runRebaselineProposal } from '../src/architecture-rebaseline-proposal.js';

const execFileAsync = promisify(execFile);

async function makeRepo({ model, files } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vibepro-rebaseline-'));
  await mkdir(path.join(root, 'docs', 'architecture'), { recursive: true });
  await mkdir(path.join(root, 'src'), { recursive: true });
  for (const [file, content] of Object.entries(files ?? defaultFiles())) {
    await mkdir(path.dirname(path.join(root, file)), { recursive: true });
    await writeFile(path.join(root, file), content);
  }
  await writeFile(
    path.join(root, 'docs', 'architecture', 'target-model.json'),
    typeof model === 'string' ? model : `${JSON.stringify(model ?? defaultModel(), null, 2)}\n`
  );
  return root;
}

// `orphan.js` is imported only by review.js (consumer edge) and imports infra.js (dependency edge),
// so `review` must outrank `infra`. `cli.js` also imports it, which must NOT make `cli` a candidate
// (dispatcher exclusion). `lonely.js` has no edges at all, so it has no candidate.
function defaultFiles() {
  return {
    'src/infra.js': 'export const infra = 1;\n',
    'src/gate.js': "import { infra } from './infra.js';\n\nexport const gate = infra;\n",
    'src/review.js': "import { infra } from './infra.js';\nimport { orphan } from './orphan.js';\n\nexport const review = infra + orphan;\n",
    'src/orphan.js': "import { infra } from './infra.js';\n\nexport const orphan = infra;\n",
    'src/lonely.js': 'export const lonely = 1;\n',
    'src/cli.js': "import { orphan } from './orphan.js';\nimport { gate } from './gate.js';\n\nexport const cli = orphan + gate;\n"
  };
}

function defaultModel(overrides = {}) {
  return {
    schema_version: '0.1.0',
    model_version: 3,
    status: 'adjudicated',
    adjudicated_by: 'tester',
    governance: {
      machine_maintainable: ['既存モジュールへの孤児ファイルの割当'],
      human_adjudicated: ['モジュールの新設'],
      machine_projection: ['承認結果の反映']
    },
    scope_roots: ['src'],
    modules: [
      { name: 'cli', responsibility: 'entrypoint', paths: ['src/cli.js'] },
      { name: 'review', responsibility: 'review', paths: ['src/review.js'] },
      { name: 'gate', responsibility: 'gate', paths: ['src/gate.js'] },
      { name: 'infra', responsibility: 'shared kernel', paths: ['src/infra.js'] }
    ],
    allowed_dependencies: {
      cli: ['*'],
      review: ['infra'],
      gate: ['infra'],
      infra: []
    },
    budgets: { default_max_file_lines: 1500, file_line_baseline: {} },
    ...overrides
  };
}

test('TMG-S-2: model_version is read, surfaced on conformance output, and optional', async () => {
  const root = await makeRepo();
  const model = await loadTargetModel(path.join(root, 'docs', 'architecture', 'target-model.json'));
  assert.equal(model.model_version, 3);

  const result = await runArchitectureConformance(root, { write: false });
  assert.equal(result.model.version, 3);

  const unversioned = await makeRepo({ model: defaultModel({ model_version: undefined }) });
  const unversionedResult = await runArchitectureConformance(unversioned, { write: false });
  assert.equal(unversionedResult.model.version, null);
});

test('TMG-S-2: malformed model_version fails loudly instead of degrading to unversioned', async () => {
  for (const bad of [0, -1, 2.5, '2']) {
    const root = await makeRepo({ model: defaultModel({ model_version: bad }) });
    await assert.rejects(
      () => runArchitectureConformance(root, { write: false }),
      /model_version は1以上の整数が必須/
    );
  }
});

test('TMG-S-3: delta reports the model version on both sides and flags a revision since the last recorded measurement', async () => {
  const root = await makeRepo();
  const modelPath = path.join(root, 'docs', 'architecture', 'target-model.json');
  const git = (args) => execFileAsync('git', args, { cwd: root, encoding: 'utf8' });
  await git(['init', '-b', 'main']);
  await git(['config', 'user.email', 'vibepro@example.com']);
  await git(['config', 'user.name', 'VibePro Test']);
  await git(['add', '.']);
  await git(['commit', '-m', 'base at model_version 3']);

  // First recorded measurement: nothing to compare the yardstick against.
  const first = await runArchitectureConformanceDelta(root, { baseRef: 'HEAD' });
  assert.equal(first.base.model_version, 3);
  assert.equal(first.head.model_version, 3);
  assert.equal(first.previous_model_version, null);
  assert.equal(first.model_version_changed, false);

  const unchanged = await runArchitectureConformanceDelta(root, { baseRef: 'HEAD' });
  assert.equal(unchanged.previous_model_version, 3);
  assert.equal(unchanged.model_version_changed, false);

  // A human-adjudicated revision bumps model_version: violation counts measured after it are not on
  // the same axis as the previously recorded ones, and the ledger must say so.
  await writeFile(modelPath, `${JSON.stringify(defaultModel({ model_version: 4 }), null, 2)}\n`);
  const bumped = await runArchitectureConformanceDelta(root, { baseRef: 'HEAD' });
  assert.equal(bumped.previous_model_version, 3);
  assert.equal(bumped.head.model_version, 4);
  // Both sides of a single delta always use the current model: a fixed yardstick isolates code
  // change from model change.
  assert.equal(bumped.base.model_version, 4);
  assert.equal(bumped.model_version_changed, true);
});

test('TMG-S-4: orphan assignment ranks consumers over dependencies and excludes dispatcher modules', async () => {
  const root = await makeRepo();
  const proposal = await runRebaselineProposal(root, { write: false });

  const orphan = proposal.orphan_assignments.find((entry) => entry.file === 'src/orphan.js');
  assert.equal(orphan.candidates[0].module, 'review');
  assert.equal(orphan.candidates[0].score, 2);
  // cli imports src/orphan.js but is declared with '*', so it must never be proposed as the home.
  assert.deepEqual(orphan.candidates.map((entry) => entry.module), ['review', 'infra']);
  assert.deepEqual(proposal.ranking.excluded_dispatcher_modules, ['cli']);
  assert.ok(orphan.candidates[0].evidence.includes('src/review.js -> src/orphan.js'));
  assert.equal(orphan.recommendation.action, 'machine_maintainable_assign');
  assert.equal(orphan.recommendation.module, 'review');

  const lonely = proposal.orphan_assignments.find((entry) => entry.file === 'src/lonely.js');
  assert.deepEqual(lonely.candidates, []);
  assert.equal(lonely.recommendation.action, 'human_adjudication');
});

test('TMG-S-5: assignment candidates carry the module dependencies the assignment would induce', async () => {
  const root = await makeRepo();
  const proposal = await runRebaselineProposal(root, { write: false });
  const orphan = proposal.orphan_assignments.find((entry) => entry.file === 'src/orphan.js');

  const reviewCandidate = orphan.candidates.find((entry) => entry.module === 'review');
  const reviewToInfra = reviewCandidate.induced_dependencies.find(
    (entry) => entry.from_module === 'review' && entry.to_module === 'infra'
  );
  assert.equal(reviewToInfra.allowed, true);
  assert.equal(reviewToInfra.creates_new_violation, false);

  // Putting the orphan in `infra` would make infra depend on review (R-001 style inversion): a
  // brand-new violating pair that did not exist while the file was invisible to the model.
  const infraCandidate = orphan.candidates.find((entry) => entry.module === 'infra');
  const reviewToInfraHome = infraCandidate.induced_dependencies.find(
    (entry) => entry.from_module === 'review' && entry.to_module === 'infra'
  );
  assert.equal(reviewToInfraHome.allowed, true);
  const infraToNothing = infraCandidate.induced_dependencies.filter((entry) => entry.from_module === 'infra');
  assert.deepEqual(infraToNothing, []);
});

test('TMG-S-5: an assignment that would create a new violating pair is not recommended as machine maintainable', async () => {
  // The orphan is consumed only by gate (so `gate` is the unambiguous top candidate) but depends on
  // review, and `gate` is not allowed to depend on `review`: homing it in gate creates a brand-new
  // gate -> review pair that did not exist while the file was invisible to the model.
  const root = await makeRepo({
    files: {
      ...defaultFiles(),
      'src/review.js': "import { infra } from './infra.js';\n\nexport const review = infra;\n",
      'src/orphan.js': "import { review } from './review.js';\n\nexport const orphan = review;\n",
      'src/gate.js': "import { infra } from './infra.js';\nimport { orphan } from './orphan.js';\n\nexport const gate = infra + orphan;\n"
    }
  });
  const proposal = await runRebaselineProposal(root, { write: false });
  const orphan = proposal.orphan_assignments.find((entry) => entry.file === 'src/orphan.js');
  const top = orphan.candidates[0];
  assert.equal(top.module, 'gate');
  const induced = top.induced_dependencies.find(
    (entry) => entry.from_module === 'gate' && entry.to_module === 'review'
  );
  assert.equal(induced.creates_new_violation, true);
  assert.equal(orphan.recommendation.action, 'human_adjudication');
  assert.match(orphan.recommendation.reason, /新規の未宣言依存ペア/);
});

test('TMG-S-4: orphan clusters group mutually importing orphans and are flagged human adjudicated', async () => {
  const root = await makeRepo({
    files: {
      ...defaultFiles(),
      'src/orphan-a.js': "import { orphanB } from './orphan-b.js';\n\nexport const orphanA = orphanB;\n",
      'src/orphan-b.js': 'export const orphanB = 1;\n'
    }
  });
  const proposal = await runRebaselineProposal(root, { write: false });
  const cluster = proposal.orphan_clusters.find((entry) => entry.member_count > 1);
  assert.deepEqual(cluster.members, ['src/orphan-a.js', 'src/orphan-b.js']);
  assert.equal(cluster.id, 'orphan_cluster:src/orphan-a.js');
  assert.equal(cluster.new_module_candidate, true);
  assert.equal(cluster.authority, 'human_adjudicated');
  assert.equal(cluster.internal_edge_count, 1);

  const singleton = proposal.orphan_clusters.find((entry) => entry.id === 'orphan_cluster:src/lonely.js');
  assert.equal(singleton.new_module_candidate, false);
  assert.equal(singleton.authority, 'machine_maintainable');

  assert.ok(proposal.human_adjudication_required.some(
    (item) => item.kind === 'new_module_candidate' && item.id === cluster.id
  ));
});

test('TMG-S-4: undeclared dependencies are triaged into declare candidates and must-resolve entries', async () => {
  const root = await makeRepo({
    model: defaultModel({
      modules: [
        { name: 'cli', responsibility: 'entrypoint', paths: ['src/cli.js'] },
        { name: 'review', responsibility: 'review', paths: ['src/review.js'] },
        { name: 'gate', responsibility: 'gate', paths: ['src/gate.js'] },
        { name: 'workspace-infra', responsibility: 'shared kernel', paths: ['src/infra.js'] }
      ],
      allowed_dependencies: { cli: ['*'], review: ['workspace-infra'], gate: ['workspace-infra'], 'workspace-infra': [] }
    }),
    files: {
      ...defaultFiles(),
      // R-001 inversion: the kernel imports upward.
      'src/infra.js': "import { gate } from './gate.js';\n\nexport const infra = gate;\n",
      // R-002 inversion: a non-cli module imports the entrypoint.
      'src/gate.js': "import { cli } from './cli.js';\n\nexport const gate = 1;\n",
      // R-004, reverse not declared: legalizable by declaration.
      'src/review.js': "import { gate } from './gate.js';\nimport { orphan } from './orphan.js';\n\nexport const review = gate + orphan;\n"
    }
  });
  const proposal = await runRebaselineProposal(root, { write: false });
  const byId = new Map(proposal.dependency_triage.map((entry) => [entry.id, entry]));

  const inversion = byId.get('undeclared_dependency:workspace-infra->gate');
  assert.equal(inversion.rule_id, 'R-001');
  assert.equal(inversion.classification, 'resolve');

  const cliInversion = byId.get('undeclared_dependency:gate->cli');
  assert.equal(cliInversion.rule_id, 'R-002');
  assert.equal(cliInversion.classification, 'resolve');

  const declarable = byId.get('undeclared_dependency:review->gate');
  assert.equal(declarable.rule_id, 'R-004');
  assert.equal(declarable.classification, 'declare_candidate');
  assert.equal(declarable.authority, 'human_adjudicated');
  assert.ok(proposal.human_adjudication_required.some(
    (item) => item.kind === 'new_allowed_dependency' && item.id === declarable.id
  ));
});

test('TMG-S-4: declaring a dependency whose reverse is already declared is classified as resolve, not declare', async () => {
  const root = await makeRepo({
    model: defaultModel({
      // gate -> review is declared, so review -> gate must not be proposed for declaration.
      allowed_dependencies: { cli: ['*'], review: ['infra'], gate: ['infra', 'review'], infra: [] },
      modules: [
        { name: 'cli', responsibility: 'entrypoint', paths: ['src/cli.js'] },
        { name: 'review', responsibility: 'review', paths: ['src/review.js'] },
        { name: 'gate', responsibility: 'gate', paths: ['src/gate.js'] },
        { name: 'infra', responsibility: 'shared kernel', paths: ['src/infra.js'] }
      ]
    }),
    files: {
      ...defaultFiles(),
      'src/gate.js': "import { review } from './review.js';\n\nexport const gate = review;\n",
      'src/review.js': "import { gate } from './gate.js';\nimport { orphan } from './orphan.js';\n\nexport const review = orphan;\n"
    }
  });
  const proposal = await runRebaselineProposal(root, { write: false });
  const entry = proposal.dependency_triage.find((item) => item.id === 'undeclared_dependency:review->gate');
  assert.equal(entry.reverse_declared, true);
  assert.equal(entry.classification, 'resolve');
  assert.match(entry.reason, /宣言済みの循環/);
});

test('TMG-S-6: proposal generation is deterministic apart from generated_at', async () => {
  const root = await makeRepo();
  const first = await runRebaselineProposal(root, { write: false });
  const second = await runRebaselineProposal(root, { write: false });
  delete first.generated_at;
  delete second.generated_at;
  assert.deepEqual(first, second);
});

test('TMG-S-4: cli writes proposal artifacts and an optional committed snapshot', async () => {
  const root = await makeRepo();
  const stdout = [];
  const result = await runCli(['architecture', 'rebaseline-proposal', root, '--output', 'docs/architecture/proposal-snapshot.md'], {
    stdout: { write: (chunk) => stdout.push(chunk) }
  });
  assert.equal(result.exitCode, 0);
  assert.equal(result.result.artifacts.json, '.vibepro/architecture/rebaseline/proposal.json');
  assert.equal(result.result.artifacts.snapshot, 'docs/architecture/proposal-snapshot.md');
  const persisted = JSON.parse(await readFile(path.join(root, '.vibepro', 'architecture', 'rebaseline', 'proposal.json'), 'utf8'));
  assert.equal(persisted.model.version, 3);
  assert.equal(persisted.model.governance_present, true);
  const snapshot = await readFile(path.join(root, 'docs', 'architecture', 'proposal-snapshot.md'), 'utf8');
  assert.match(snapshot, /# Target Model Rebaseline Proposal/);
  assert.match(stdout.join(''), /孤児/);
});

test('TMG-S-1/S-8: the repository target model declares the governance three-way split and a model version', async () => {
  const repoRoot = path.resolve(import.meta.dirname, '..');
  const model = JSON.parse(
    await readFile(path.join(repoRoot, 'docs', 'architecture', 'target-model.json'), 'utf8')
  );
  assert.equal(model.model_version, 1);
  assert.ok(Array.isArray(model.governance.machine_maintainable) && model.governance.machine_maintainable.length > 0);
  assert.ok(Array.isArray(model.governance.human_adjudicated) && model.governance.human_adjudicated.length > 0);
  assert.ok(Array.isArray(model.governance.machine_projection) && model.governance.machine_projection.length > 0);
  // rules[] is the human-adjudicated normative core; this story must not have touched it.
  assert.deepEqual(model.rules.map((rule) => rule.id), ['R-001', 'R-002', 'R-003', 'R-004']);
  for (const rule of model.rules) {
    assert.equal(rule.status, 'adjudicated');
    assert.equal(rule.adjudicated_at, '2026-07-22');
  }

  // TMG-S-8: the machine-maintainable assignments applied by this story must actually take the
  // files out of the orphan set, and must not have touched allowed_dependencies.
  const assigned = [
    ['src/architecture-conformance-delta.js', 'architecture'],
    ['src/architecture-rebaseline-proposal.js', 'architecture'],
    ['src/docs-only-change.js', 'evidence'],
    ['src/story-id.js', 'workspace-infra'],
    ['src/managed-command-executor.js', 'workspace-infra']
  ];
  const { moduleByFile, orphans } = assignFilesToModules(assigned.map(([file]) => file), model.modules);
  assert.deepEqual(orphans, []);
  for (const [file, expectedModule] of assigned) {
    assert.equal(moduleByFile.get(file), expectedModule, `${file} must belong to ${expectedModule}`);
  }
  assert.equal(model.allowed_dependencies['workspace-infra'].length, 0);
  assert.deepEqual(model.allowed_dependencies.cli, ['*']);
});

test('TMG-S-7: adjudication cards stay pending, hold at most 5 questions, and each carries a recommendation', async () => {
  const repoRoot = path.resolve(import.meta.dirname, '..');
  const cards = await readFile(
    path.join(repoRoot, 'docs', 'architecture', 'adjudication', 'target-model-rebaseline-cards.md'),
    'utf8'
  );
  // The agent generates the cards but must never answer them: an answered card would be an
  // unauthorized human_adjudicated change to the model.
  assert.match(cards, /status: pending_adjudication/);
  assert.match(cards, /answered_at: null/);
  const questions = cards.match(/^## Q\d+\./gm) ?? [];
  assert.ok(questions.length > 0 && questions.length <= 5, `expected 1..5 questions, got ${questions.length}`);
  const recommendations = cards.match(/\*\*\(推奨\)/g) ?? [];
  assert.equal(recommendations.length, questions.length);
});
