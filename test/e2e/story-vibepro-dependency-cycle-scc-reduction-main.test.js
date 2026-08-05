// End-to-end acceptance coverage for story-vibepro-dependency-cycle-scc-reduction.
//
// The whole point of collapsing 69,490 simple cycles into one SCC violation is to make the
// circularity dimension usable as a ratchet signal. That claim is only true if the *flow* a PR
// actually goes through -- `vibepro architecture conformance [--base <ref>]`, which checks out the
// base ref into a detached worktree, scans both sides and writes a delta ledger -- still reports a
// newly introduced circular dependency as `new`, and a repaired one as `resolved`.
//
// Each test below is bound to one acceptance criterion of the Story and drives the real CLI binary
// (or, for the depth property, the exported detector directly), so it covers what the in-process
// fixture unit tests cannot: CLI argument handling, the detached base worktree, artifact
// persistence, the rendered report surface, and the by_kind ledger a future ratchet gate reads.
import '../support/scratch-tmpdir.js';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { detectModuleCycles, detectModuleSccs } from '../../src/architecture-conformance.js';

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const cli = path.join(repoRoot, 'bin', 'vibepro.js');
const STORY = 'story-vibepro-dependency-cycle-scc-reduction';

const AC = {
  1: 'DCS-S-1: `detectModuleSccs(moduleEdges)` が有向モジュールグラフの強連結成分を**反復（非再帰）版 Tarjan** で線形時間 O(V+E) で求め、size>1 の SCC と、自己ループを持つ単一ノードの SCC を循環として返す。結果はメンバーのソート順で決定論的に並ぶ。',
  2: 'DCS-S-2: `dependency_cycle` violation は SCC 1 個につき 1 件になり、id は構成モジュールのソート済みリストから決定論的に導出される（`dependency_cycle_scc:<module>+<module>+...`）。同一グラフを 2 回スキャンすると id 集合が完全一致する。',
  3: 'DCS-S-3: SCC violation は `members`（ソート済み）、`module_edge_count`（SCC 内部のモジュール間 edge 数）、`import_edge_count`（それらを構成する実 import 本数）、`mutual_pairs`（SCC 内部の相互依存ペア）、`feedback_edge_candidates` を持つ。',
  4: 'DCS-S-4: 相互依存ペア（両方向に import がある module ペア）が `mutual_dependency` という独立 kind の violation として出力される。id は `mutual_dependency:<a>+<b>`（アルファベット順）で、各件は両方向の実 import 本数と例示 edge を持つ。',
  5: 'DCS-S-5: `feedback_edge_candidates` は SCC 内部のモジュール間 edge を実 import 本数の昇順で並べた上位候補であり、各候補は from/to/import 本数/例示 edge を持つ。これは最小 feedback arc set の厳密解ではなく重み最小の候補提示であることが、コードと出力の両方で明示される。',
  6: 'DCS-S-6: `summary` に `mutual_dependency_count` が追加され、`dependency_cycle_count` は SCC 件数を指す。`architecture-conformance-delta.js` の `DELTA_VIOLATION_KINDS` に `mutual_dependency` が含まれ、delta の `by_kind` に次元として現れる。',
  7: 'DCS-S-7: `export function detectModuleCycles(moduleEdges)` は署名・戻り値契約ともに維持され、既存の CDL-S-6 テスト（正規化の start node 非依存性）がそのまま通る。ただし conformance パイプラインからは呼ばれない。',
  8: 'DCS-S-8: 本リポジトリ実測で `dependency_cycle` が 69,490 件から 1 件、`mutual_dependency` が 20 件、`undeclared_dependency` 22 / `orphan_file` 1 / `budget_violation` 11 が不変であることが確認できる。'
};

function model(overrides = {}) {
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
    // Every edge below is explicitly allowed, so anything the ledger reports is circularity and
    // never a disguised undeclared_dependency.
    allowed_dependencies: { gate: ['*'], story: ['*'], infra: ['*'] },
    budgets: { default_max_file_lines: 500, file_line_baseline: {} },
    ...overrides
  };
}

async function git(root, args) {
  return execFileAsync('git', args, { cwd: root, encoding: 'utf8' });
}

async function writeFiles(root, files) {
  for (const [file, content] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(root, file)), { recursive: true });
    await writeFile(path.join(root, file), content);
  }
}

async function makeFixtureRepo(files, overrides) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vibepro-scc-e2e-'));
  await mkdir(path.join(root, 'docs', 'architecture'), { recursive: true });
  await writeFile(
    path.join(root, 'docs', 'architecture', 'target-model.json'),
    `${JSON.stringify(model(overrides), null, 2)}\n`
  );
  await writeFiles(root, files);
  await git(root, ['init', '-b', 'main']);
  await git(root, ['config', 'user.email', 'vibepro@example.com']);
  await git(root, ['config', 'user.name', 'VibePro Test']);
  return root;
}

async function runConformanceCli(root, extraArgs = []) {
  await execFileAsync('node', [cli, 'architecture', 'conformance', root, ...extraArgs], {
    cwd: root,
    maxBuffer: 64 * 1024 * 1024
  });
  const outDir = path.join(root, '.vibepro', 'architecture', 'conformance');
  const out = {
    head: JSON.parse(await readFile(path.join(outDir, 'conformance.json'), 'utf8')),
    markdown: null,
    delta: null
  };
  if (extraArgs.includes('--base')) {
    out.delta = JSON.parse(await readFile(path.join(outDir, 'delta.json'), 'utf8'));
  } else {
    out.markdown = await readFile(path.join(outDir, 'conformance.md'), 'utf8');
  }
  return out;
}

// An acyclic baseline: gate -> story -> infra, nothing pointing back.
const ACYCLIC = {
  'src/infra.js': 'export const infra = 1;\n',
  'src/story.js': "import { infra } from './infra.js';\n\nexport const story = infra + 1;\n",
  'src/gate.js': "import { story } from './story.js';\n\nexport const gate = story;\n"
};

// story-vibepro-dependency-cycle-scc-reduction ac:1 (spec clause S-001)
test(`${STORY} ac:1 SCC detection is iterative, cycle-only and deterministically ordered`, () => {
  // story-vibepro-dependency-cycle-scc-reduction ac:1
  const criterion = AC[1];

  // Two disjoint tangles, one acyclic node, one self-loop. A trivially strongly connected single
  // node is not a cycle and must not be reported; a self-loop is.
  const sccs = detectModuleSccs([
    { from: 'b', to: 'a' },
    { from: 'a', to: 'b' },
    { from: 'b', to: 'lone' },
    { from: 'z', to: 'y' },
    { from: 'y', to: 'x' },
    { from: 'x', to: 'z' },
    { from: 'self', to: 'self' }
  ]);
  assert.deepEqual(sccs, [['a', 'b'], ['self'], ['x', 'y', 'z']],
    `ac:1 ${criterion} — size>1 components and self-looping single nodes are cycles, acyclic single nodes are not, and members/components are sorted`);

  // Determinism: identity comes from the module names, so reversing the edge order (and therefore
  // the DFS root order) must not change the decomposition.
  const edges = [{ from: 'p', to: 'q' }, { from: 'q', to: 'r' }, { from: 'r', to: 'p' }];
  assert.deepEqual(detectModuleSccs(edges), detectModuleSccs([...edges].reverse()),
    `ac:1 ${criterion} — 結果はメンバーのソート順で決定論的に並ぶ: reversing the input order yields an identical decomposition`);

  // Depth property. A 20,000-module cycle has DFS depth 20,000; the retired recursive enumerator
  // overflows the call stack on it, while the explicit-work-stack Tarjan resolves it as one
  // component. This is the observable difference the "反復（非再帰）版" requirement buys.
  const deep = [];
  const size = 20000;
  for (let i = 0; i < size; i += 1) deep.push({ from: `m${i}`, to: `m${(i + 1) % size}` });
  const deepSccs = detectModuleSccs(deep);
  assert.equal(deepSccs.length, 1,
    `ac:1 ${criterion} — 反復（非再帰）版 Tarjan resolves a ${size}-module cycle without recursion depth failure`);
  assert.equal(deepSccs[0].length, size,
    `ac:1 ${criterion} — the whole ${size}-module cycle is one strongly connected component`);
  assert.throws(() => detectModuleCycles(deep), RangeError,
    `ac:1 ${criterion} — the retired recursive simple-cycle enumerator overflows at this depth, which is why the detector had to become iterative`);
});

// story-vibepro-dependency-cycle-scc-reduction ac:2 / ac:6 (spec clause S-002, S-005)
// flow_replay: base ref checkout -> both-side scan -> delta ledger, driven through the real CLI.
test(`${STORY} ac:2 a newly introduced circular dependency is reported as one new SCC by the delta flow`, async () => {
  // story-vibepro-dependency-cycle-scc-reduction ac:2
  const criterion = AC[2];
  const criterion6 = AC[6];
  const root = await makeFixtureRepo(ACYCLIC);
  await git(root, ['add', '.']);
  await git(root, ['commit', '-m', 'base: acyclic layering']);
  await git(root, ['tag', 'base-ref']);

  // head introduces exactly one back-edge: infra -> gate. This closes gate -> story -> infra -> gate.
  await writeFiles(root, {
    'src/infra.js': "import { gate } from './gate.js';\n\nexport const infra = gate;\n"
  });
  await git(root, ['add', '.']);
  await git(root, ['commit', '-m', 'head: introduce a back edge']);

  const { head, delta } = await runConformanceCli(root, ['--base', 'base-ref']);
  assert.equal(delta.delta.status, 'ok', `ac:2 ${criterion} — the delta flow must produce a comparable ledger`);
  assert.equal(head.summary.dependency_cycle_count, 1,
    `ac:2 ${criterion} — dependency_cycle violation は SCC 1 個につき 1 件になる`);

  const [introduced] = delta.delta.new.filter((v) => v.kind === 'dependency_cycle');
  assert.equal(introduced.id, 'dependency_cycle_scc:gate+infra+story',
    `ac:2 ${criterion} — id は構成モジュールのソート済みリストから決定論的に導出される`);
  assert.deepEqual(introduced.members, ['gate', 'infra', 'story'],
    `ac:2 ${criterion} — SCC members are the sorted module list the id is derived from`);
  assert.equal(delta.delta.summary.by_kind.dependency_cycle.new, 1,
    `ac:6 ${criterion6} — delta の by_kind に dependency_cycle が次元として現れ、新規悪化が1件として見える`);
  assert.equal(delta.delta.summary.by_kind.mutual_dependency.new, 0,
    `ac:6 ${criterion6} — DELTA_VIOLATION_KINDS に mutual_dependency が含まれ独立次元として集計される`);
  assert.equal(delta.delta.summary.by_kind.undeclared_dependency.new, 0,
    `ac:2 ${criterion} — circularity is not silently re-labelled as an undeclared dependency (every edge is allowed)`);

  // Re-scanning the same tree must yield the identical id set.
  const rescan = await runConformanceCli(root);
  assert.deepEqual(
    rescan.head.violations.map((v) => v.id).sort(),
    head.violations.map((v) => v.id).sort(),
    `ac:2 ${criterion} — 同一グラフを 2 回スキャンすると id 集合が完全一致する`
  );
});

// story-vibepro-dependency-cycle-scc-reduction ac:4 / ac:6 (spec clause S-004, S-005)
test(`${STORY} ac:4 repairing a mutual dependency is reported as resolved on its own dimension`, async () => {
  // story-vibepro-dependency-cycle-scc-reduction ac:4
  const criterion = AC[4];
  const criterion6 = AC[6];
  const root = await makeFixtureRepo({
    ...ACYCLIC,
    // base is tangled: story <-> infra are mutually dependent, and gate joins the same component.
    'src/infra.js': "import { story } from './story.js';\n\nexport const infra = story;\n",
    'src/story.js': "import { infra } from './infra.js';\nimport { gate } from './gate.js';\n\nexport const story = infra + gate;\n"
  });
  await git(root, ['add', '.']);
  await git(root, ['commit', '-m', 'base: mutually dependent story/infra']);
  await git(root, ['tag', 'base-ref']);

  // head breaks the story -> infra direction, leaving infra -> story only.
  await writeFiles(root, {
    'src/story.js': "import { gate } from './gate.js';\n\nexport const story = gate;\n"
  });
  await git(root, ['add', '.']);
  await git(root, ['commit', '-m', 'head: cut the story -> infra edge']);

  const { head, delta } = await runConformanceCli(root, ['--base', 'base-ref']);
  assert.equal(head.summary.mutual_dependency_count, 1,
    `ac:4 ${criterion} — 相互依存ペアが mutual_dependency という独立 kind の violation として出力される`);
  const [repaired] = delta.delta.resolved.filter((v) => v.kind === 'mutual_dependency');
  assert.equal(repaired.id, 'mutual_dependency:infra+story',
    `ac:4 ${criterion} — id は mutual_dependency:<a>+<b>（アルファベット順）`);
  assert.deepEqual(repaired.directions.map((d) => [d.from, d.to, d.import_edge_count]),
    [['infra', 'story', 1], ['story', 'infra', 1]],
    `ac:4 ${criterion} — 各件は両方向の実 import 本数を持つ`);
  for (const direction of repaired.directions) {
    assert.ok(direction.example_edges.length > 0,
      `ac:4 ${criterion} — 各件は両方向の例示 edge を持つ`);
  }
  assert.equal(delta.delta.summary.by_kind.mutual_dependency.resolved, 1,
    `ac:6 ${criterion6} — delta の by_kind で mutual_dependency の resolved が独立に数えられる`);
  // The SCC shrank from 3 members to 2, so its identity changed: one resolved, one new.
  assert.equal(delta.delta.summary.by_kind.dependency_cycle.resolved, 1,
    `ac:6 ${criterion6} — dependency_cycle_count は SCC 件数を指すので、SCC が縮むと resolved として現れる`);
  const [after] = delta.delta.new.filter((v) => v.kind === 'dependency_cycle');
  assert.equal(after.id, 'dependency_cycle_scc:gate+story',
    `ac:6 ${criterion6} — the shrunken component is a new SCC identity, not a silently mutated one`);
});

// story-vibepro-dependency-cycle-scc-reduction ac:3 / ac:5 (spec clause S-003)
test(`${STORY} ac:3 the SCC violation carries actionable structure and heuristic cut candidates`, async () => {
  // story-vibepro-dependency-cycle-scc-reduction ac:3
  const criterion = AC[3];
  const criterion5 = AC[5];
  // The infra module spans three files that each import gate, so the infra -> gate module edge
  // carries three real imports while every other edge carries one. That weight difference is what
  // the cut-candidate ranking has to reflect.
  const root = await makeFixtureRepo({
    'src/infra/a.js': "import { gate } from '../gate.js';\n\nexport const a = gate;\n",
    'src/infra/b.js': "import { gate } from '../gate.js';\n\nexport const b = gate;\n",
    'src/infra/c.js': "import { gate } from '../gate.js';\n\nexport const c = gate;\n",
    'src/story.js': "import { gate } from './gate.js';\n\nexport const story = gate;\n",
    'src/gate.js': "import { story } from './story.js';\nimport { a } from './infra/a.js';\n\nexport const gate = story + a;\n"
  }, {
    modules: [
      { name: 'story', responsibility: 'story', paths: ['src/story.js'] },
      { name: 'gate', responsibility: 'gate', paths: ['src/gate.js'] },
      { name: 'infra', responsibility: 'shared kernel', paths: ['src/infra/'] }
    ]
  });
  const { head, markdown } = await runConformanceCli(root);
  const [scc] = head.violations.filter((v) => v.kind === 'dependency_cycle');

  assert.deepEqual(scc.members, ['gate', 'infra', 'story'],
    `ac:3 ${criterion} — SCC violation は members（ソート済み）を持つ`);
  assert.equal(scc.module_edge_count, 4,
    `ac:3 ${criterion} — module_edge_count は SCC 内部のモジュール間 edge 数 (infra->gate, story->gate, gate->story, gate->infra)`);
  assert.equal(scc.import_edge_count, 6,
    `ac:3 ${criterion} — import_edge_count はそれらを構成する実 import 本数 (infra->gate だけで3本)`);
  assert.deepEqual(scc.mutual_pairs, [['gate', 'infra'], ['gate', 'story']],
    `ac:3 ${criterion} — mutual_pairs は SCC 内部の相互依存ペア`);
  assert.ok(scc.feedback_edge_candidates.length > 0,
    `ac:3 ${criterion} — SCC violation は feedback_edge_candidates を持つ`);

  const weights = scc.feedback_edge_candidates.map((c) => c.import_edge_count);
  assert.deepEqual(weights, [...weights].sort((a, b) => a - b),
    `ac:5 ${criterion5} — feedback_edge_candidates は実 import 本数の昇順で並ぶ`);
  const heaviest = scc.feedback_edge_candidates.at(-1);
  assert.deepEqual([heaviest.from, heaviest.to, heaviest.import_edge_count], ['infra', 'gate', 3],
    `ac:5 ${criterion5} — 重み最大 (3 imports) の infra -> gate が最後に並ぶ（切るコストが最も高い候補）`);
  for (const candidate of scc.feedback_edge_candidates) {
    assert.ok(
      typeof candidate.from === 'string' && typeof candidate.to === 'string'
        && Number.isInteger(candidate.import_edge_count) && candidate.example_edges.length > 0,
      `ac:5 ${criterion5} — 各候補は from/to/import 本数/例示 edge を持つ`
    );
    assert.ok(scc.members.includes(candidate.from) && scc.members.includes(candidate.to),
      `ac:5 ${criterion5} — 候補は SCC 内部のモジュール間 edge に限られる`);
  }
  assert.match(markdown, /切断候補 \(重み最小・厳密解ではない\)/,
    `ac:5 ${criterion5} — 最小 feedback arc set の厳密解ではないことが出力にも明示される`);
});

// story-vibepro-dependency-cycle-scc-reduction ac:7 (spec clause S-006)
test(`${STORY} ac:7 the retired enumerator stays exported while the flow emits only SCC ids`, async () => {
  // story-vibepro-dependency-cycle-scc-reduction ac:7
  const criterion = AC[7];

  // Signature and normalized simple-cycle return contract are unchanged: the same 2-module cycle
  // normalizes to the same rotation regardless of which node the traversal starts from.
  assert.deepEqual(detectModuleCycles([{ from: 'b', to: 'a' }, { from: 'a', to: 'b' }]), [['a', 'b']],
    `ac:7 ${criterion} — 署名・戻り値契約ともに維持され、正規化の start node 非依存性が保たれる`);
  assert.deepEqual(detectModuleCycles([{ from: 'a', to: 'b' }, { from: 'b', to: 'a' }]), [['a', 'b']],
    `ac:7 ${criterion} — 既存の CDL-S-6 テスト（正規化の start node 非依存性）がそのまま通る`);
  assert.equal(detectModuleCycles.length, 1,
    `ac:7 ${criterion} — export function detectModuleCycles(moduleEdges) の引数契約が維持される`);

  const root = await makeFixtureRepo({
    ...ACYCLIC,
    'src/infra.js': "import { gate } from './gate.js';\n\nexport const infra = gate;\n"
  });
  const { head } = await runConformanceCli(root);
  assert.equal(head.violations.filter((v) => v.id.startsWith('dependency_cycle:')).length, 0,
    `ac:7 ${criterion} — conformance パイプラインからは呼ばれない: no violation uses the retired dependency_cycle:<a>-><b> id form`);
  assert.equal(head.violations.filter((v) => v.id.startsWith('dependency_cycle_scc:')).length, 1,
    `ac:7 ${criterion} — the pipeline emits the SCC id form instead`);
});

// story-vibepro-dependency-cycle-scc-reduction ac:8 (spec clause SLA-001)
test(`${STORY} ac:8 the real repository scan collapses to one SCC and leaves the other dimensions unchanged`, async () => {
  // story-vibepro-dependency-cycle-scc-reduction ac:8
  const criterion = AC[8];
  const { head } = await runConformanceCli(repoRoot);
  const summary = head.summary;
  assert.equal(summary.dependency_cycle_count, 1,
    `ac:8 ${criterion} — 本リポジトリ実測で dependency_cycle が 69,490 件から 1 件になる`);
  assert.equal(summary.mutual_dependency_count, 20,
    `ac:8 ${criterion} — mutual_dependency が 20 件`);
  assert.equal(summary.undeclared_dependency_count, 22,
    `ac:8 ${criterion} — undeclared_dependency 22 が不変`);
  assert.equal(summary.orphan_file_count, 1,
    `ac:8 ${criterion} — orphan_file 1 が不変`);
  assert.equal(summary.budget_violation_count, 11,
    `ac:8 ${criterion} — budget_violation 11 が不変`);
  const [scc] = head.violations.filter((v) => v.kind === 'dependency_cycle');
  assert.equal(scc.members.length, 16,
    `ac:8 ${criterion} — the single SCC is the 16-module tangle the measurement identified`);
});
