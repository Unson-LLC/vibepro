import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { resolveBuildSourceCommit } from '../scripts/build-public-manual.mjs';

test('public manual build provenance is fixed before generated files can make the build look dirty', async (t) => {
  const repository = await mkdtemp(path.join(os.tmpdir(), 'vibepro-build-source-'));
  t.after(() => rm(repository, { recursive: true, force: true }));

  git(repository, 'init');
  await writeFile(path.join(repository, 'tracked.md'), 'clean\n');
  git(repository, 'add', 'tracked.md');
  git(repository, '-c', 'user.name=VibePro Test', '-c', 'user.email=test@vibepro.local', 'commit', '-m', 'initial');

  const head = git(repository, 'rev-parse', '--short=12', 'HEAD');
  assert.equal(resolveBuildSourceCommit(repository), head);

  await writeFile(path.join(repository, 'generated.tmp'), 'generated\n');
  assert.equal(resolveBuildSourceCommit(repository), `${head}-dirty`);
});

function git(cwd, ...args) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore']
  }).trim();
}
