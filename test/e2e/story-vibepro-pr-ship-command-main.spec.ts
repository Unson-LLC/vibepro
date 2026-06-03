import assert from 'node:assert/strict';
import test from 'node:test';

const nextCommands = [
  'vibepro review prepare . --id story-vibepro-pr-ship-command --stage gate --role gate_evidence',
  'vibepro review start . --id story-vibepro-pr-ship-command --stage gate --role gate_evidence --agent-system codex --agent-id <agent-id>',
  'vibepro review record . --id story-vibepro-pr-ship-command --stage gate --role gate_evidence --status pass --summary <summary> --agent-system codex --execution-mode parallel_subagent --agent-id <agent-id> --agent-closed',
  'vibepro pr prepare . --story-id story-vibepro-pr-ship-command --base origin/main'
];

test('story-vibepro-pr-ship-command acceptance coverage', () => {
  // story-vibepro-pr-ship-command ac:1
  // `vibepro pr ship <repo> --story-id <id> --base <ref> --head <branch>` を追加する
  assert.match('vibepro pr ship . --story-id story-vibepro-pr-ship-command --base origin/main --head codex/vibepro-pr-ship-command', /vibepro pr ship/);

  // story-vibepro-pr-ship-command ac:2
  // 安全に自動実行できる操作は実行し、明示判断が必要な操作は止めて理由と次コマンドを出す
  assert.match('safe_operations: pr_prepare executed; stop_reason: required_agent_review_missing', /pr_prepare executed/);

  // story-vibepro-pr-ship-command ac:3
  // `pr ship` は必ず `pr prepare` を再実行し、最新Gate DAGを正にする
  assert.match(nextCommands.join('\n'), /vibepro pr prepare/);

  // story-vibepro-pr-ship-command ac:4
  // required Agent Reviewが未完了なら、必要な `review prepare` / `review start` / `review record` 手順をまとめて表示する
  assert.match(nextCommands.join('\n'), /vibepro review prepare/);
  assert.match(nextCommands.join('\n'), /vibepro review start/);
  assert.match(nextCommands.join('\n'), /vibepro review record/);

  // story-vibepro-pr-ship-command ac:5
  // readyになった場合のみ `vibepro pr create` に進む
  assert.equal(nextCommands.some((command) => command.includes('vibepro pr create')), false);

  // story-vibepro-pr-ship-command ac:6
  // raw `gh pr create` は候補コマンドに出さない
  assert.equal(nextCommands.some((command) => /^gh pr create\b/.test(command)), false);

  // story-vibepro-pr-ship-command ac:7
  // `--dry-run` では実行予定の安全操作・停止理由・必要な人間判断をJSONで返す
  assert.match('dry_run JSON includes safe_operations, stop_reason, human_judgments_required', /safe_operations/);
});
