import './support/scratch-tmpdir.js';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

import {
  BUG_DIAGNOSIS_NODES,
  createBugDiagnosisEvidence,
  recordBugDiagnosisNode,
  recordBugDiagnosisNodeResult,
  writeInitialBugDiagnosis
} from '../src/bug-diagnosis-dag.js';
import { runCli } from '../src/cli.js';
import { buildExecutionDag } from '../src/managed-worktree.js';

const execFileAsync = promisify(execFile);
const STORY_ID = 'story-bug-diagnosis-integration';
const HEAD = 'a'.repeat(40);

test('bug Story execution plan exposes the ordered diagnosis nodes with Story/run/HEAD evidence bindings', () => {
  const bugDiagnosis = createBugDiagnosisEvidence({
    storyId: STORY_ID,
    runId: 'bug-run-1',
    targetHeadSha: HEAD
  });
  const execution = buildExecutionDag({
    managedWorktree: { mode: 'disabled' },
    bugDiagnosis
  });
  const ids = execution.nodes.map((node) => node.id);
  const expected = BUG_DIAGNOSIS_NODES.map((node) => node.id);
  const positions = expected.map((id) => ids.indexOf(id));

  assert.deepEqual(ids.filter((id) => expected.includes(id)), expected);
  assert.ok(positions.every((position) => position > ids.indexOf('implementation_started')));
  assert.ok(positions.every((position) => position < ids.indexOf('implementation_complete')));
  const reproduction = execution.nodes.find((node) => node.id === 'failure_reproduced');
  assert.deepEqual(reproduction.evidence, {
    story_id: STORY_ID,
    run_id: 'bug-run-1',
    head_sha: null,
    evidence_refs: [],
    path_id: null,
    analyses: []
  });
  assert.equal(execution.nodes.find((node) => node.id === 'implementation_complete').status, 'blocked');
});

test('bug diagnosis fails closed, selects only necessary analyses, and requires same-path reverification', () => {
  let evidence = createBugDiagnosisEvidence({ storyId: STORY_ID, runId: 'bug-run-2', targetHeadSha: HEAD });
  assert.equal(evidence.status, 'blocked');
  assert.equal(evidence.return_to_node, 'failure_reproduced');

  const record = (nodeId, extra = {}) => {
    evidence = recordBugDiagnosisNodeResult(evidence, {
      nodeId,
      status: 'passed',
      headSha: HEAD,
      evidenceRefs: [`evidence/${nodeId}.json`],
      ...extra
    });
  };
  record('failure_reproduced', { pathId: 'http-checkout-500' });
  record('failure_localized');
  assert.throws(
    () => recordBugDiagnosisNodeResult(evidence, {
      nodeId: 'relationship_analysis',
      status: 'passed',
      headSha: HEAD,
      evidenceRefs: ['evidence/relationship.json'],
      analyses: ['analyze_everything']
    }),
    /unknown relationship analysis/
  );
  record('relationship_analysis', { analyses: ['data_flow'] });
  record('preconditions_confirmed');
  record('root_cause_confirmed');
  evidence = recordBugDiagnosisNodeResult(evidence, {
    nodeId: 'regression_test_failed_before_fix',
    status: 'not_applicable',
    reason: '障害境界が外部サービスで、決定的なローカル回帰テストを作れないため',
    headSha: HEAD
  });
  record('root_fix_applied');

  assert.throws(
    () => recordBugDiagnosisNodeResult(evidence, {
      nodeId: 'same_path_reverified',
      status: 'passed',
      headSha: HEAD,
      pathId: 'unit-only',
      evidenceRefs: ['evidence/unit.json']
    }),
    /does not match reproduced path_id/
  );

  evidence = recordBugDiagnosisNodeResult(evidence, {
    nodeId: 'same_path_reverified',
    status: 'failed',
    headSha: HEAD,
    pathId: 'http-checkout-500',
    evidenceRefs: ['evidence/reverification-failed.json'],
    reason: '同じHTTP経路で500が再発した'
  });
  assert.equal(evidence.status, 'blocked');
  assert.equal(evidence.return_to_node, 'same_path_reverified');
  assert.match(evidence.next_actions[0], /same_path_reverified/);

  record('same_path_reverified', { pathId: 'http-checkout-500' });
  assert.equal(evidence.status, 'ready');
  assert.equal(evidence.return_to_node, null);
  assert.deepEqual(
    evidence.nodes.find((node) => node.id === 'relationship_analysis').analyses,
    ['data_flow']
  );

  evidence = recordBugDiagnosisNodeResult(evidence, {
    nodeId: 'same_path_reverified',
    status: 'passed',
    headSha: 'b'.repeat(40),
    pathId: 'http-checkout-500',
    evidenceRefs: ['evidence/new-head-reverification.json']
  });
  assert.equal(evidence.status, 'blocked');
  assert.equal(evidence.return_to_node, 'failure_reproduced');
  assert.match(evidence.failures[0].reason, /does not match diagnosis target HEAD/);
});

test('diagnosis artifact discovery rejects Story and run path traversal before filesystem access', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vibepro-bug-path-boundary-'));
  await assert.rejects(
    recordBugDiagnosisNode(root, { storyId: '../../../outside-story', nodeId: 'failure_reproduced', status: 'passed' }),
    /valid Story id/
  );
  await assert.rejects(
    recordBugDiagnosisNode(root, { storyId: STORY_ID, runId: '../../../../outside-run', nodeId: 'failure_reproduced', status: 'passed' }),
    /valid run id/
  );
  await assert.rejects(
    writeInitialBugDiagnosis(root, {
      story: { story_id: STORY_ID, contract_type: 'bug_fix' },
      runId: '../outside-run'
    }),
    /valid run id/
  );

  const runId = 'manifest-escape-run';
  const outsidePath = path.join(path.dirname(root), `${path.basename(root)}-outside.json`);
  const outsideEvidence = createBugDiagnosisEvidence({ storyId: STORY_ID, runId, targetHeadSha: HEAD });
  await writeFile(outsidePath, `${JSON.stringify(outsideEvidence, null, 2)}\n`);
  await mkdir(path.join(root, '.vibepro'), { recursive: true });
  await writeFile(path.join(root, '.vibepro', 'vibepro-manifest.json'), `${JSON.stringify({
    latest_run_by_story: { [STORY_ID]: runId },
    runs: [{
      run_id: runId,
      story_id: STORY_ID,
      artifacts: { bug_diagnosis: path.relative(root, outsidePath) }
    }]
  }, null, 2)}\n`);
  await assert.rejects(
    recordBugDiagnosisNode(root, {
      storyId: STORY_ID,
      nodeId: 'failure_reproduced',
      status: 'passed',
      pathId: 'outside-path',
      evidenceRefs: ['outside.json']
    }),
    /escapes its configured directory/
  );
  assert.equal(JSON.parse(await readFile(outsidePath, 'utf8')).nodes[0].status, 'pending');

  const linkedPath = path.join(root, '.vibepro', 'linked-diagnosis.json');
  await symlink(outsidePath, linkedPath);
  await writeFile(path.join(root, '.vibepro', 'vibepro-manifest.json'), `${JSON.stringify({
    latest_run_by_story: { [STORY_ID]: runId },
    runs: [{ run_id: runId, story_id: STORY_ID, artifacts: { bug_diagnosis: '.vibepro/linked-diagnosis.json' } }]
  }, null, 2)}\n`);
  await assert.rejects(
    recordBugDiagnosisNode(root, { storyId: STORY_ID, nodeId: 'failure_reproduced', status: 'passed' }),
    /escapes its configured directory/
  );
  assert.equal(JSON.parse(await readFile(outsidePath, 'utf8')).nodes[0].status, 'pending');
});

test('initial diagnosis creation rejects a Story directory symlink before writing outside the workspace', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vibepro-bug-initial-symlink-'));
  const outsideDir = await mkdtemp(path.join(os.tmpdir(), 'vibepro-bug-initial-outside-'));
  await execFileAsync('git', ['init', '-b', 'main'], { cwd: root });
  await execFileAsync('git', ['config', 'user.email', 'vibepro@example.com'], { cwd: root });
  await execFileAsync('git', ['config', 'user.name', 'VibePro Test'], { cwd: root });
  await writeFile(path.join(root, 'index.js'), 'export const value = true;\n');
  await execFileAsync('git', ['add', 'index.js'], { cwd: root });
  await execFileAsync('git', ['commit', '-m', 'initialize repository'], { cwd: root });
  const diagnosisRoot = path.join(root, '.vibepro', 'bug-diagnosis');
  await mkdir(diagnosisRoot, { recursive: true });
  await symlink(outsideDir, path.join(diagnosisRoot, STORY_ID));

  await assert.rejects(
    writeInitialBugDiagnosis(root, {
      story: { story_id: STORY_ID, contract_type: 'bug_fix' },
      runId: 'initial-symlink-run'
    }),
    /escapes its configured directory/
  );
  await assert.rejects(
    readFile(path.join(outsideDir, 'initial-symlink-run', 'bug-diagnosis.json'), 'utf8'),
    (error) => error?.code === 'ENOENT'
  );
});

test('diagnosis artifacts cannot follow the bug-diagnosis directory into another repository area', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vibepro-bug-workspace-boundary-'));
  const trackedArea = path.join(root, 'tracked-area');
  await execFileAsync('git', ['init', '-b', 'main'], { cwd: root });
  await execFileAsync('git', ['config', 'user.email', 'vibepro@example.com'], { cwd: root });
  await execFileAsync('git', ['config', 'user.name', 'VibePro Test'], { cwd: root });
  await writeFile(path.join(root, 'index.js'), 'export const value = true;\n');
  await execFileAsync('git', ['add', 'index.js'], { cwd: root });
  await execFileAsync('git', ['commit', '-m', 'initialize repository'], { cwd: root });
  await mkdir(path.join(root, '.vibepro'), { recursive: true });
  await mkdir(trackedArea, { recursive: true });
  await symlink(trackedArea, path.join(root, '.vibepro', 'bug-diagnosis'));

  await assert.rejects(
    writeInitialBugDiagnosis(root, {
      story: { story_id: STORY_ID, contract_type: 'bug_fix' },
      runId: 'workspace-escape-run'
    }),
    /escapes its configured directory/
  );
  await assert.rejects(
    readFile(path.join(trackedArea, STORY_ID, 'workspace-escape-run', 'bug-diagnosis.json'), 'utf8'),
    (error) => error?.code === 'ENOENT'
  );

  const runId = 'manifest-workspace-escape';
  const artifactPath = path.join(trackedArea, STORY_ID, runId, 'bug-diagnosis.json');
  const evidence = createBugDiagnosisEvidence({ storyId: STORY_ID, runId, targetHeadSha: HEAD });
  await mkdir(path.dirname(artifactPath), { recursive: true });
  await writeFile(artifactPath, `${JSON.stringify(evidence, null, 2)}\n`);
  await writeFile(path.join(root, '.vibepro', 'vibepro-manifest.json'), `${JSON.stringify({
    latest_run_by_story: { [STORY_ID]: runId },
    runs: [{
      run_id: runId,
      story_id: STORY_ID,
      artifacts: { bug_diagnosis: `.vibepro/bug-diagnosis/${STORY_ID}/${runId}/bug-diagnosis.json` }
    }]
  }, null, 2)}\n`);
  await assert.rejects(
    recordBugDiagnosisNode(root, {
      storyId: STORY_ID,
      nodeId: 'failure_reproduced',
      status: 'passed',
      pathId: 'workspace-path',
      evidenceRefs: ['workspace.json']
    }),
    /escapes its configured directory/
  );
  assert.equal(JSON.parse(await readFile(artifactPath, 'utf8')).nodes[0].status, 'pending');
});

test('manifest diagnosis artifact must identify the requested Story and run', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vibepro-bug-identity-'));
  const requestedRunId = 'requested-run';
  const artifactPath = path.join(root, '.vibepro', 'bug-diagnosis', 'story-other', 'other-run', 'bug-diagnosis.json');
  const otherEvidence = createBugDiagnosisEvidence({
    storyId: 'story-other',
    runId: 'other-run',
    targetHeadSha: HEAD
  });
  await mkdir(path.dirname(artifactPath), { recursive: true });
  await writeFile(artifactPath, `${JSON.stringify(otherEvidence, null, 2)}\n`);
  await writeFile(path.join(root, '.vibepro', 'vibepro-manifest.json'), `${JSON.stringify({
    latest_run_by_story: { [STORY_ID]: requestedRunId },
    runs: [{
      run_id: requestedRunId,
      story_id: STORY_ID,
      artifacts: { bug_diagnosis: path.relative(root, artifactPath) }
    }]
  }, null, 2)}\n`);

  await assert.rejects(
    recordBugDiagnosisNode(root, {
      storyId: STORY_ID,
      nodeId: 'failure_reproduced',
      status: 'passed',
      pathId: 'identity-path',
      evidenceRefs: ['identity.json']
    }),
    /identity does not match/
  );
  assert.equal(JSON.parse(await readFile(artifactPath, 'utf8')).nodes[0].status, 'pending');
});

test('deprecated verify-first entry routes a registered bug Story through story diagnose', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vibepro-verify-first-'));
  await writeFile(path.join(root, 'index.js'), 'export const value = true;\n');
  await execFileAsync('git', ['init', '-b', 'main'], { cwd: root });
  await execFileAsync('git', ['config', 'user.email', 'vibepro@example.com'], { cwd: root });
  await execFileAsync('git', ['config', 'user.name', 'VibePro Test'], { cwd: root });
  await runCli(['init', root]);
  await runCli(['story', 'add', root, '--id', STORY_ID, '--title', 'Bug diagnosis compatibility', '--contract-type', 'bug_fix']);
  const graphDir = path.join(root, 'graphify-out');
  await mkdir(graphDir, { recursive: true });
  await writeFile(path.join(graphDir, 'graph.json'), JSON.stringify({ nodes: [{ id: 'index.js' }], edges: [] }));
  await writeFile(path.join(graphDir, 'GRAPH_REPORT.md'), '# Graph Report\n');
  await execFileAsync('git', ['add', '.'], { cwd: root });
  await execFileAsync('git', ['commit', '-m', 'initialize bug story'], { cwd: root });

  let warning = '';
  const result = await runCli(
    ['verify-first', root, '--id', STORY_ID, '--from', 'graphify-out', '--run-id', 'compat-run'],
    { stderr: { write: (chunk) => { warning += chunk; } } }
  );

  assert.equal(result.exitCode, 0);
  assert.equal(result.command, 'verify-first');
  assert.equal(result.result.diagnosis.run.run_id, 'compat-run');
  assert.match(warning, /DEPRECATED/);
  const artifactPath = path.join(root, '.vibepro', 'bug-diagnosis', STORY_ID, 'compat-run', 'bug-diagnosis.json');
  assert.equal(JSON.parse(await readFile(artifactPath, 'utf8')).story_id, STORY_ID);
  const durablePath = path.join(root, '.vibepro-store', STORY_ID, 'bug-diagnosis', STORY_ID, 'compat-run', 'bug-diagnosis.json');
  assert.equal(JSON.parse(await readFile(durablePath, 'utf8')).nodes[0].status, 'pending');

  const record = await runCli([
    'bug', 'diagnose', 'record', root,
    '--id', STORY_ID,
    '--node', 'failure_reproduced',
    '--status', 'passed',
    '--path-id', 'compatibility-path',
    '--evidence', 'evidence/reproduction.json',
    '--json'
  ]);
  assert.equal(record.exitCode, 0);
  assert.equal(record.result.evidence.nodes[0].status, 'passed');
  assert.equal(JSON.parse(await readFile(durablePath, 'utf8')).nodes[0].status, 'passed');
});
