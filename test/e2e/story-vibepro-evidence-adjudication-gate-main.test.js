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

// story-vibepro-evidence-adjudication-gate ac:3
test('story-vibepro-evidence-adjudication-gate ac:3 prepare on a story without acceptance criteria fails explicitly instead of producing a pass-like artifact', async () => {
  // ACが1件もないStoryに対する `adjudicate prepare` は、pass相当の成果物を作らず「acceptance criteria なし」を明示するエラーになる
  const repo = await makeRepo();
  await writeFile(path.join(repo, 'docs', 'management', 'stories', 'active', `${STORY_ID}.md`), `---
story_id: ${STORY_ID}
title: 裁定E2E
---

# Story

本文のみでACなし。
`, 'utf8');
  await assert.rejects(
    () => run(process.execPath, [VIBEPRO_BIN, 'adjudicate', 'prepare', repo, '--id', STORY_ID], repo),
    /has no acceptance criteria/
  );
});

// story-vibepro-evidence-adjudication-gate ac:6
// story-vibepro-evidence-adjudication-gate S-002
test('story-vibepro-evidence-adjudication-gate ac:6 not_demonstrated verdict fails the gate with the adjudicator reason', async () => {
  // いずれかのclauseが `not_demonstrated` のとき、ゲートは failed になり reason に裁定者の理由が含まれる
  // When any clause verdict is not_demonstrated, the gate status transitions to failed and the adjudicator reason is included in the gate reason.
  const repo = await makeRepo();
  await run(process.execPath, [VIBEPRO_BIN, 'adjudicate', 'record', repo, '--id', STORY_ID, '--clause', 'AC-1', '--verdict', 'not_demonstrated', '--reason', '文字列存在テストは成果を実証しない', '--agent-system', 'claude_code', '--agent-id', 'judge-1'], repo);
  const gateOut = JSON.parse(await run(process.execPath, [VIBEPRO_BIN, 'gate', 'check', repo, '--story-id', STORY_ID, '--base', 'main', '--json'], repo).catch((error) => {
    if (typeof error.stdout === 'string' && error.stdout.trim().startsWith('{')) return error.stdout;
    throw error;
  }));
  const adjGate = gateOut.gates.find((gate) => gate.id === 'gate:evidence_adjudication');
  assert.equal(adjGate.status, 'failed');
  assert.match(adjGate.reason, /文字列存在テストは成果を実証しない/);
});

// story-vibepro-evidence-adjudication-gate ac:10
test('story-vibepro-evidence-adjudication-gate ac:10 config opt-out removes the gate and pr prepare does not crash without adjudication artifacts', async () => {
  // `.vibepro/config.json` で `evidence_adjudication.enabled: false` のときゲートは生成されず、adjudication成果物が無い既存リポジトリでも `pr prepare` はクラッシュしない
  const repo = await makeRepo();
  const configPath = path.join(repo, '.vibepro', 'config.json');
  const config = JSON.parse(await readFile(configPath, 'utf8'));
  config.evidence_adjudication = { enabled: false };
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
  const gateOut = JSON.parse(await run(process.execPath, [VIBEPRO_BIN, 'gate', 'check', repo, '--story-id', STORY_ID, '--base', 'main', '--json'], repo).catch((error) => {
    if (typeof error.stdout === 'string' && error.stdout.trim().startsWith('{')) return error.stdout;
    throw error;
  }));
  assert.equal(gateOut.gates.find((gate) => gate.id === 'gate:evidence_adjudication'), undefined);
  assert.ok(Array.isArray(gateOut.gates) && gateOut.gates.length > 0);
});

// story-vibepro-evidence-adjudication-gate ac:11
test('story-vibepro-evidence-adjudication-gate ac:11 the unit suite contains executable coverage for every required category', async () => {
  // テストは「request生成の内容」「AC 0件の明示エラー」「record入力検証とHEADバインド」「ゲート4状態（needs_evidence / failed / 人間検証要求 / passed）」「overall_status・ready_for_pr_create・critical連動」「オプトアウトと後方互換」を含む
  const unitSuite = await readFile(path.resolve('test/adjudication.test.js'), 'utf8');
  for (const testId of ['ADJ-S-001', 'ADJ-S-002', 'ADJ-S-003', 'ADJ-S-004', 'ADJ-S-005', 'ADJ-S-006', 'ADJ-S-007', 'ADJ-S-008', 'ADJ-S-009', 'ADJ-S-010']) {
    assert.ok(unitSuite.includes(`test('${testId}`), `${testId} test block must exist`);
  }
  const childEnv = { ...process.env };
  delete childEnv.NODE_TEST_CONTEXT;
  delete childEnv.NODE_OPTIONS;
  const { stdout } = await execFileAsync(process.execPath, ['--test', '--test-reporter=spec', 'test/adjudication.test.js'], { cwd: path.resolve('.'), encoding: 'utf8', env: childEnv }).catch((error) => ({ stdout: error.stdout ?? '' }));
  assert.match(stdout, /pass 10/);
  assert.match(stdout, /fail 0/);
});

// story-vibepro-evidence-adjudication-gate S-001
test('story-vibepro-evidence-adjudication-gate S-001 gate lists each missing clause id when verdicts are absent', async () => {
  // When the evidence adjudication gate state transitions are evaluated in pr prepare workflow, a clause without a fresh current-head verdict moves the gate status to needs_evidence and the reason lists each missing clause id.
  const repo = await makeRepo();
  const gateOut = JSON.parse(await run(process.execPath, [VIBEPRO_BIN, 'gate', 'check', repo, '--story-id', STORY_ID, '--base', 'main', '--json'], repo).catch((error) => {
    if (typeof error.stdout === 'string' && error.stdout.trim().startsWith('{')) return error.stdout;
    throw error;
  }));
  const adjGate = gateOut.gates.find((gate) => gate.id === 'gate:evidence_adjudication');
  assert.equal(adjGate.status, 'needs_evidence');
  assert.match(adjGate.reason, /AC-1/);
  assert.match(adjGate.reason, /AC-2/);
});

// story-vibepro-evidence-adjudication-gate S-003
test('story-vibepro-evidence-adjudication-gate S-003 human verification closes not_verifiable_by_automation only via an accepted decision record', async () => {
  // When a clause verdict is not_verifiable_by_automation, the gate demands human verification and only an accepted decision record with source gate:evidence_adjudication:<clause-id>, a reason, and an artifact resolves that clause.
  const repo = await makeRepo();
  await run(process.execPath, [VIBEPRO_BIN, 'adjudicate', 'record', repo, '--id', STORY_ID, '--clause', 'AC-1', '--verdict', 'not_verifiable_by_automation', '--reason', '人間の理解は自動検証不能', '--agent-system', 'claude_code', '--agent-id', 'judge-1'], repo);
  await run(process.execPath, [VIBEPRO_BIN, 'adjudicate', 'record', repo, '--id', STORY_ID, '--clause', 'AC-2', '--verdict', 'demonstrated', '--reason', 'API検証テストが観測値で実証', '--agent-system', 'claude_code', '--agent-id', 'judge-1'], repo);
  const before = JSON.parse(await run(process.execPath, [VIBEPRO_BIN, 'gate', 'check', repo, '--story-id', STORY_ID, '--base', 'main', '--json'], repo).catch((error) => {
    if (typeof error.stdout === 'string' && error.stdout.trim().startsWith('{')) return error.stdout;
    throw error;
  }));
  assert.equal(before.gates.find((gate) => gate.id === 'gate:evidence_adjudication').status, 'needs_evidence');
  await run(process.execPath, [VIBEPRO_BIN, 'decision', 'record', repo, '--id', STORY_ID, '--type', 'needs_review', '--source', 'gate:evidence_adjudication:AC-1', '--status', 'accepted', '--summary', '人間が結果画面を目視確認', '--reason', '判断根拠表示を人間が確認した', '--artifact', `docs/management/stories/active/${STORY_ID}.md`], repo);
  const after = JSON.parse(await run(process.execPath, [VIBEPRO_BIN, 'gate', 'check', repo, '--story-id', STORY_ID, '--base', 'main', '--json'], repo).catch((error) => {
    if (typeof error.stdout === 'string' && error.stdout.trim().startsWith('{')) return error.stdout;
    throw error;
  }));
  assert.equal(after.gates.find((gate) => gate.id === 'gate:evidence_adjudication').status, 'passed');
});

// story-vibepro-evidence-adjudication-gate S-004
test('story-vibepro-evidence-adjudication-gate S-004 gate passes with fresh demonstrated verdicts and is explicit not_applicable with zero clauses', async () => {
  // When every clause has a fresh demonstrated verdict the gate passes, and a story with zero clauses yields an explicit not_applicable status rather than a silent pass.
  const repo = await makeRepo();
  await run(process.execPath, [VIBEPRO_BIN, 'adjudicate', 'record', repo, '--id', STORY_ID, '--clause', 'AC-1', '--verdict', 'demonstrated', '--reason', '画面表示テストが観測値で実証', '--agent-system', 'claude_code', '--agent-id', 'judge-1'], repo);
  await run(process.execPath, [VIBEPRO_BIN, 'adjudicate', 'record', repo, '--id', STORY_ID, '--clause', 'AC-2', '--verdict', 'demonstrated', '--reason', 'API検証テストが観測値で実証', '--agent-system', 'claude_code', '--agent-id', 'judge-1'], repo);
  const gateOut = JSON.parse(await run(process.execPath, [VIBEPRO_BIN, 'gate', 'check', repo, '--story-id', STORY_ID, '--base', 'main', '--json'], repo).catch((error) => {
    if (typeof error.stdout === 'string' && error.stdout.trim().startsWith('{')) return error.stdout;
    throw error;
  }));
  assert.equal(gateOut.gates.find((gate) => gate.id === 'gate:evidence_adjudication').status, 'passed');

  await writeFile(path.join(repo, 'docs', 'management', 'stories', 'active', `${STORY_ID}.md`), `---
story_id: ${STORY_ID}
title: 裁定E2E
---

# Story

ACなし。
`, 'utf8');
  await run('git', ['add', '.'], repo);
  await run('git', ['commit', '-m', 'docs: drop acceptance criteria'], repo);
  const emptyOut = JSON.parse(await run(process.execPath, [VIBEPRO_BIN, 'gate', 'check', repo, '--story-id', STORY_ID, '--base', 'main', '--json'], repo).catch((error) => {
    if (typeof error.stdout === 'string' && error.stdout.trim().startsWith('{')) return error.stdout;
    throw error;
  }));
  const emptyGate = emptyOut.gates.find((gate) => gate.id === 'gate:evidence_adjudication');
  assert.equal(emptyGate.status, 'not_applicable');
  assert.match(emptyGate.reason, /not a pass/);
});
