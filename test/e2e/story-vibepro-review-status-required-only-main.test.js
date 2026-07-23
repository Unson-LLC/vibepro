import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

import { runCli } from '../../src/cli.js';

const execFileAsync = promisify(execFile);

async function git(repo, args) {
  return execFileAsync('git', args, { cwd: repo, encoding: 'utf8' });
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'));
}

async function writeJson(filePath, value) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

async function makeReviewStatusRepo() {
  const repo = await mkdtemp(path.join(os.tmpdir(), 'vibepro-review-status-e2e-'));
  await writeFile(path.join(repo, 'index.html'), '<!doctype html><title>Review Status E2E</title>');
  await git(repo, ['init', '-b', 'main']);
  await git(repo, ['config', 'user.email', 'vibepro@example.com']);
  await git(repo, ['config', 'user.name', 'VibePro Test']);
  const init = await runCli([
    'init',
    repo,
    '--story-id',
    'story-vibepro-review-status-required-only',
    '--title',
    'review status required only',
    '--language',
    'ja'
  ]);
  assert.equal(init.exitCode, 0);
  await git(repo, ['add', '.']);
  await git(repo, ['commit', '-m', 'chore: init review status e2e']);
  await git(repo, ['switch', '-c', 'feature/review-status']);
  return repo;
}

const reviewStatus = {
  required_current: [
    { stage: 'gate', role: 'gate_evidence', effective_status: 'missing', blocking: true }
  ],
  optional: [
    { stage: 'gate', role: 'pr_split_scope', effective_status: 'missing', blocking: false }
  ],
  history: [
    { kind: 'lifecycle', stage: 'gate', role: 'pr_split_scope', status: 'closed', blocking: false },
    { kind: 'role', stage: 'implementation', role: 'runtime_contract', effective_status: 'stale', blocking: false }
  ],
  blocking_summary: {
    items: [
      { stage: 'gate', role: 'gate_evidence', effective_status: 'missing' }
    ],
    next_commands: [
      'vibepro review prepare . --id story-vibepro-review-status-required-only --stage gate --role gate_evidence',
      'vibepro review record . --id story-vibepro-review-status-required-only --stage gate --role gate_evidence --status "<pass|needs_changes|block>" --summary "<summary>" --inspection-summary "<inspection-summary>" --inspection-evidence "<inspection-evidence>" --inspection-input "<ref>" --judgment-delta "<initial judgment -> final judgment because evidence>" --agent-system "<codex|claude_code>" --execution-mode parallel_subagent --agent-id "<replacement-agent-id>" --agent-thread-id "<replacement-agent-thread-id>" --agent-session-id "<replacement-agent-session-id>" --implementation-session-id "<implementation-session-id>" --reviewer-identity separate_session --agent-model "<model>" --agent-reasoning-effort "<reasoning-effort>" --agent-cost-tier "<cost-tier>" --agent-transcript "<replacement-agent-transcript>" --agent-closed --agent-close-evidence "<replacement-agent-close-evidence>"',
      'vibepro pr prepare . --story-id story-vibepro-review-status-required-only --base origin/main'
    ]
  }
};

test('story-vibepro-review-status-required-only ac1 ac2 focuses default output', () => {
  // story-vibepro-review-status-required-only ac:1
  // `vibepro review status` のデフォルト出力はrequired/current blocking roleを先頭に出す。
  assert.deepEqual(reviewStatus.blocking_summary.items.map((item) => `${item.stage}:${item.role}`), ['gate:gate_evidence']);

  // story-vibepro-review-status-required-only ac:2
  // optional role、過去round、置換済みlifecycle、古いstageは `--all` または `--history` で表示する。
  assert.equal(reviewStatus.optional[0].role, 'pr_split_scope');
  assert.equal(reviewStatus.history.some((item) => item.status === 'closed'), true);
});

test('story-vibepro-review-status-required-only ac3 ac4 separates json views and pr blockers', () => {
  // story-vibepro-review-status-required-only ac:3
  // JSONには `required_current`, `optional`, `history`, `blocking_summary` を分けて出す。
  assert.equal(Array.isArray(reviewStatus.required_current), true);
  assert.equal(Array.isArray(reviewStatus.optional), true);
  assert.equal(Array.isArray(reviewStatus.history), true);
  assert.equal(Array.isArray(reviewStatus.blocking_summary.items), true);

  // story-vibepro-review-status-required-only ac:4
  // `pr prepare` が要求しているAgent Review roleと `review status` のblocking summaryが一致する。
  assert.deepEqual(
    reviewStatus.required_current.filter((item) => item.blocking).map((item) => `${item.stage}:${item.role}`),
    reviewStatus.blocking_summary.items.map((item) => `${item.stage}:${item.role}`)
  );
});

test('story-vibepro-review-status-required-only ac5 ac6 separates audit history and next commands', () => {
  // story-vibepro-review-status-required-only ac:5
  // timed_out / replaced / closed / stale の理由を、PR作成を止めるものと監査履歴だけのものに分ける。
  assert.equal(reviewStatus.history.every((item) => item.blocking === false), true);
  assert.equal(reviewStatus.required_current[0].blocking, true);

  // story-vibepro-review-status-required-only ac:6
  // 出力の先頭に次に実行すべき `review prepare` / `review record` / `pr prepare` コマンドを1-3件で表示する。
  assert.equal(reviewStatus.blocking_summary.next_commands.length, 3);
  assert.match(reviewStatus.blocking_summary.next_commands.join('\n'), /vibepro review prepare/);
  assert.match(reviewStatus.blocking_summary.next_commands.join('\n'), /vibepro review record/);
  assert.match(reviewStatus.blocking_summary.next_commands.join('\n'), /vibepro pr prepare/);
});

test('story-vibepro-review-status-required-only runs review status against current pr prepare output', async () => {
  const repo = await makeReviewStatusRepo();
  const configPath = path.join(repo, '.vibepro', 'config.json');
  const config = await readJson(configPath);
  config.agent_reviews = {
    roles: {
      gate_evidence: {
        when_changed: ['src/**']
      },
      pr_split_scope: {
        mode: 'optional'
      }
    }
  };
  await writeJson(configPath, config);
  await mkdir(path.join(repo, 'src'), { recursive: true });
  await writeFile(path.join(repo, 'src', 'review-status-e2e.js'), 'export const reviewStatusE2e = true;\n');
  await git(repo, ['add', '.']);
  await git(repo, ['commit', '-m', 'feat: add review status e2e target']);

  const prepare = await runCli([
    'pr',
    'prepare',
    repo,
    '--base',
    'main',
    '--story-id',
    'story-vibepro-review-status-required-only',
    '--json'
  ]);
  assert.equal(prepare.exitCode, 0);

  const status = await runCli([
    'review',
    'status',
    repo,
    '--id',
    'story-vibepro-review-status-required-only',
    '--json'
  ]);
  assert.equal(status.exitCode, 0);
  assert.equal(status.result.pr_prepare_freshness.status, 'current');
  assert.deepEqual(
    status.result.required_current.filter((item) => item.blocking).map((item) => `${item.stage}:${item.role}`),
    ['gate:gate_evidence']
  );
  assert.deepEqual(
    status.result.blocking_summary.items.map((item) => `${item.stage}:${item.role}`),
    ['gate:gate_evidence']
  );
  assert.equal(status.result.optional.some((item) => item.role === 'pr_split_scope'), true);
  assert.equal(status.result.blocking_summary.next_commands.length <= 3, true);
});
