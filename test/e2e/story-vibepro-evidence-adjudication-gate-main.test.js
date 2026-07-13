import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const VIBEPRO_BIN = path.resolve('bin/vibepro.js');
const STORY_ID = 'story-adj-e2e';

async function run(command, args, cwd) {
  const { stdout } = await execFileAsync(command, args, { cwd, encoding: 'utf8' });
  return stdout;
}

async function makeRepo() {
  const repo = await mkdtemp(path.join(os.tmpdir(), 'vibepro-adj-e2e-'));
  await run('git', ['init', '-b', 'main'], repo);
  await run('git', ['config', 'user.email', 'test@example.com'], repo);
  await run('git', ['config', 'user.name', 'Test User'], repo);
  await run(process.execPath, [VIBEPRO_BIN, 'init', repo, '--story-id', STORY_ID, '--title', '裁定E2E'], repo);
  await mkdir(path.join(repo, 'docs', 'management', 'stories', 'active'), { recursive: true });
  await writeFile(path.join(repo, 'docs', 'management', 'stories', 'active', `${STORY_ID}.md`), `---
story_id: ${STORY_ID}
title: 裁定E2E
status: active
---

# Story

## 受け入れ基準

- [ ] 利用者が結果画面で判断根拠を理解できる
- [ ] APIが検証済み応答を返す
`, 'utf8');
  await run('git', ['add', '.'], repo);
  await run('git', ['commit', '-m', 'chore: fixture'], repo);
  await run('git', ['switch', '-c', 'feature/adj'], repo);
  await writeFile(path.join(repo, 'change.txt'), 'change\n', 'utf8');
  await run('git', ['add', 'change.txt'], repo);
  await run('git', ['commit', '-m', 'feat: change'], repo);
  return repo;
}

// story-vibepro-evidence-adjudication-gate ac:1 adjudicate prepareが依頼書を生成しclause全文と証拠を含む
// story-vibepro-evidence-adjudication-gate ac:2 依頼書は独立fresh context・反証指示・verdict3値定義を含む
// story-vibepro-evidence-adjudication-gate ac:4 adjudicate recordは入力検証しHEADへバインドする
// story-vibepro-evidence-adjudication-gate ac:5 未裁定clauseがあるとgateはneeds_evidenceで不足idを列挙する
// story-vibepro-evidence-adjudication-gate ac:7 not_verifiable_by_automationはdecision recordでのみ解決する
// story-vibepro-evidence-adjudication-gate ac:8 全clause解決でgateはpassedになる
// story-vibepro-evidence-adjudication-gate ac:9 未解決の間ready_for_pr_createはfalseでcriticalに含まれる
test('ADJ-E2E-001 story-vibepro-evidence-adjudication-gate ac:1 full CLI flow replays prepare -> record -> gate transitions end to end', async () => {
  const repo = await makeRepo();

  // flow_replay: prepare -> dispatch -> record -> gate replay through the real CLI binary
  const prepareStdout = await run(process.execPath, [VIBEPRO_BIN, 'adjudicate', 'prepare', repo, '--id', STORY_ID], repo);
  assert.match(prepareStdout, /adjudication-request\.md/);
  const request = await readFile(path.join(repo, '.vibepro', 'adjudication', STORY_ID, 'adjudication-request.md'), 'utf8');
  assert.match(request, /利用者が結果画面で判断根拠を理解できる/);
  assert.match(request, /APIが検証済み応答を返す/);
  assert.match(request, /demonstrated/);
  assert.match(request, /not_demonstrated/);
  assert.match(request, /not_verifiable_by_automation/);
  assert.match(request, /独立したfresh contextの裁定者/);
  assert.match(request, /反証の立場/);

  // negative_path: invalid verdict is rejected by the CLI
  await assert.rejects(
    () => run(process.execPath, [VIBEPRO_BIN, 'adjudicate', 'record', repo, '--id', STORY_ID, '--clause', 'AC-1', '--verdict', 'pass', '--reason', 'x', '--agent-system', 'claude_code', '--agent-id', 'judge-1'], repo)
  );

  // scenario_clause_e2e: record one demonstrated and one not_verifiable_by_automation verdict
  await run(process.execPath, [VIBEPRO_BIN, 'adjudicate', 'record', repo, '--id', STORY_ID, '--clause', 'AC-2', '--verdict', 'demonstrated', '--reason', 'API応答の検証テストが観測値で成果を実証', '--agent-system', 'claude_code', '--agent-id', 'judge-1'], repo);
  await run(process.execPath, [VIBEPRO_BIN, 'adjudicate', 'record', repo, '--id', STORY_ID, '--clause', 'AC-1', '--verdict', 'not_verifiable_by_automation', '--reason', '人間の理解は自動テストで検証不能', '--agent-system', 'claude_code', '--agent-id', 'judge-1'], repo);

  // artifact_replay: gate state is replayed from the recorded adjudication.json artifact by gate check
  const gateOut1 = JSON.parse(await run(process.execPath, [VIBEPRO_BIN, 'gate', 'check', repo, '--story-id', STORY_ID, '--base', 'main', '--json'], repo).catch((error) => {
    if (typeof error.stdout === 'string' && error.stdout.trim().startsWith('{')) return error.stdout;
    throw error;
  }));
  const adjGate1 = gateOut1.gates.find((gate) => gate.id === 'gate:evidence_adjudication');
  assert.ok(adjGate1);
  assert.equal(adjGate1.status, 'needs_evidence');
  assert.match(adjGate1.reason, /AC-1/);
  assert.equal(gateOut1.ready_for_pr_create, false);

  // human decision record closes the not_verifiable_by_automation clause
  await run(process.execPath, [VIBEPRO_BIN, 'decision', 'record', repo, '--id', STORY_ID, '--type', 'needs_review', '--source', 'gate:evidence_adjudication:AC-1', '--status', 'accepted', '--summary', '人間が結果画面を実際に確認した', '--reason', '結果画面の判断根拠表示を人間が目視確認した', '--artifact', 'docs/management/stories/active/story-adj-e2e.md'], repo);

  const gateOut2 = JSON.parse(await run(process.execPath, [VIBEPRO_BIN, 'gate', 'check', repo, '--story-id', STORY_ID, '--base', 'main', '--json'], repo).catch((error) => {
    if (typeof error.stdout === 'string' && error.stdout.trim().startsWith('{')) return error.stdout;
    throw error;
  }));
  const adjGate2 = gateOut2.gates.find((gate) => gate.id === 'gate:evidence_adjudication');
  assert.equal(adjGate2.status, 'passed');
});
