import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

import { getExecutionStatus } from '../../src/execution-state.js';

// story-vibepro-execution-judgment-status-integrity ac:1 ac:2
// `vibepro execute status` が merge 済み artifact を読むと、execution_dag の
// agent_review_recorded と pr_created が pending のまま残らないこと、および
// その導出が explicit delivery のある artifact には適用されないことを、
// 実際に src/execution-state.js を実行して固定する。
//
// 対象分岐: src/execution-state.js deriveCompletedPhases()
//   if (agentReviewSatisfied || (merged && !hasExplicitDelivery)) phases.push('agent_review');
// この分岐の `merged && !hasExplicitDelivery` 側は他のテストで実行されていない。

const execFileAsync = promisify(execFile);

async function makeMergedStoryRepo(buildPrMerge, { storyId = 'story-execution-judgment' } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vibepro-ejsi-e2e-'));
  await execFileAsync('git', ['init'], { cwd: root });
  await execFileAsync('git', ['config', 'user.email', 'test@example.test'], { cwd: root });
  await execFileAsync('git', ['config', 'user.name', 'VibePro Test'], { cwd: root });
  await writeFile(path.join(root, 'README.md'), '# fixture\n');
  await execFileAsync('git', ['add', 'README.md'], { cwd: root });
  await execFileAsync('git', ['commit', '-m', 'test: initialize fixture'], { cwd: root });
  const { stdout } = await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: root });
  const headSha = stdout.trim();

  const prDir = path.join(root, '.vibepro', 'pr', storyId);
  await mkdir(prDir, { recursive: true });
  await writeFile(
    path.join(prDir, 'pr-merge.json'),
    JSON.stringify({
      schema_version: '0.1.0',
      story: { story_id: storyId },
      current_head_sha: headSha,
      ...buildPrMerge(headSha)
    })
  );
  return { root, storyId, headSha };
}

function findNode(state, id) {
  return state.execution_dag.nodes.find((node) => node.id === id);
}

test('story-vibepro-execution-judgment-status-integrity ac:1 ac:2 S-001 a merged artifact without explicit delivery leaves neither agent_review_recorded nor pr_created pending', async () => {
  const { root, storyId } = await makeMergedStoryRepo((headSha) => ({
    status: 'merged',
    merge_commit_sha: headSha,
    merged_at: '2026-07-28T00:00:00.000Z'
  }));

  const result = await getExecutionStatus(root, { storyId, baseRef: 'main' });

  // The merged fact is reconstructed from the artifact, not from stored state.
  assert.equal(result.state.completed_phases.includes('merge'), true);

  // ac:1 the two nodes that previously stayed pending are recomputed as passed.
  assert.equal(findNode(result.state, 'agent_review_recorded').status, 'passed');
  assert.equal(findNode(result.state, 'pr_created').status, 'passed');

  // ac:2 the phase list backing those nodes is derived from the artifact.
  assert.equal(result.state.completed_phases.includes('agent_review'), true);
  assert.equal(
    findNode(result.state, 'agent_review_recorded').reason,
    'required agent review evidence is complete'
  );
});

test('story-vibepro-execution-judgment-status-integrity ac:1 ac:2 S-003 an explicit delivery artifact does not infer agent review completion', async () => {
  const { root, storyId } = await makeMergedStoryRepo((headSha) => ({
    status: 'merged_externally',
    delivery: { status: 'merged_externally', merge_commit_sha: headSha },
    reconciliation: { status: 'reconciled', reasons: [] }
  }));

  const result = await getExecutionStatus(root, { storyId, baseRef: 'main' });

  // Delivery is still recognised, so the PR itself is not pending.
  assert.equal(result.state.completed_phases.includes('merge'), true);
  assert.equal(findNode(result.state, 'pr_created').status, 'passed');

  // But an explicitly delivered Story must not fabricate agent review evidence
  // it never recorded; the node stays pending with the honest reason.
  assert.equal(result.state.completed_phases.includes('agent_review'), false);
  assert.equal(findNode(result.state, 'agent_review_recorded').status, 'pending');
  assert.equal(
    findNode(result.state, 'agent_review_recorded').reason,
    'agent review is not complete yet'
  );
});

test('story-vibepro-execution-judgment-status-integrity ac:1 an unverified delivery neither infers agent review nor reports the Story merged', async () => {
  const { root, storyId } = await makeMergedStoryRepo(() => ({
    status: 'merged',
    stop_reason: 'delivery_not_verified',
    merge_commit_sha: 'legacy-sha-must-not-win',
    merged_at: '2026-07-28T00:00:00.000Z',
    delivery: { status: 'unverified' },
    reconciliation: { status: 'blocked', reasons: ['delivery_not_verified'] }
  }));

  const result = await getExecutionStatus(root, { storyId, baseRef: 'main' });

  assert.equal(result.state.completion_status, 'blocked');
  assert.equal(result.state.completed_phases.includes('merge'), false);
  assert.equal(result.state.completed_phases.includes('agent_review'), false);
  assert.equal(findNode(result.state, 'agent_review_recorded').status, 'pending');
});
