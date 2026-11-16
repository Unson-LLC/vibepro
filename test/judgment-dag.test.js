import assert from 'node:assert/strict';
import test from 'node:test';

import {
  addJudgmentEdge,
  addJudgmentNode,
  appendJudgmentEvaluation,
  createJudgmentDag,
  summarizeJudgmentDag,
  validateJudgmentDag
} from '../src/judgment-dag.js';

const createdAt = '2026-08-20T18:00:00+09:00';

function buildDogfoodDag() {
  let dag = createJudgmentDag({
    scope: 'vibepro:minimal-core-reassessment',
    storyId: 'story-vibepro-development-judgment-dag',
    eventId: 'event-vibepro-development-judgment-dag-dogfood',
    createdAt
  });

  dag = addJudgmentNode(dag, {
    id: 'judgment-old-gate-dag',
    question: 'How should VibePro make AI delivery safe and repeatable?',
    context_snapshot: { phase: 'pre-minimal-core', source: 'historical architecture' },
    options: [
      { id: 'comprehensive-gate-dag', summary: 'Combine judgment, policy, execution and audit in one Gate DAG', disposition: 'selected' },
      { id: 'lighter-evidence-core', summary: 'Keep only traceable evidence and human judgment', disposition: 'rejected' }
    ],
    judgment: 'A comprehensive Gate DAG can encode engineering judgment and safety checks.',
    decision: 'Build the comprehensive Gate DAG.',
    authority: { kind: 'human', ref: 'VibePro product owner' },
    runner_type: 'human',
    confidence: 0.7,
    status: 'accepted',
    expected_outcomes: [
      { id: 'safe-autonomy', statement: 'Increase safe autonomous delivery without increasing operator burden.' }
    ],
    recorded_at: createdAt
  });

  dag = addJudgmentNode(dag, {
    id: 'judgment-minimal-core',
    question: 'What should be removed after the Gate DAG became too large and operationally expensive?',
    context_snapshot: { phase: 'minimal-core-rebuild', source: 'REBUILD.md / beta.3 cleanup' },
    assumptions: ['Story, Spec, verification, review and PR evidence preserve the essential traceability value.'],
    options: [
      { id: 'keep-gate-dag', summary: 'Keep the comprehensive Gate DAG and simplify incrementally', disposition: 'rejected' },
      { id: 'minimal-core', summary: 'Remove generic Gate DAG and retain repository-local evidence core', disposition: 'selected' }
    ],
    evidence_refs: ['docs/management/rebuild-plan.md', 'CHANGELOG.md'],
    judgment: 'The combined control system had grown beyond the value of its safety guarantees.',
    decision: 'Rebuild around a minimal evidence core.',
    authority: { kind: 'human', ref: 'VibePro product owner' },
    runner_type: 'human',
    confidence: 0.85,
    status: 'accepted',
    expected_outcomes: [
      { id: 'lower-complexity', statement: 'Reduce product complexity and operator friction.' },
      { id: 'retain-traceability', statement: 'Retain Story-to-evidence traceability.' }
    ],
    recorded_at: createdAt
  });

  dag = addJudgmentNode(dag, {
    id: 'judgment-development-dag-kernel',
    question: 'How can VibePro retain the useful causal structure of engineering judgment without recreating Gate DAG coupling?',
    context_snapshot: { phase: 'post-minimal-core', source: 'development judgment DAG dogfood' },
    assumptions: ['Judgment history is useful even when it does not block execution.', 'Guardrail and Execution DAGs remain separate concerns.'],
    options: [
      { id: 'restore-old-gates', summary: 'Restore the former Gate DAG machinery', disposition: 'rejected' },
      { id: 'nonblocking-kernel', summary: 'Add a small append-only Judgment Node/Edge model with outcome evaluation', disposition: 'selected' }
    ],
    evidence_refs: ['src/judgment-dag.js'],
    judgment: 'The reusable primitive is causal judgment history, not a universal readiness gate.',
    decision: 'Introduce a non-blocking Development Judgment DAG kernel and dogfood it on VibePro itself.',
    authority: { kind: 'human', ref: 'VibePro product owner' },
    runner_type: 'human',
    confidence: 0.9,
    status: 'accepted',
    expected_outcomes: [
      { id: 'causal-trace', statement: 'A later contributor can reconstruct why the current architecture superseded the former one.' },
      { id: 'no-gate-coupling', statement: 'Judgment records do not create readiness or merge blockers.' }
    ],
    recorded_at: createdAt
  });

  dag = addJudgmentEdge(dag, {
    from: 'judgment-old-gate-dag',
    to: 'judgment-minimal-core',
    relation: 'supersedes',
    reason: 'Operational complexity invalidated the earlier architecture choice.'
  });
  dag = addJudgmentEdge(dag, {
    from: 'judgment-minimal-core',
    to: 'judgment-development-dag-kernel',
    relation: 'supports',
    reason: 'The minimal core provides the boundary condition for reintroducing only the judgment primitive.'
  });

  return dag;
}

test('development judgment DAG stays non-blocking while preserving causal lineage', () => {
  const dag = buildDogfoodDag();
  const validation = validateJudgmentDag(dag);
  const summary = summarizeJudgmentDag(dag);

  assert.equal(validation.valid, true);
  assert.equal(validation.acyclic, true);
  assert.equal(summary.node_count, 3);
  assert.equal(summary.edge_count, 2);
  assert.equal(summary.blocking, false);
  assert.equal('gate_status' in dag, false);
  assert.equal('ready_for_pr_create' in dag, false);
});

test('judgment evaluation appends observed outcomes without rewriting the decision', () => {
  const before = buildDogfoodDag();
  const after = appendJudgmentEvaluation(before, 'judgment-development-dag-kernel', {
    evaluation_id: 'evaluation-dogfood-001',
    status: 'confirmed',
    summary: 'The first dogfood graph is representable without adding a Gate or execution dependency.',
    evidence_refs: ['fixtures/judgment-dag/vibepro-minimal-core-reassessment.json'],
    observed_outcomes: [
      { id: 'no-gate-coupling', observation: 'The model exposes no readiness or merge verdict.' }
    ],
    observed_at: '2026-08-20T18:10:00+09:00'
  });

  assert.equal(before.nodes.find((node) => node.id === 'judgment-development-dag-kernel').evaluations.length, 0);
  const node = after.nodes.find((item) => item.id === 'judgment-development-dag-kernel');
  assert.equal(node.decision, 'Introduce a non-blocking Development Judgment DAG kernel and dogfood it on VibePro itself.');
  assert.equal(node.evaluations.length, 1);
  assert.equal(node.evaluations[0].status, 'confirmed');
});

test('judgment DAG rejects cycles rather than becoming a generic graph', () => {
  let dag = buildDogfoodDag();
  assert.throws(
    () => addJudgmentEdge(dag, {
      from: 'judgment-development-dag-kernel',
      to: 'judgment-old-gate-dag',
      relation: 'depends_on'
    }),
    /creates a cycle/
  );
});
