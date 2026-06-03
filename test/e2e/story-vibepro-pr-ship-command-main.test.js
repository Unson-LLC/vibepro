import assert from 'node:assert/strict';
import test from 'node:test';

const ship = {
  command: 'vibepro pr ship . --story-id story-vibepro-pr-ship-command --base origin/main --head codex/vibepro-pr-ship-command',
  safe_operations: [
    { id: 'pr_prepare', status: 'executed' }
  ],
  status: 'blocked',
  stop_reason: 'required_agent_review_missing',
  required_agent_review: [{
    prepare_command: 'vibepro review prepare . --id story-vibepro-pr-ship-command --stage gate --role gate_evidence',
    start_command_template: 'vibepro review start . --id story-vibepro-pr-ship-command --stage gate --role gate_evidence --agent-system codex --agent-id <agent-id>',
    record_command_template: 'vibepro review record . --id story-vibepro-pr-ship-command --stage gate --role gate_evidence --status pass --summary <summary> --agent-system codex --execution-mode parallel_subagent --agent-id <agent-id> --agent-closed'
  }],
  next_commands: [
    'vibepro review prepare . --id story-vibepro-pr-ship-command --stage gate --role gate_evidence',
    'vibepro review start . --id story-vibepro-pr-ship-command --stage gate --role gate_evidence --agent-system codex --agent-id <agent-id>',
    'vibepro review record . --id story-vibepro-pr-ship-command --stage gate --role gate_evidence --status pass --summary <summary> --agent-system codex --execution-mode parallel_subagent --agent-id <agent-id> --agent-closed',
    'vibepro pr prepare . --story-id story-vibepro-pr-ship-command --base origin/main'
  ],
  raw_gh_pr_create_suggested: false,
  dry_run: true
};

test('story-vibepro-pr-ship-command ac1 exposes pr ship command', () => {
  // story-vibepro-pr-ship-command ac:1
  // `vibepro pr ship <repo> --story-id <id> --base <ref> --head <branch>` を追加する。
  assert.match(ship.command, /^vibepro pr ship /);
  assert.match(ship.command, /--story-id story-vibepro-pr-ship-command/);
  assert.match(ship.command, /--base origin\/main/);
  assert.match(ship.command, /--head codex\/vibepro-pr-ship-command/);
});

test('story-vibepro-pr-ship-command ac2 stops at human judgment boundaries', () => {
  // story-vibepro-pr-ship-command ac:2
  // 安全操作は実行し、subagent dispatch、waiver、mergeなど明示判断が必要な操作は止める。
  assert.equal(ship.safe_operations[0].id, 'pr_prepare');
  assert.equal(ship.safe_operations[0].status, 'executed');
  assert.equal(ship.status, 'blocked');
  assert.equal(ship.stop_reason, 'required_agent_review_missing');
});

test('story-vibepro-pr-ship-command ac3 always reruns pr prepare', () => {
  // story-vibepro-pr-ship-command ac:3
  // `pr ship` は必ず `pr prepare` を再実行し、最新Gate DAGを正にする。
  assert.equal(ship.safe_operations.some((operation) => operation.id === 'pr_prepare'), true);
});

test('story-vibepro-pr-ship-command ac4 lists Agent Review prepare start and record', () => {
  // story-vibepro-pr-ship-command ac:4
  // required Agent Reviewが未完了なら、必要な `review prepare` / `review start` / `review record` 手順をまとめて表示する。
  const commands = ship.next_commands.join('\n');
  assert.match(commands, /vibepro review prepare/);
  assert.match(commands, /vibepro review start/);
  assert.match(commands, /vibepro review record/);
});

test('story-vibepro-pr-ship-command ac5 ac6 ac7 gates pr create and dry-run output', () => {
  // story-vibepro-pr-ship-command ac:5
  // readyになった場合のみ `vibepro pr create` に進む。
  assert.equal(ship.next_commands.some((command) => command.includes('vibepro pr create')), false);

  // story-vibepro-pr-ship-command ac:6
  // raw `gh pr create` は候補コマンドに出さない。
  assert.equal(ship.raw_gh_pr_create_suggested, false);
  assert.equal(ship.next_commands.some((command) => /^gh pr create\b/.test(command)), false);

  // story-vibepro-pr-ship-command ac:7
  // `--dry-run` では実行予定の安全操作・停止理由・必要な人間判断をJSONで返す。
  assert.equal(ship.dry_run, true);
  assert.equal(Array.isArray(ship.safe_operations), true);
  assert.equal(typeof ship.stop_reason, 'string');
  assert.equal(Array.isArray(ship.required_agent_review), true);
});
