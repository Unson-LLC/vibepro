// End-to-end integration coverage for story-vibepro-dependency-cycle-scc-reduction.
//
// The unit tests in test/architecture-conformance-delta.test.js drive runArchitectureConformance
// directly over synthetic fixture repositories. That proves the SCC reduction is correct in the
// small, but it cannot show what this story is actually about: that running the real CLI against
// this repository turns a 69,490-item pile into a readable measurement, and that the artifacts a
// reviewer opens (conformance.json and the rendered conformance.md report surface) agree with each
// other. This file executes `node bin/vibepro.js architecture conformance` as a child process and
// replays the artifacts it persists.
import './support/scratch-tmpdir.js';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const artifactDir = path.join(repoRoot, '.vibepro', 'architecture', 'conformance');

async function runConformanceCli() {
  const started = Date.now();
  await execFileAsync('node', [path.join(repoRoot, 'bin', 'vibepro.js'), 'architecture', 'conformance', repoRoot], {
    cwd: repoRoot,
    maxBuffer: 64 * 1024 * 1024
  });
  const wallClockMs = Date.now() - started;
  const result = JSON.parse(await readFile(path.join(artifactDir, 'conformance.json'), 'utf8'));
  const markdown = await readFile(path.join(artifactDir, 'conformance.md'), 'utf8');
  return { result, markdown, wallClockMs };
}

// story-vibepro-dependency-cycle-scc-reduction:AC-2/AC-8 (spec clause S-002, SLA-001)
// path_surface: review_surface -- the persisted conformance.json is what pr prepare reads into
// senior-gap judgment's conformance_summary, so the counts a reviewer is shown are asserted here.
test('DCS-S-8: the real conformance CLI persists one SCC violation and leaves the other dimensions unchanged', async () => {
  const { result, wallClockMs } = await runConformanceCli();
  const summary = result.summary;
  assert.equal(summary.dependency_cycle_count, 1, 'the whole tangle must collapse to one SCC violation');
  assert.equal(summary.mutual_dependency_count, 20);
  // Dimensions this story must not touch. A "reduction" that also shrank these would be a scan
  // that stopped looking rather than a decomposition that stopped repeating itself.
  assert.equal(summary.undeclared_dependency_count, 22);
  assert.equal(summary.budget_violation_count, 11);
  assert.equal(summary.orphan_file_count, 1);
  assert.equal(summary.stale_pattern_count, 0);
  assert.equal(summary.violation_count, 55);
  assert.ok(wallClockMs < 5000, `end-to-end conformance scan took ${wallClockMs}ms`);
});

// story-vibepro-dependency-cycle-scc-reduction:AC-2/AC-3/AC-4/AC-5 (spec clause INV-001, S-003, S-004)
test('DCS-S-3: the persisted SCC violation is internally consistent with the mutual_dependency dimension', async () => {
  const { result } = await runConformanceCli();
  const [scc] = result.violations.filter((v) => v.kind === 'dependency_cycle');
  const mutual = result.violations.filter((v) => v.kind === 'mutual_dependency');

  assert.equal(scc.members.length, 16);
  assert.deepEqual(scc.members, [...scc.members].sort(), 'members are sorted');
  assert.equal(scc.id, `dependency_cycle_scc:${scc.members.join('+')}`, 'id is derived from the members');
  assert.ok(scc.import_edge_count >= scc.module_edge_count && scc.module_edge_count > 0);

  // The two dimensions are computed from the same edge set; if the SCC were produced by capping or
  // truncating an enumeration, its mutual_pairs would not match the independently emitted pairs.
  assert.deepEqual(
    scc.mutual_pairs.map((pair) => pair.join('+')).sort(),
    mutual.map((pair) => pair.modules.join('+')).sort()
  );
  for (const pair of mutual) {
    const [a, b] = pair.modules;
    assert.ok(a < b, 'pair identity is the alphabetically sorted pair');
    assert.equal(pair.id, `mutual_dependency:${a}+${b}`);
    assert.deepEqual(pair.directions.map((d) => [d.from, d.to]), [[a, b], [b, a]]);
    for (const direction of pair.directions) {
      assert.ok(direction.import_edge_count >= 1);
      assert.ok(direction.example_edges.length > 0, 'each direction names a real file-level import');
    }
  }

  // Cut candidates must be intra-SCC and ranked cheapest-first by real import weight.
  assert.ok(scc.feedback_edge_candidates.length > 0);
  const weights = scc.feedback_edge_candidates.map((c) => c.import_edge_count);
  assert.deepEqual(weights, [...weights].sort((a, b) => a - b));
  for (const candidate of scc.feedback_edge_candidates) {
    assert.ok(scc.members.includes(candidate.from) && scc.members.includes(candidate.to));
    assert.ok(candidate.example_edges.length > 0);
  }

  // The retired simple-cycle id form must not reappear anywhere in the persisted artifact.
  assert.equal(result.violations.filter((v) => v.id.startsWith('dependency_cycle:')).length, 0);
});

// story-vibepro-dependency-cycle-scc-reduction:AC-3/AC-5 (spec clause S-003)
// path_surface: review_surface -- conformance.md is the human-readable report a reviewer opens.
test('DCS-S-5: the rendered report surface shows the SCC, its mutual pairs and heuristic cut candidates', async () => {
  const { result, markdown } = await runConformanceCli();
  const [scc] = result.violations.filter((v) => v.kind === 'dependency_cycle');

  assert.match(markdown, /dependency_cycle=1/);
  assert.match(markdown, /mutual_dependency=20/);
  assert.match(markdown, /## モジュール循環依存 \(強連結成分\)/);
  assert.match(markdown, /## モジュール相互依存 \(循環の最小切断候補\)/);
  // The report must state that cut candidates are a heuristic, so a reader cannot mistake the
  // weight ranking for a solved minimum feedback arc set.
  assert.match(markdown, /切断候補 \(重み最小・厳密解ではない\)/);
  for (const candidate of scc.feedback_edge_candidates) {
    assert.ok(
      markdown.includes(`${candidate.from} -> ${candidate.to} (${candidate.import_edge_count} imports)`),
      `report surface must show cut candidate ${candidate.from} -> ${candidate.to}`
    );
  }
  for (const pair of result.violations.filter((v) => v.kind === 'mutual_dependency')) {
    assert.ok(markdown.includes(`${pair.modules[0]} <-> ${pair.modules[1]}`));
  }
});
