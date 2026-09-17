import '../support/scratch-tmpdir.js';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

import { runCli } from '../../src/cli.js';

const execFileAsync = promisify(execFile);
const STORY_ID = 'story-bug-fix-scope-integration';

test('bug PRs keep external outcomes unknown without reviving the diagnosis DAG', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vibepro-bug-fix-scope-'));
  await writeFile(path.join(root, 'index.js'), 'export const value = true;\n');
  await mkdir(path.join(root, 'test'));
  await writeFile(
    path.join(root, 'test', 'unit.test.js'),
    "import test from 'node:test';\nimport assert from 'node:assert/strict';\ntest('unit passes', () => assert.equal(true, true));\n"
  );
  await execFileAsync('git', ['init', '-b', 'main'], { cwd: root });
  await execFileAsync('git', ['config', 'user.email', 'vibepro@example.com'], { cwd: root });
  await execFileAsync('git', ['config', 'user.name', 'VibePro Test'], { cwd: root });
  await runCli(['init', root]);
  await runCli([
    'story', 'add', root,
    '--id', STORY_ID,
    '--title', 'Generate and deliver the complete meeting minutes',
    '--contract-type', 'bug_fix'
  ]);
  await execFileAsync('git', ['add', '.'], { cwd: root });
  await execFileAsync('git', ['commit', '-m', 'initialize bug story'], { cwd: root });
  await execFileAsync('git', ['switch', '-c', 'fix/meeting-minutes'], { cwd: root });

  const unverified = await runCli(['pr', 'prepare', root, '--story-id', STORY_ID, '--base', 'main', '--json']);
  assert.equal(unverified.exitCode, 0);
  const unverifiedArtifact = JSON.parse(await readFile(path.join(root, '.vibepro', 'pr', STORY_ID, 'pr-prepare.json'), 'utf8'));
  assert.equal(unverifiedArtifact.fix_scope.status, 'partial_fix');
  assert.equal(unverifiedArtifact.fix_scope.completion_claim, 'implementation_unverified_external_outcome_unknown');

  const verification = await runCli([
    'verify', 'run', root,
    '--id', STORY_ID,
    '--kind', 'unit',
    '--target', 'test/unit.test.js',
    '--scenario', 'local unit verifies the implementation only',
    '--', 'node', '--test', 'test/unit.test.js'
  ]);
  assert.equal(verification.exitCode, 0);

  const prepared = await runCli(['pr', 'prepare', root, '--story-id', STORY_ID, '--base', 'main', '--json']);
  assert.equal(prepared.exitCode, 0);
  const artifact = JSON.parse(await readFile(path.join(root, '.vibepro', 'pr', STORY_ID, 'pr-prepare.json'), 'utf8'));

  assert.equal(artifact.gate_status, 'ready');
  assert.equal('bug_diagnosis' in artifact, false);
  assert.equal(artifact.fix_scope.status, 'partial_fix');
  assert.equal(artifact.fix_scope.original_problem, 'Generate and deliver the complete meeting minutes');
  assert.equal(artifact.fix_scope.completion_claim, 'implementation_verified_external_outcome_unknown');
  assert.ok(artifact.fix_scope.unconfirmed_boundaries.includes('downstream_outcome'));
  assert.ok(artifact.fix_scope.unconfirmed_boundaries.includes('canonical_readback'));
  assert.equal(
    artifact.execution_dag.nodes.some((node) => [
      'failure_reproduced',
      'root_cause_confirmed',
      'same_path_reverified'
    ].includes(node.id)),
    false
  );

  const body = await readFile(path.join(root, '.vibepro', 'pr', STORY_ID, 'pr-body.md'), 'utf8');
  assert.match(body, /### Fix scope/);
  assert.match(body, /status: `partial_fix`/);
  assert.match(body, /completion claim: `implementation_verified_external_outcome_unknown`/);
  assert.match(body, /downstream_outcome/);
  assert.match(body, /canonical_readback/);
  assert.doesNotMatch(body, /Bug diagnosis DAG/);
  assert.doesNotMatch(body, /root_cause_confirmed/);
  assert.doesNotMatch(body, /same_path_reverified/);
  assert.doesNotMatch(body, /verified_complete/);
});
