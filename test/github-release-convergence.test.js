import './support/scratch-tmpdir.js';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, rename, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import * as releaseScript from '../scripts/post-merge-release.mjs';

const repositoryRoot = path.resolve(import.meta.dirname, '..');
const node22Bin = path.dirname(process.execPath);
const expectedSha = '1234567890abcdef1234567890abcdef12345678';

// Traceability refs intentionally use VibePro's qualified Story/AC format.
// story-vibepro-github-prerelease-convergence:ac:1
test('GRC-S-1 derives GitHub classification from SemVer and rejects invalid versions', () => {
  assert.deepEqual(releaseScript.releaseClassification('0.2.0-beta.6'), {
    prerelease: true,
    latest: false
  });
  assert.deepEqual(releaseScript.releaseClassification('0.2.0'), {
    prerelease: false,
    latest: true
  });
  assert.throws(
    () => releaseScript.releaseClassification('0.2'),
    /Invalid SemVer/u
  );
});

// story-vibepro-github-prerelease-convergence:ac:2
// story-vibepro-github-prerelease-convergence:ac:3
// story-vibepro-github-prerelease-convergence:ac:7
test('GRC-S-2/GRC-S-3/GRC-S-6 create and edit converge prerelease and stable metadata', async (t) => {
  for (const operation of ['create', 'edit']) {
    for (const scenario of [
      { version: '0.2.0-beta.6', prerelease: true, latest: false },
      { version: '0.2.0', prerelease: false, latest: true }
    ]) {
      await t.test(`${operation} ${scenario.version}`, async () => {
        const fixture = await githubFixture({ operation, expectedSha });
        const result = runReconcile(fixture, scenario.version, expectedSha);
        assert.equal(result.status, 0, result.stderr);

        const state = JSON.parse(await readFile(fixture.stateFile, 'utf8'));
        const expectedTag = `v${scenario.version}`;
        assert.equal(state.release.tagName, expectedTag);
        assert.equal(state.release.targetCommitish, expectedSha);
        assert.equal(state.release.isPrerelease, scenario.prerelease);
        assert.equal(state.latestTag === expectedTag, scenario.latest);

        const log = JSON.parse(await readFile(fixture.logFile, 'utf8'));
        const mutation = log.find((entry) => entry[0] === 'release' && entry[1] === operation);
        assert.ok(mutation, `expected gh release ${operation}`);
        assert.ok(mutation.includes(`--prerelease=${scenario.prerelease}`));
        assert.ok(mutation.includes(`--latest=${scenario.latest}`));
        assert.deepEqual(mutation.slice(mutation.indexOf('--target'), mutation.indexOf('--target') + 2), [
          '--target',
          expectedSha
        ]);
      });
    }
  }
});

test('GRC-S-2 Latest lookup handles absence and fails closed on malformed tags or API errors', async (t) => {
  await t.test('404 means no current Latest and allows stable creation', async () => {
    const fixture = await githubFixture({
      operation: 'create',
      expectedSha,
      latestLookupMode: 'not-found'
    });
    const result = runReconcile(fixture, '0.2.0', expectedSha);
    assert.equal(result.status, 0, result.stderr);

    const state = JSON.parse(await readFile(fixture.stateFile, 'utf8'));
    assert.equal(state.latestTag, 'v0.2.0');
  });

  await t.test('malformed current Latest tag stops before mutation', async () => {
    const fixture = await githubFixture({
      operation: 'create',
      expectedSha,
      latestTag: 'release-current'
    });
    const result = runReconcile(fixture, '0.2.0', expectedSha);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Latest GitHub Release tag is not a v-prefixed SemVer/u);

    const log = JSON.parse(await readFile(fixture.logFile, 'utf8'));
    assert.equal(log.some((entry) => entry[0] === 'release' && entry[1] === 'create'), false);
  });

  await t.test('non-404 Latest API failure stops before mutation', async () => {
    const fixture = await githubFixture({
      operation: 'create',
      expectedSha,
      latestLookupMode: 'error'
    });
    const result = runReconcile(fixture, '0.2.0', expectedSha);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Latest GitHub Release lookup failed: authentication failed/u);

    const log = JSON.parse(await readFile(fixture.logFile, 'utf8'));
    assert.equal(log.some((entry) => entry[0] === 'release' && entry[1] === 'create'), false);
  });
});

// story-vibepro-github-prerelease-convergence:ac:4
test('GRC-S-3b replaying an older stable release never rolls Latest backward', async (t) => {
  for (const operation of ['create', 'edit']) {
    await t.test(operation, async () => {
      const fixture = await githubFixture({
        operation,
        expectedSha,
        releaseTag: 'v0.2.0',
        latestTag: 'v0.3.0'
      });
      const result = runReconcile(fixture, '0.2.0', expectedSha);
      assert.equal(result.status, 0, result.stderr);

      const state = JSON.parse(await readFile(fixture.stateFile, 'utf8'));
      assert.equal(state.latestTag, 'v0.3.0');

      const log = JSON.parse(await readFile(fixture.logFile, 'utf8'));
      const mutation = log.find((entry) => entry[0] === 'release' && entry[1] === operation);
      assert.ok(mutation, `expected gh release ${operation}`);
      assert.ok(mutation.includes('--latest=false'));
    });
  }
});

// story-vibepro-github-prerelease-convergence:ac:5
test('GRC-S-4 fails closed when the post-operation tag SHA differs', async () => {
  const fixture = await githubFixture({ operation: 'create', expectedSha });
  const result = runReconcile(fixture, '0.2.0-beta.6', expectedSha, {
    RELEASE_TEST_FORCED_TAG_SHA: 'ffffffffffffffffffffffffffffffffffffffff'
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /tag v0\.2\.0-beta\.6 resolves to .* expected/u);
});

// story-vibepro-github-prerelease-convergence:ac:6
test('GRC-S-5 fails closed when GitHub metadata does not converge', async () => {
  const fixture = await githubFixture({ operation: 'edit', expectedSha });
  const result = runReconcile(fixture, '0.2.0-beta.6', expectedSha, {
    RELEASE_TEST_HOLD_METADATA: '1'
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /GitHub Release v0\.2\.0-beta\.6 metadata did not converge/u);
});

// The runner-direct Node 22 full-suite evidence closes this environment AC.
// story-vibepro-github-prerelease-convergence:ac:8

function runReconcile(fixture, version, sha, extraEnvironment = {}) {
  return spawnSync(process.execPath, [
    path.join(repositoryRoot, 'scripts/post-merge-release.mjs'),
    'reconcile-github-release',
    '--version', version,
    '--sha', sha,
    '--notes-file', fixture.notesFile,
    '--repository', 'example/vibepro'
  ], {
    cwd: repositoryRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      ...extraEnvironment,
      PATH: `${fixture.binDir}:${node22Bin}:/usr/bin:/bin`,
      RELEASE_TEST_STATE: fixture.stateFile,
      RELEASE_TEST_LOG: fixture.logFile
    }
  });
}

async function githubFixture({
  operation,
  expectedSha: sha,
  releaseTag = 'v0.2.0-beta.6',
  latestTag = operation === 'edit' ? releaseTag : 'v0.1.0',
  latestLookupMode = 'normal'
}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vibepro-github-release-'));
  const binDir = path.join(root, 'bin');
  const stateFile = path.join(root, 'state.json');
  const logFile = path.join(root, 'log.json');
  const notesFile = path.join(root, 'notes.md');
  await writeFile(notesFile, '# Release\n');
  await writeFile(logFile, '[]\n');
  await writeFile(stateFile, JSON.stringify(operation === 'edit' ? {
    exists: true,
    latestTag,
    latestLookupMode,
    tagSha: sha,
    release: {
      tagName: releaseTag,
      targetCommitish: sha,
      isPrerelease: false
    }
  } : {
    exists: false,
    latestTag,
    latestLookupMode,
    tagSha: null,
    release: null
  }, null, 2));
  await writeFile(path.join(root, 'gh'), fakeGhSource());
  await writeFile(path.join(root, 'git'), fakeGitSource());
  await chmod(path.join(root, 'gh'), 0o755);
  await chmod(path.join(root, 'git'), 0o755);
  await mkdir(binDir);
  await Promise.all([
    rename(path.join(root, 'gh'), path.join(binDir, 'gh')),
    rename(path.join(root, 'git'), path.join(binDir, 'git'))
  ]);
  return { binDir, stateFile, logFile, notesFile };
}

function fakeGhSource() {
  return `#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
const stateFile = process.env.RELEASE_TEST_STATE;
const logFile = process.env.RELEASE_TEST_LOG;
const args = process.argv.slice(2);
const state = JSON.parse(readFileSync(stateFile, 'utf8'));
const log = JSON.parse(readFileSync(logFile, 'utf8'));
log.push(args);
writeFileSync(logFile, JSON.stringify(log));
const value = (name) => args[args.indexOf(name) + 1];
const bool = (name) => {
  const entry = args.find((candidate) => candidate === name || candidate.startsWith(name + '='));
  if (!entry) return undefined;
  return entry === name || entry.slice(name.length + 1) === 'true';
};
if (args[0] === 'release' && args[1] === 'view') {
  if (!state.exists) {
    process.stderr.write('release not found');
    process.exit(1);
  }
  if (args.includes('--json')) process.stdout.write(JSON.stringify(state.release));
  process.exit(0);
}
if (args[0] === 'release' && ['create', 'edit'].includes(args[1])) {
  const tag = args[2];
  if (process.env.RELEASE_TEST_HOLD_METADATA !== '1') {
    state.exists = true;
    state.tagSha = process.env.RELEASE_TEST_FORCED_TAG_SHA || value('--target');
    state.release = {
      tagName: tag,
      targetCommitish: value('--target'),
      isPrerelease: bool('--prerelease')
    };
    state.latestTag = bool('--latest') ? tag : (state.latestTag === tag ? 'v0.1.0' : state.latestTag);
    state.latestLookupMode = 'normal';
    writeFileSync(stateFile, JSON.stringify(state));
  }
  process.exit(0);
}
if (args[0] === 'api' && args[1].endsWith('/releases/latest')) {
  if (state.latestLookupMode === 'not-found' || !state.latestTag) {
    process.stderr.write('HTTP 404: release not found');
    process.exit(1);
  }
  if (state.latestLookupMode === 'error') {
    process.stderr.write('authentication failed');
    process.exit(1);
  }
  process.stdout.write(state.latestTag);
  process.exit(0);
}
process.stderr.write('unsupported gh invocation: ' + args.join(' '));
process.exit(2);
`;
}

function fakeGitSource() {
  return `#!/usr/bin/env node
import { readFileSync } from 'node:fs';
const args = process.argv.slice(2);
const state = JSON.parse(readFileSync(process.env.RELEASE_TEST_STATE, 'utf8'));
if (args[0] === 'fetch') process.exit(0);
if (args[0] === 'rev-list' && args[1] === '-n' && args[2] === '1') {
  if (state.tagSha) process.stdout.write(state.tagSha + '\\n');
  process.exit(state.tagSha ? 0 : 1);
}
process.stderr.write('unsupported git invocation: ' + args.join(' '));
process.exit(2);
`;
}
