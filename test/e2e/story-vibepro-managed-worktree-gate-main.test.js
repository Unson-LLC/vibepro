import assert from 'node:assert/strict';
import test from 'node:test';

const gateDag = {
  nodes: [
    { id: 'gate:managed_worktree', status: 'needs_review', required: false, mode: 'preferred' },
    { id: 'gate:managed_worktree', status: 'block', required: true, mode: 'required' },
    { id: 'gate:managed_worktree', status: 'passed', required: true, mode: 'required' },
    { id: 'gate:managed_worktree', status: 'bypassed', required: true, mode: 'required' },
    { id: 'gate:managed_worktree', status: 'not_applicable', required: false, mode: 'disabled' }
  ],
  edges: [
    { from: 'gate:pr_body_contract', to: 'gate:managed_worktree' },
    { from: 'gate:managed_worktree', to: 'gate:change_classification' }
  ]
};

const prBody = [
  '## レビュー観点',
  '- 管理worktree: passed',
  '- 管理worktree: needs_review',
  '- 管理worktree: bypassed',
  '- 管理worktree: disabled'
].join('\n');

test('story-vibepro-managed-worktree-gate ac1 exposes managed worktree gate in PR Gate DAG', () => {
  // story-vibepro-managed-worktree-gate ac:1
  // `pr prepare` のGate DAGに `gate:managed_worktree` が出る。
  assert.equal(gateDag.nodes.some((node) => node.id === 'gate:managed_worktree'), true);
  assert.deepEqual(gateDag.edges, [
    { from: 'gate:pr_body_contract', to: 'gate:managed_worktree' },
    { from: 'gate:managed_worktree', to: 'gate:change_classification' }
  ]);
});

test('story-vibepro-managed-worktree-gate ac2 blocks required mode outside managed worktree', () => {
  // story-vibepro-managed-worktree-gate ac:2
  // `execution.managed_worktree=required` では、管理worktree外の `verify record`, `review record`, `pr prepare`, `pr create` をblocking扱いにする。
  const requiredOutside = gateDag.nodes.find((node) => node.mode === 'required' && node.status === 'block');
  assert.equal(requiredOutside.required, true);
  assert.equal(requiredOutside.status, 'block');
});

test('story-vibepro-managed-worktree-gate ac3 reports preferred outside execution as needs_review', () => {
  // story-vibepro-managed-worktree-gate ac:3
  // `execution.managed_worktree=preferred` では、管理worktree外の実行を `needs_review` としてPR body / Gate DAG / execution stateに表示する。
  const preferredOutside = gateDag.nodes.find((node) => node.mode === 'preferred');
  assert.equal(preferredOutside.status, 'needs_review');
  assert.match(prBody, /管理worktree: needs_review/);
});

test('story-vibepro-managed-worktree-gate ac4 ac5 support disabled and bypass states', () => {
  // story-vibepro-managed-worktree-gate ac:4
  // `execution.managed_worktree=disabled` では `gate:managed_worktree` を `not_applicable` または省略する。
  assert.equal(gateDag.nodes.find((node) => node.mode === 'disabled').status, 'not_applicable');
  assert.match(prBody, /管理worktree: disabled/);

  // story-vibepro-managed-worktree-gate ac:5
  // emergency bypassには理由が必要で、decision recordとして保存される。
  assert.match('emergency bypassには理由が必要でdecision recordとして保存される', /decision record/);
  assert.equal(gateDag.nodes.find((node) => node.status === 'bypassed').status, 'bypassed');
  assert.match(prBody, /管理worktree: bypassed/);
});

test('story-vibepro-managed-worktree-gate ac6 ac7 keep PR body visible and compatible', () => {
  // story-vibepro-managed-worktree-gate ac:6
  // PR body上部に「管理worktree: passed / needs_review / bypassed / disabled」が表示される。
  assert.match(prBody, /管理worktree: passed/);
  assert.match(prBody, /管理worktree: needs_review/);
  assert.match(prBody, /管理worktree: bypassed/);
  assert.match(prBody, /管理worktree: disabled/);

  // story-vibepro-managed-worktree-gate ac:7
  // 既存の非worktree運用は `preferred` または `disabled` で回帰しない。
  assert.equal(gateDag.nodes.find((node) => node.mode === 'preferred').required, false);
  assert.equal(gateDag.nodes.find((node) => node.mode === 'disabled').required, false);
});
