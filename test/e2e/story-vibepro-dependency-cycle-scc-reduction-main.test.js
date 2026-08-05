// End-to-end flow replay for story-vibepro-dependency-cycle-scc-reduction.
//
// The whole point of collapsing 69,490 simple cycles into one SCC violation is to make the
// circularity dimension usable as a ratchet signal. That claim is only true if the *flow* a PR
// actually goes through -- `vibepro architecture conformance --base <ref>`, which checks out the
// base ref into a detached worktree, scans both sides and writes a delta ledger -- still reports a
// newly introduced circular dependency as `new`, and a repaired one as `resolved`.
//
// This test drives that flow through the real CLI binary against a throwaway git repository, so it
// covers the parts the in-process unit tests cannot: CLI argument handling, the detached base
// worktree, artifact persistence, and the by_kind ledger a future ratchet gate would read.
import '../support/scratch-tmpdir.js';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const cli = path.join(repoRoot, 'bin', 'vibepro.js');

const MODEL = {
  schema_version: '0.1.0',
  status: 'draft',
  adjudicated_by: null,
  scope_roots: ['src'],
  modules: [
    { name: 'story', responsibility: 'story', paths: ['src/story.js'] },
    { name: 'gate', responsibility: 'gate', paths: ['src/gate.js'] },
    { name: 'infra', responsibility: 'shared kernel', paths: ['src/infra.js'] }
  ],
  // Every edge below is explicitly allowed, so anything the ledger reports is circularity and not a
  // disguised undeclared_dependency.
  allowed_dependencies: { gate: ['*'], story: ['*'], infra: ['*'] },
  budgets: { default_max_file_lines: 500, file_line_baseline: {} }
};

async function git(root, args) {
  return execFileAsync('git', args, { cwd: root, encoding: 'utf8' });
}

async function writeFiles(root, files) {
  for (const [file, content] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(root, file)), { recursive: true });
    await writeFile(path.join(root, file), content);
  }
}

async function makeFixtureRepo(files) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vibepro-scc-e2e-'));
  await mkdir(path.join(root, 'docs', 'architecture'), { recursive: true });
  await writeFile(
    path.join(root, 'docs', 'architecture', 'target-model.json'),
    `${JSON.stringify(MODEL, null, 2)}\n`
  );
  await writeFiles(root, files);
  await git(root, ['init', '-b', 'main']);
  await git(root, ['config', 'user.email', 'vibepro@example.com']);
  await git(root, ['config', 'user.name', 'VibePro Test']);
  return root;
}

// An acyclic baseline: gate -> story -> infra, nothing pointing back.
const ACYCLIC = {
  'src/infra.js': 'export const infra = 1;\n',
  'src/story.js': "import { infra } from './infra.js';\n\nexport const story = infra + 1;\n",
  'src/gate.js': "import { story } from './story.js';\n\nexport const gate = story;\n"
};

async function runDeltaFlow(root, baseRef) {
  await execFileAsync('node', [cli, 'architecture', 'conformance', root, '--base', baseRef], {
    cwd: root,
    maxBuffer: 32 * 1024 * 1024
  });
  const outDir = path.join(root, '.vibepro', 'architecture', 'conformance');
  return {
    delta: JSON.parse(await readFile(path.join(outDir, 'delta.json'), 'utf8')),
    head: JSON.parse(await readFile(path.join(outDir, 'conformance.json'), 'utf8'))
  };
}

// story-vibepro-dependency-cycle-scc-reduction:AC-2/AC-4/AC-6 (spec clause S-002, S-004, S-005)
// flow_replay: base ref checkout -> both-side scan -> delta ledger, driven through the real CLI.
test('DCS-E2E: a newly introduced circular dependency is reported as new by the delta ledger flow', async () => {
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

  const { delta, head } = await runDeltaFlow(root, 'base-ref');

  assert.equal(delta.delta.status, 'ok');
  assert.equal(head.summary.dependency_cycle_count, 1, 'the new tangle is one SCC violation');
  assert.equal(head.summary.mutual_dependency_count, 0, 'a 3-hop cycle has no mutually dependent pair');

  // The regression is visible as `new` in the ledger -- this is the property a ratchet gate needs.
  assert.equal(delta.delta.summary.by_kind.dependency_cycle.new, 1);
  assert.equal(delta.delta.summary.by_kind.dependency_cycle.resolved, 0);
  assert.equal(delta.delta.summary.by_kind.mutual_dependency.new, 0);
  const [introduced] = delta.delta.new.filter((v) => v.kind === 'dependency_cycle');
  assert.equal(introduced.id, 'dependency_cycle_scc:gate+infra+story');
  assert.deepEqual(introduced.members, ['gate', 'infra', 'story']);
  // And it is not silently re-labelled as an undeclared dependency: every edge is allowed.
  assert.equal(delta.delta.summary.by_kind.undeclared_dependency.new, 0);
});

// story-vibepro-dependency-cycle-scc-reduction:AC-4/AC-6 (spec clause S-004, S-005)
// flow_replay: the same CLI flow run in the repair direction, so the ledger can score progress.
test('DCS-E2E: repairing a mutual dependency is reported as resolved by the delta ledger flow', async () => {
  const root = await makeFixtureRepo({
    ...ACYCLIC,
    // base is tangled: story <-> infra are mutually dependent, and gate joins the same component.
    'src/infra.js': "import { story } from './story.js';\n\nexport const infra = story;\n",
    'src/story.js': "import { infra } from './infra.js';\nimport { gate } from './gate.js';\n\nexport const story = infra + gate;\n"
  });
  await git(root, ['add', '.']);
  await git(root, ['commit', '-m', 'base: mutually dependent story/infra']);
  await git(root, ['tag', 'base-ref']);

  // head breaks the story -> infra direction, leaving infra -> story only. The tangle disappears.
  await writeFiles(root, {
    'src/story.js': "import { gate } from './gate.js';\n\nexport const story = gate;\n"
  });
  await git(root, ['add', '.']);
  await git(root, ['commit', '-m', 'head: cut the story -> infra edge']);

  const { delta, head } = await runDeltaFlow(root, 'base-ref');

  assert.equal(delta.delta.status, 'ok');
  assert.equal(head.summary.dependency_cycle_count, 1, 'gate <-> story remains tangled');
  assert.equal(head.summary.mutual_dependency_count, 1);

  // The repaired pair is scored as resolved on its own dimension -- the movement a single
  // refactoring story is expected to produce.
  assert.equal(delta.delta.summary.by_kind.mutual_dependency.resolved, 1);
  assert.equal(delta.delta.summary.by_kind.mutual_dependency.new, 0);
  const [repaired] = delta.delta.resolved.filter((v) => v.kind === 'mutual_dependency');
  assert.equal(repaired.id, 'mutual_dependency:infra+story');
  // The SCC shrank from 3 members to 2, so its identity changed: one resolved, one new.
  assert.equal(delta.delta.summary.by_kind.dependency_cycle.resolved, 1);
  assert.equal(delta.delta.summary.by_kind.dependency_cycle.new, 1);
  const [before] = delta.delta.resolved.filter((v) => v.kind === 'dependency_cycle');
  const [after] = delta.delta.new.filter((v) => v.kind === 'dependency_cycle');
  assert.equal(before.id, 'dependency_cycle_scc:gate+infra+story');
  assert.equal(after.id, 'dependency_cycle_scc:gate+story');
});
