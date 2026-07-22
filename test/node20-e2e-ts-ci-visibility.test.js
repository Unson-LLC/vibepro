import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import {
  MIN_TYPE_STRIPPING_NODE_VERSION,
  listE2eTsSpecs,
  runE2eTsSpecs,
  supportsTypeStripping
} from '../scripts/run-e2e-ts-specs.mjs';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const runnerPath = join(repoRoot, 'scripts', 'run-e2e-ts-specs.mjs');

function makeFixtureRoot({ withSpec }) {
  const root = mkdtempSync(join(tmpdir(), 'e2e-ts-gate-'));
  mkdirSync(join(root, 'test', 'e2e'), { recursive: true });
  if (withSpec) {
    writeFileSync(
      join(root, 'test', 'e2e', 'fixture.spec.ts'),
      [
        "import test from 'node:test';",
        "import assert from 'node:assert';",
        'const value: number = 1;',
        "test('fixture spec runs', () => { assert.equal(value, 1); });",
        ''
      ].join('\n')
    );
  }
  return root;
}

// story-vibepro-node20-e2e-ts-ci-visibility ac:1 spec enumeration is deterministic and non-empty in this repo
test('listE2eTsSpecs enumerates the repo e2e .ts acceptance replay specs', () => {
  const specs = listE2eTsSpecs(repoRoot);
  assert.ok(specs.length > 0, 'expected at least one test/e2e/*.spec.ts file');
  for (const spec of specs) {
    assert.match(spec, /^test\/e2e\/.+\.spec\.ts$/);
  }
  assert.deepEqual(specs, [...specs].sort());
});

// story-vibepro-node20-e2e-ts-ci-visibility ac:1 zero discovered specs must fail instead of silently passing
test('runE2eTsSpecs fails when no e2e .ts specs are found', () => {
  const root = makeFixtureRoot({ withSpec: false });
  const lines = [];
  const exitCode = runE2eTsSpecs({
    rootDir: root,
    nodeVersion: 'v22.6.0',
    log: (line) => lines.push(line),
    spawn: () => {
      throw new Error('spawn must not be called when the spec set is empty');
    }
  });
  assert.equal(exitCode, 1);
  assert.ok(lines.some((line) => line.startsWith('::error::')));
});

// story-vibepro-node20-e2e-ts-ci-visibility ac:2 Node >= 22.6.0 executes every spec explicitly and propagates failure
test('runE2eTsSpecs passes all specs to node --test and propagates the child exit status', () => {
  const root = makeFixtureRoot({ withSpec: true });
  const calls = [];
  const exitCode = runE2eTsSpecs({
    rootDir: root,
    nodeVersion: 'v22.6.0',
    log: () => {},
    spawn: (command, args, options) => {
      calls.push({ command, args, options });
      return { status: 7 };
    }
  });
  assert.equal(exitCode, 7);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].command, process.execPath);
  assert.equal(calls[0].args[0], '--test');
  assert.deepEqual(calls[0].args.slice(1), [join('test', 'e2e', 'fixture.spec.ts')]);
  assert.equal(calls[0].options.cwd, root);
});

// story-vibepro-node20-e2e-ts-ci-visibility ac:3 lanes without type stripping skip visibly with a counted warning
test('runE2eTsSpecs on Node < 22.6.0 skips with a counted warning annotation and never spawns', () => {
  const root = makeFixtureRoot({ withSpec: true });
  const lines = [];
  const exitCode = runE2eTsSpecs({
    rootDir: root,
    nodeVersion: 'v20.20.2',
    log: (line) => lines.push(line),
    spawn: () => {
      throw new Error('spawn must not be called on a lane without type stripping');
    }
  });
  assert.equal(exitCode, 0);
  const warning = lines.find((line) => line.startsWith('::warning::'));
  assert.ok(warning, 'expected a ::warning:: annotation');
  assert.match(warning, /Skipped 1 e2e \.ts spec/);
  assert.match(warning, /NO e2e \.ts coverage/);
});

// story-vibepro-node20-e2e-ts-ci-visibility ac:3 version threshold sits exactly at the type-stripping boundary
test('supportsTypeStripping matches the Node 22.6.0 type stripping boundary', () => {
  assert.equal(MIN_TYPE_STRIPPING_NODE_VERSION, 'v22.6.0');
  assert.equal(supportsTypeStripping('v20.20.2'), false);
  assert.equal(supportsTypeStripping('v22.5.9'), false);
  assert.equal(supportsTypeStripping('v22.6.0'), true);
  assert.equal(supportsTypeStripping('v22.22.0'), true);
  assert.equal(supportsTypeStripping('v23.0.0'), true);
  assert.equal(supportsTypeStripping('not-a-version'), false);
});

// story-vibepro-node20-e2e-ts-ci-visibility ac:4 the gate is wired into npm scripts and every CI matrix lane
test('package.json and ci.yml wire the e2e .ts gate into every CI lane', () => {
  const packageJson = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'));
  assert.equal(packageJson.scripts['test:e2e:ts'], 'node scripts/run-e2e-ts-specs.mjs');
  const ciWorkflow = readFileSync(join(repoRoot, '.github', 'workflows', 'ci.yml'), 'utf8');
  assert.match(ciWorkflow, /- run: npm run test:e2e:ts/);
});

// story-vibepro-node20-e2e-ts-ci-visibility ac:5 process-level replay: run mode and skip mode both exit 0, empty set exits 1
test('runner process executes or visibly skips depending on the current Node lane', () => {
  const rootWithSpec = makeFixtureRoot({ withSpec: true });
  const withSpec = spawnSync(process.execPath, [runnerPath], {
    cwd: rootWithSpec,
    encoding: 'utf8'
  });
  assert.equal(withSpec.status, 0, withSpec.stdout + withSpec.stderr);
  if (supportsTypeStripping(process.version)) {
    assert.match(withSpec.stdout, /fixture spec runs/);
    assert.doesNotMatch(withSpec.stdout, /::warning::/);
  } else {
    assert.match(withSpec.stdout, /::warning::Skipped 1 e2e \.ts spec/);
    assert.doesNotMatch(withSpec.stdout + withSpec.stderr, /ERR_UNKNOWN_FILE_EXTENSION/);
  }

  const emptyRoot = makeFixtureRoot({ withSpec: false });
  const empty = spawnSync(process.execPath, [runnerPath], {
    cwd: emptyRoot,
    encoding: 'utf8'
  });
  assert.equal(empty.status, 1, empty.stdout + empty.stderr);
  assert.match(empty.stdout, /::error::/);
});
