import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { recordVerificationEvidence } from '../src/verification-evidence.js';
import { recordAgentReview } from '../src/agent-review.js';
import { createHumanDecision } from '../src/human-decision-checkpoint.js';
import { buildSafeActionPlan, runSafeActionPlan } from '../src/safe-action-orchestrator.js';
import { createRunLineageEnvelope, RunLineageError } from '../src/run-lineage.js';

const run = promisify(execFile);

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vibepro-lineage-evidence-'));
  await run('git', ['init', '-b', 'main'], { cwd: root });
  await run('git', ['config', 'user.email', 'vibepro@example.com'], { cwd: root });
  await run('git', ['config', 'user.name', 'VibePro Test'], { cwd: root });
  await writeFile(path.join(root, 'README.md'), '# fixture\n');
  await run('git', ['add', 'README.md'], { cwd: root });
  await run('git', ['commit', '-m', 'fixture'], { cwd: root });
  await mkdir(path.join(root, '.vibepro'), { recursive: true });
  await writeFile(path.join(root, '.vibepro', 'vibepro-manifest.json'), JSON.stringify({
    schema_version: '0.1.0', selected_story_id: 'story-lineage'
  }));
  const { stdout } = await run('git', ['rev-parse', 'HEAD'], { cwd: root });
  const head = stdout.trim();
  const authority = {
    story_id: 'story-lineage',
    run_id: 'run-20260721T010203Z-01020304',
    worktree_root: root,
    branch: 'main',
    head_sha: head
  };
  return { root, authority, lineage: createRunLineageEnvelope({ ...authority, dispatch_id: 'dispatch-test' }) };
}

test('authoritative evidence recorders inherit validated Run lineage additively', async () => {
  const { root, authority, lineage } = await fixture();
  const verification = await recordVerificationEvidence(root, {
    storyId: authority.story_id,
    kind: 'unit',
    status: 'fail',
    summary: 'fixture failure',
    runLineage: lineage
  });
  assert.deepEqual(verification.evidence.commands[0].lineage, lineage);

  const review = await recordAgentReview(root, {
    storyId: authority.story_id,
    stage: 'gate',
    role: 'gate_evidence',
    status: 'needs_changes',
    summary: 'fixture review',
    runLineage: lineage
  });
  assert.deepEqual(review.review.lineage, lineage);

  const state = {
    ...authority,
    current_head_sha: authority.head_sha,
    status: 'waiting_for_human',
    execution_context: { root_realpath: root, branch: authority.branch },
    pending_decision: null,
    lineage
  };
  const decision = await createHumanDecision(root, state, {
    type: 'scope_split',
    question: 'Split?',
    material_reason: 'The execution boundary changes.',
    impact_scope: ['execution']
  });
  assert.deepEqual(decision.lineage, lineage);

  const actionState = {
    ...state,
    status: 'running',
    action_journal: [],
    lineage,
    current_branch: authority.branch
  };
  const plan = buildSafeActionPlan(actionState);
  assert.deepEqual(plan[0].lineage, lineage);
  const executed = await runSafeActionPlan(actionState, {
    plan,
    runners: {
      pr_prepare: async () => ({ status: 'completed', summary: 'done' }),
      pr_autopilot_safe: async () => ({ status: 'completed', summary: 'done' })
    }
  });
  assert.deepEqual(executed.state.action_journal[0].lineage, lineage);
});

test('explicit Story or Run lineage mismatch fails before verification write', async () => {
  const { root, authority, lineage } = await fixture();
  const mismatched = { ...lineage, story_id: 'story-other' };
  await assert.rejects(
    recordVerificationEvidence(root, {
      storyId: authority.story_id,
      kind: 'unit',
      status: 'fail',
      runLineage: mismatched
    }),
    (error) => error instanceof RunLineageError && error.code === 'run_lineage_mismatch'
  );
  await assert.rejects(
    readFile(path.join(root, '.vibepro', 'pr', authority.story_id, 'verification-evidence.json')),
    { code: 'ENOENT' }
  );
});
