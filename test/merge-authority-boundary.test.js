import './support/scratch-tmpdir.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { TOP_LEVEL_COMMANDS } from '../src/cli.js';

const entrypointPath = fileURLToPath(new URL('../bin/vibepro.js', import.meta.url));

test('story-vibepro-retire-execute-merge-authority: execute is not a CLI command', () => {
  assert.equal(TOP_LEVEL_COMMANDS.includes('execute'), false);
});

test('story-vibepro-retire-execute-merge-authority: retired execute merge cannot invoke gh', async (t) => {
  const fakeBin = await mkdtemp(path.join(os.tmpdir(), 'vibepro-retired-merge-'));
  const ghCallLog = path.join(fakeBin, 'gh-called.log');
  t.after(() => rm(fakeBin, { recursive: true, force: true }));
  await writeFile(path.join(fakeBin, 'gh'), `#!/usr/bin/env node\nrequire('node:fs').writeFileSync(${JSON.stringify(ghCallLog)}, 'called');\nprocess.exit(99);\n`);
  await chmod(path.join(fakeBin, 'gh'), 0o755);

  const result = spawnSync(process.execPath, [entrypointPath, 'execute', 'merge', '.'], {
    encoding: 'utf8',
    env: { ...process.env, PATH: `${fakeBin}${path.delimiter}${process.env.PATH}` }
  });

  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /Unknown command: execute/);
  await assert.rejects(readFile(ghCallLog, 'utf8'), { code: 'ENOENT' });
});

test('story-vibepro-retire-execute-merge-authority: public contracts leave merge to GitHub', async () => {
  const [readme, readmeJa, contractText, cliSource, prManagerSource, reconciliationSource] = await Promise.all([
    readFile(new URL('../README.md', import.meta.url), 'utf8'),
    readFile(new URL('../README.ja.md', import.meta.url), 'utf8'),
    readFile(new URL('../docs/contracts/vibepro-core-responsibilities.json', import.meta.url), 'utf8'),
    readFile(new URL('../src/cli.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/pr-manager.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/reconciliation-action.js', import.meta.url), 'utf8')
  ]);
  const contract = JSON.parse(contractText);
  const prResponsibility = contract.clauses.find((clause) => clause.id === 'VIBE-CORE-PR-001');

  assert.match(readme, /normal GitHub PR, review, and merge flow is canonical/);
  assert.match(readmeJa, /通常のGitHub PR・レビュー・マージの流れが正本/);
  assert.match(prResponsibility.statement, /must not execute or grant authority for a GitHub merge/);
  assert.doesNotMatch(cliSource, /merge-manager/);
  assert.doesNotMatch(prManagerSource, /gh\s+pr\s+merge/);
  assert.doesNotMatch(reconciliationSource, /vibepro execute merge/);
});
