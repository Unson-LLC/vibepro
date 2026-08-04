import './support/scratch-tmpdir.js';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const modelPath = path.join(repoRoot, 'docs', 'architecture', 'target-model.json');
const cardsPath = path.join(
  repoRoot,
  'docs',
  'architecture',
  'adjudication',
  'target-model-rebaseline-cards.md'
);

async function loadModel() {
  return JSON.parse(await readFile(modelPath, 'utf8'));
}

function moduleOf(model, file) {
  const owner = model.modules.find((m) => m.paths.includes(file));
  return owner ? owner.name : null;
}

// TMP-S-6 の凍結値: governance rebaseline (PR #424 / origin/main) 時点の規範本文。
// machine_projection は規範本文を書き換えてはならないため、ここを更新するには
// governance.human_adjudicated としての別裁定が必要になる。
const FROZEN_RULES = [
  {
    id: 'R-001',
    statement: 'workspace-infra は他のどのモジュールにも依存しない',
    status: 'adjudicated',
    adjudicated_by: 'sato_keigo',
    adjudicated_at: '2026-07-22'
  },
  {
    id: 'R-002',
    statement: 'cli 以外のモジュールは cli に依存しない',
    status: 'adjudicated',
    adjudicated_by: 'sato_keigo',
    adjudicated_at: '2026-07-22'
  },
  {
    id: 'R-003',
    statement: 'budgets.file_line_baseline の13ファイルは凍結行数を超えて成長しない(default 1500行)',
    status: 'adjudicated',
    adjudicated_by: 'sato_keigo',
    adjudicated_at: '2026-07-22'
  },
  {
    id: 'R-004',
    statement: 'モジュール間の新規依存は target-model への宣言(人間の承認)を先に必要とする',
    status: 'adjudicated',
    adjudicated_by: 'sato_keigo',
    adjudicated_at: '2026-07-22'
  }
];

const FROZEN_SCOPE_ROOTS = ['src', 'bin'];

const FROZEN_BUDGETS = {
  default_max_file_lines: 1500,
  file_line_baseline: {
    'src/pr-manager.js': 14922,
    'src/cli.js': 3930,
    'src/agent-review.js': 3657,
    'src/design-system.js': 2985,
    'src/story-catalog-generator.js': 2815,
    'src/session-efficiency-audit.js': 2750,
    'src/canonical-audit.js': 2688,
    'src/guarded-run-session.js': 2382,
    'src/story-manager.js': 2361,
    'src/usage-report.js': 2131,
    'src/diagnostic-engine.js': 2030,
    'src/journey-map.js': 1757,
    'src/design-modernize.js': 1692
  }
};

// Q4 で一括承認された declare 候補22ペア。
const DECLARED_PAIRS_Q4 = [
  ['gate-pr', 'uiux-design'],
  ['gate-pr', 'scanners'],
  ['gate-pr', 'architecture'],
  ['diagnosis', 'architecture'],
  ['diagnosis', 'evidence'],
  ['diagnosis', 'spec'],
  ['diagnosis', 'task'],
  ['architecture', 'gate-pr'],
  ['reporting', 'scanners'],
  ['review', 'diagnosis'],
  ['review', 'run-session'],
  ['run-session', 'gate-pr'],
  ['run-session', 'review'],
  ['scanners', 'evidence'],
  ['scanners', 'graph'],
  ['scanners', 'skills'],
  ['spec', 'diagnosis'],
  ['spec', 'evidence'],
  ['story', 'architecture'],
  ['story', 'run-session'],
  ['story', 'uiux-design'],
  ['uiux-design', 'graph']
];

// Q4 の resolve 対象。宣言では解消せず負債として残す（ratchet gate story のスコープ）。
const RESOLVE_PAIRS_NOT_DECLARED = [
  ['workspace-infra', 'gate-pr'],
  ['workspace-infra', 'cli'],
  ['workspace-infra', 'evidence'],
  ['workspace-infra', 'reporting'],
  ['workspace-infra', 'review'],
  ['workspace-infra', 'run-session'],
  ['gate-pr', 'cli'],
  ['story', 'cli'],
  ['diagnosis', 'cli'],
  ['review', 'gate-pr'],
  ['review', 'reporting'],
  ['story', 'gate-pr'],
  ['story', 'task'],
  ['story', 'diagnosis'],
  ['story', 'reporting'],
  ['spec', 'gate-pr'],
  ['evidence', 'gate-pr'],
  ['evidence', 'run-session'],
  ['diagnosis', 'gate-pr']
];

// Clause binding: story-vibepro-target-model-projection-v2:AC-1
test('TMP-S-1: agent-runtime モジュールが新設され Q1 の8ファイルを保持する', async () => {
  const model = await loadModel();
  const agentRuntime = model.modules.find((m) => m.name === 'agent-runtime');
  assert.ok(agentRuntime, 'agent-runtime モジュールが存在しない');
  assert.match(
    agentRuntime.responsibility,
    /外部agentプロセス.*起動.*出力契約.*完了通知.*進捗期限/,
    'agent-runtime の responsibility が裁定内容を表していない'
  );
  const expected = [
    'src/codex-subagent-host.js',
    'src/codex-subagent-host-worker.js',
    'src/codex-subagent-runtime-adapter.js',
    'src/codex-runtime-bridge.js',
    'src/codex-runtime-output-contract.js',
    'src/agent-completion-inbox.js',
    'src/progress-deadline.js',
    'src/verification-runner.js'
  ];
  assert.deepEqual([...agentRuntime.paths].sort(), [...expected].sort());
});

// Clause binding: story-vibepro-target-model-projection-v2:AC-2
test('TMP-S-2: Q2/Q3/Q5 の割当が modules[].paths に反映されている', async () => {
  const model = await loadModel();
  const expectations = {
    'src/atomic-file.js': 'workspace-infra',
    'src/canonical-persistence.js': 'workspace-infra',
    'src/process-record-store.js': 'workspace-infra',
    'src/story-transaction-lock.js': 'workspace-infra',
    'src/decision-outcome-ledger.js': 'gate-pr',
    'src/outcome-manager.js': 'gate-pr',
    'src/merge-gate-authorization.js': 'gate-pr',
    'src/merge-public-projection.js': 'gate-pr',
    'src/reconciliation-action.js': 'gate-pr',
    'src/task-bound-repo-control.js': 'gate-pr',
    'src/budget-override-authority.js': 'gate-pr',
    'src/review-inspection-inputs.js': 'review',
    'src/review-surface-violations.js': 'review',
    'src/dispatch-identity.js': 'review'
  };
  for (const [file, expected] of Object.entries(expectations)) {
    assert.equal(moduleOf(model, file), expected, `${file} の割当先が ${expected} ではない`);
  }
});

// Clause binding: story-vibepro-target-model-projection-v2:AC-3
test('TMP-S-3: Q1 で承認された agent-runtime の2宣言が反映されている', async () => {
  const model = await loadModel();
  assert.deepEqual(model.allowed_dependencies['agent-runtime'], ['workspace-infra']);
  assert.ok(
    model.allowed_dependencies['run-session'].includes('agent-runtime'),
    'run-session の許可先に agent-runtime が無い'
  );
});

// Clause binding: story-vibepro-target-model-projection-v2:AC-4
// Clause binding: story-vibepro-target-model-projection-v2:AC-8 — resolve 19件が宣言されないことが、投影後 conformance の未宣言依存22件(= resolve19 + 誘発3)の内訳を成立させる
test('TMP-S-4: Q4 の declare 候補22件が宣言され resolve 19件は宣言されない', async () => {
  const model = await loadModel();
  const deps = model.allowed_dependencies;
  for (const [from, to] of DECLARED_PAIRS_Q4) {
    assert.ok(Array.isArray(deps[from]), `allowed_dependencies に ${from} が無い`);
    assert.ok(deps[from].includes(to), `${from} -> ${to} が宣言されていない`);
  }
  assert.equal(DECLARED_PAIRS_Q4.length, 22);

  for (const [from, to] of RESOLVE_PAIRS_NOT_DECLARED) {
    const declared = deps[from] ?? [];
    assert.ok(
      !declared.includes(to) && !declared.includes('*'),
      `resolve 対象の ${from} -> ${to} が宣言されてしまっている`
    );
  }
  assert.equal(RESOLVE_PAIRS_NOT_DECLARED.length, 19);
});

// Clause binding: story-vibepro-target-model-projection-v2:AC-5
test('TMP-S-5: model_version が 2 で governance.adjudicated_at が 2026-08-04', async () => {
  const model = await loadModel();
  assert.equal(model.model_version, 2);
  assert.equal(model.governance.adjudicated_at, '2026-08-04');
  assert.equal(model.status, 'adjudicated');
});

// Clause binding: story-vibepro-target-model-projection-v2:AC-6
test('TMP-S-6: rules[] / scope_roots / budgets は governance rebaseline 時点と一致する', async () => {
  const model = await loadModel();
  assert.deepEqual(model.rules, FROZEN_RULES);
  assert.deepEqual(model.scope_roots, FROZEN_SCOPE_ROOTS);
  assert.deepEqual(model.budgets, FROZEN_BUDGETS);
  // governance の三分法本文も machine_projection では変えない（日付のみ更新）
  assert.deepEqual(model.governance.machine_projection, [
    '人間が承認した裁定結果の target-model への反映',
    '承認された改訂に伴う model_version のインクリメント'
  ]);
  assert.equal(model.governance.human_adjudicated.length, 6);
  assert.equal(model.governance.machine_maintainable.length, 5);
});

// Clause binding: story-vibepro-target-model-projection-v2:AC-7
test('TMP-S-7: 裁定カードが回答済みで provenance と全5問の採択が記録されている', async () => {
  const text = await readFile(cardsPath, 'utf8');
  const frontmatter = text.slice(0, text.indexOf('\n---', 4));
  assert.match(frontmatter, /^status: adjudicated$/m);
  assert.match(frontmatter, /^answered_at: 2026-08-04$/m);
  assert.match(frontmatter, /^adjudicator: sato_keigo$/m);
  assert.match(frontmatter, /^answer_channel: coordinator session AskUserQuestion$/m);
  assert.match(frontmatter, /^projected_model_version: 2$/m);
  assert.doesNotMatch(frontmatter, /answered_at:\s*null/);

  const answers = text.match(/\*\*回答（2026-08-04, sato_keigo, coordinator session AskUserQuestion）: 選択肢1を採択。\*\*/g);
  assert.equal(answers?.length, 5, '5問すべての採択記録が無い');
});
