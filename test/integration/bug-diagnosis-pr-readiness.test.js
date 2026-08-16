import '../support/scratch-tmpdir.js';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

import { createBugDiagnosisEvidence, recordBugDiagnosisNodeResult } from '../../src/bug-diagnosis-dag.js';
import { runCli } from '../../src/cli.js';

const execFileAsync = promisify(execFile);
const STORY_ID = 'story-bug-diagnosis-integration';

test('passing unit test cannot make a bug Story PR-ready without actual failure-path evidence', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vibepro-bug-dag-'));
  await writeFile(path.join(root, 'index.js'), 'export const value = true;\n');
  await mkdir(path.join(root, 'test'), { recursive: true });
  await writeFile(path.join(root, 'test', 'unit.test.js'), "import test from 'node:test';\nimport assert from 'node:assert/strict';\ntest('unit passes', () => assert.equal(true, true));\n");
  await execFileAsync('git', ['init', '-b', 'main'], { cwd: root });
  await execFileAsync('git', ['config', 'user.email', 'vibepro@example.com'], { cwd: root });
  await execFileAsync('git', ['config', 'user.name', 'VibePro Test'], { cwd: root });
  await runCli(['init', root]);
  await runCli(['story', 'add', root, '--id', STORY_ID, '--title', 'Bug diagnosis integration', '--contract-type', 'bug_fix']);
  await execFileAsync('git', ['add', '.'], { cwd: root });
  await execFileAsync('git', ['commit', '-m', 'initialize bug story'], { cwd: root });
  await execFileAsync('git', ['switch', '-c', 'fix/bug-diagnosis'], { cwd: root });
  const { stdout: headOutput } = await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' });
  const headSha = headOutput.trim();

  const runId = 'bug-run-integration';
  const runDir = path.join(root, '.vibepro', 'bug-diagnosis', STORY_ID, runId);
  await mkdir(runDir, { recursive: true });
  const evidence = createBugDiagnosisEvidence({ storyId: STORY_ID, runId, targetHeadSha: headSha });
  await writeFile(path.join(runDir, 'bug-diagnosis.json'), `${JSON.stringify(evidence, null, 2)}\n`);
  const manifestPath = path.join(root, '.vibepro', 'vibepro-manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  manifest.latest_run = runId;
  manifest.latest_run_by_story = { ...(manifest.latest_run_by_story ?? {}), [STORY_ID]: runId };
  manifest.runs = [{
    run_id: runId,
    story_id: STORY_ID,
    gate_status: 'needs_review',
    artifacts: { bug_diagnosis: `.vibepro/bug-diagnosis/${STORY_ID}/${runId}/bug-diagnosis.json` }
  }, ...(manifest.runs ?? [])];
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  const snapshot = await runCli(['store', 'snapshot', root, '--story-id', STORY_ID, '--json']);
  assert.equal(snapshot.exitCode, 0);
  await rm(path.join(root, '.vibepro', 'bug-diagnosis'), { recursive: true, force: true });
  const freshManifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  freshManifest.latest_run_by_story = {};
  freshManifest.runs = (freshManifest.runs ?? []).filter((item) => item.story_id !== STORY_ID);
  await writeFile(manifestPath, `${JSON.stringify(freshManifest, null, 2)}\n`);
  const hydrate = await runCli(['store', 'hydrate', root, '--story-id', STORY_ID, '--json']);
  assert.equal(hydrate.exitCode, 0);

  let verificationError = '';
  const verification = await runCli([
    'verify', 'record', root,
    '--id', STORY_ID,
    '--kind', 'unit',
    '--status', 'pass',
    '--command', 'node --test test/unit.test.js',
    '--observed', 'tests=1',
    '--observed', 'pass=1',
    '--observed', 'fail=0'
  ], { stderr: { write: (chunk) => { verificationError += chunk; } } });
  assert.equal(verification.exitCode, 0, `${JSON.stringify(verification)} ${verificationError}`);

  const prepared = await runCli(['pr', 'prepare', root, '--story-id', STORY_ID, '--base', 'main', '--json']);
  assert.equal(prepared.exitCode, 0, 'pr prepare must persist the blocked gate for inspection');
  const artifact = JSON.parse(await readFile(path.join(root, '.vibepro', 'pr', STORY_ID, 'pr-prepare.json'), 'utf8'));
  assert.equal(artifact.verification.commands[0].status, 'pass');
  assert.equal(artifact.bug_diagnosis.run_id, runId, 'hydrated diagnosis must remain discoverable without manifest run pointers');
  assert.equal(artifact.gate_status, 'blocked');
  assert.equal(artifact.bug_diagnosis.return_to_node, 'failure_reproduced');
  assert.equal(artifact.execution_dag.nodes.find((node) => node.id === 'implementation_complete').status, 'blocked');
  assert.deepEqual(
    artifact.execution_dag.edges.find((edge) => edge.from === 'implementation_started'),
    { from: 'implementation_started', to: 'failure_reproduced' }
  );
  const body = await readFile(path.join(root, '.vibepro', 'pr', STORY_ID, 'pr-body.md'), 'utf8');
  assert.match(body, /### Bug diagnosis DAG/);
  assert.match(body, /- gate: blocked/);
  assert.match(body, /- return_to_node: `failure_reproduced`/);

  let createError = '';
  const create = await runCli(
    ['pr', 'create', root, '--story-id', STORY_ID, '--base', 'main', '--dry-run'],
    { stderr: { write: (chunk) => { createError += chunk; } } }
  );
  assert.equal(create.exitCode, 1);
  assert.match(createError, /PR creation blocked: bug_diagnosis:failure_reproduced/);
});

test('a diagnosis accepted at an older HEAD becomes blocked before PR preparation', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vibepro-bug-dag-stale-'));
  await writeFile(path.join(root, 'index.js'), 'export const value = true;\n');
  await execFileAsync('git', ['init', '-b', 'main'], { cwd: root });
  await execFileAsync('git', ['config', 'user.email', 'vibepro@example.com'], { cwd: root });
  await execFileAsync('git', ['config', 'user.name', 'VibePro Test'], { cwd: root });
  await runCli(['init', root]);
  await runCli(['story', 'add', root, '--id', STORY_ID, '--title', 'Stale diagnosis integration', '--contract-type', 'bug_fix']);
  await execFileAsync('git', ['add', '.'], { cwd: root });
  await execFileAsync('git', ['commit', '-m', 'initialize stale diagnosis story'], { cwd: root });
  const { stdout: diagnosedHeadOutput } = await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' });
  const diagnosedHead = diagnosedHeadOutput.trim();

  let evidence = createBugDiagnosisEvidence({ storyId: STORY_ID, runId: 'stale-run', targetHeadSha: diagnosedHead });
  for (const nodeId of [
    'failure_reproduced',
    'failure_localized',
    'preconditions_confirmed',
    'root_cause_confirmed',
    'root_fix_applied',
    'same_path_reverified'
  ]) {
    evidence = recordBugDiagnosisNodeResult(evidence, {
      nodeId,
      status: 'passed',
      headSha: diagnosedHead,
      evidenceRefs: [`evidence/${nodeId}.json`],
      pathId: ['failure_reproduced', 'same_path_reverified'].includes(nodeId) ? 'actual-http-path' : undefined
    });
    if (nodeId === 'failure_localized') {
      evidence = recordBugDiagnosisNodeResult(evidence, {
        nodeId: 'relationship_analysis',
        status: 'not_applicable',
        reason: 'single synchronous module path has no additional relationship to inspect',
        headSha: diagnosedHead
      });
    }
    if (nodeId === 'root_cause_confirmed') {
      evidence = recordBugDiagnosisNodeResult(evidence, {
        nodeId: 'regression_test_failed_before_fix',
        status: 'not_applicable',
        reason: 'external boundary cannot be deterministically reproduced in a local regression test',
        headSha: diagnosedHead
      });
    }
  }
  assert.equal(evidence.status, 'ready');

  const runDir = path.join(root, '.vibepro', 'bug-diagnosis', STORY_ID, 'stale-run');
  await mkdir(runDir, { recursive: true });
  await writeFile(path.join(runDir, 'bug-diagnosis.json'), `${JSON.stringify(evidence, null, 2)}\n`);
  const manifestPath = path.join(root, '.vibepro', 'vibepro-manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  manifest.latest_run_by_story = { ...(manifest.latest_run_by_story ?? {}), [STORY_ID]: 'stale-run' };
  manifest.runs = [{
    run_id: 'stale-run',
    story_id: STORY_ID,
    gate_status: 'ready',
    artifacts: { bug_diagnosis: `.vibepro/bug-diagnosis/${STORY_ID}/stale-run/bug-diagnosis.json` }
  }, ...(manifest.runs ?? [])];
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  await writeFile(path.join(root, 'index.js'), 'export const value = false;\n');
  await execFileAsync('git', ['add', 'index.js'], { cwd: root });
  await execFileAsync('git', ['commit', '-m', 'advance head after diagnosis'], { cwd: root });

  const prepared = await runCli(['pr', 'prepare', root, '--story-id', STORY_ID, '--base', 'main', '--json']);
  assert.equal(prepared.exitCode, 0);
  const artifact = JSON.parse(await readFile(path.join(root, '.vibepro', 'pr', STORY_ID, 'pr-prepare.json'), 'utf8'));
  assert.equal(artifact.gate_status, 'blocked');
  assert.equal(artifact.bug_diagnosis.return_to_node, 'failure_reproduced');
  assert.match(artifact.bug_diagnosis.failures[0].reason, /evidence is stale/);
  assert.notEqual(artifact.git.head_sha, artifact.bug_diagnosis.target_head_sha);
});
