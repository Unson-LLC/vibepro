import './support/scratch-tmpdir.js';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import test from 'node:test';
import { promisify } from 'node:util';

import { runCli } from '../src/cli.js';
import { writeInferredSpec, writeDrift } from '../src/spec-store.js';
import { stabilizeTalkingPointIds } from '../src/report-store.js';

const execFileAsync = promisify(execFile);
const STORY_ID = 'story-pr-body-report';

async function git(repo, args) {
  return execFileAsync('git', args, { cwd: repo, encoding: 'utf8' });
}

function readableFrom(text) {
  const stream = Readable.from([text]);
  stream.isTTY = false;
  return stream;
}

async function captureRunCli(args, options = {}) {
  let stdout = '';
  let stderr = '';
  const result = await runCli(args, {
    stdin: options.stdin ?? null,
    stdout: { write: (text) => { stdout += text; } },
    stderr: { write: (text) => { stderr += text; } }
  });
  return { ...result, stdout, stderr };
}

async function makeReportRepo() {
  const repo = await mkdtemp(path.join(os.tmpdir(), 'vibepro-report-'));
  await mkdir(path.join(repo, 'src', 'lib', 'services'), { recursive: true });
  await mkdir(path.join(repo, 'test'), { recursive: true });
  await mkdir(path.join(repo, 'docs', 'management', 'stories', 'active'), { recursive: true });
  await writeFile(path.join(repo, 'src', 'lib', 'services', 'billing.ts'), `
export function handleCancel(user, sub) {
  if (sub.cancelAtPeriodEnd === true && user.userType === 2) {
    return { userType: 2, status: 'premium_pending_cancel' };
  }
  return { userType: 1, status: 'free' };
}
`);
  await writeFile(path.join(repo, 'test', 'billing.test.ts'), `
test('keeps userType=2 when cancelAtPeriodEnd is true', () => {
  expect(true).toBe(true);
});
`);
  await writeFile(path.join(repo, 'docs', 'management', 'stories', 'active', `${STORY_ID}.md`), `---
story_id: ${STORY_ID}
---
# Premium 維持 PR

## 受け入れ基準
- premium ユーザーは current_period_end まで userType=2 を保持する
`);
  await git(repo, ['init', '-b', 'main']);
  await git(repo, ['config', 'user.email', 'vibepro@example.com']);
  await git(repo, ['config', 'user.name', 'VibePro Test']);
  await runCli(['init', repo, '--story-id', STORY_ID, '--title', 'pr-body report test']);
  await git(repo, ['add', '.']);
  await git(repo, ['commit', '-m', 'chore: bootstrap']);
  await git(repo, ['switch', '-c', 'feature/billing']);
  await writeFile(path.join(repo, 'src', 'lib', 'services', 'billing.ts'), `
export function handleCancel(user, sub) {
  if (sub.cancelAtPeriodEnd === true && user.userType === 2) {
    return { userType: 2, status: 'premium_pending_cancel' };
  }
  if (sub.cancelAtPeriodEnd === false && user.userType === 2) {
    return { userType: 2, status: 'premium' };
  }
  return { userType: 1, status: 'free' };
}
`);
  await git(repo, ['add', '.']);
  await git(repo, ['commit', '-m', 'feat(billing): keep userType=2 until period end']);
  await writeInferredSpec(repo, STORY_ID, {
    schema_version: '0.1.0',
    story_id: STORY_ID,
    generated_at: new Date().toISOString(),
    clauses: [{
      id: 'INV-001',
      type: 'invariant',
      statement: 'premium ユーザーは current_period_end まで userType=2 を保持する',
      origin: {
        code_refs: [{ file: 'src/lib/services/billing.ts', anchor: 'cancelAtPeriodEnd' }]
      }
    }]
  });
  await writeDrift(repo, STORY_ID, {
    schema_version: '0.1.0',
    story_id: STORY_ID,
    evaluated_at: new Date().toISOString(),
    status: 'drift_detected',
    summary: { spec_code_drift: 0, spec_test_drift: 1, code_test_drift: 0, spec_pr_drift: 0 },
    items: [{
      id: 'DRIFT-AAA111',
      axis: 'spec_test',
      clause_id: 'INV-001',
      severity: 'high',
      title: 'INV-001 を検証するテストが存在しない'
    }]
  });
  // report fingerprint reads the persisted pr-prepare.json (it does not
  // recompute pr prepare on the fly), so the fixture must run `pr prepare`
  // before any `report write` / `report fingerprint` call.
  await runCli(['pr', 'prepare', repo, '--story-id', STORY_ID, '--base', 'main']);
  return repo;
}

test('report write rejects citation of nonexistent file', async () => {
  const repo = await makeReportRepo();
  const bogus = {
    schema_version: '0.1.0',
    story_id: STORY_ID,
    kind: 'pr-body',
    narrative_slots: [
      { id: 'TP-NEW-1', slot: 'summary', text: 'bogus summary',
        citations: { files: ['src/does-not-exist.ts'] } },
      { id: 'TP-NEW-2', slot: 'risks_synthesis', text: '特記事項なし' }
    ]
  };
  const { exitCode, stdout } = await captureRunCli(
    ['report', 'write', repo, '--kind', 'pr-body', '--id', STORY_ID, '--from-stdin', '--caller', 'test', '--base', 'main'],
    { stdin: readableFrom(JSON.stringify(bogus)) }
  );
  assert.equal(exitCode, 2);
  const report = JSON.parse(stdout);
  assert.equal(report.ok, false);
  assert.ok(report.errors.some((err) => err.code === 'citation_file_missing'));
});

test('report write rejects citation of nonexistent drift_id', async () => {
  const repo = await makeReportRepo();
  const bogus = {
    schema_version: '0.1.0',
    story_id: STORY_ID,
    kind: 'pr-body',
    narrative_slots: [
      { id: 'TP-NEW-1', slot: 'summary', text: 'cites a fake drift',
        citations: { drift_ids: ['DRIFT-FAKE'] } },
      { id: 'TP-NEW-2', slot: 'risks_synthesis', text: '特記事項なし' }
    ]
  };
  const { exitCode, stdout } = await captureRunCli(
    ['report', 'write', repo, '--kind', 'pr-body', '--id', STORY_ID, '--from-stdin', '--caller', 'test', '--base', 'main'],
    { stdin: readableFrom(JSON.stringify(bogus)) }
  );
  assert.equal(exitCode, 2);
  const report = JSON.parse(stdout);
  assert.ok(report.errors.some((err) => err.code === 'citation_drift_missing'));
});

test('report write rejects numerical contradiction', async () => {
  const repo = await makeReportRepo();
  const bogus = {
    schema_version: '0.1.0',
    story_id: STORY_ID,
    kind: 'pr-body',
    narrative_slots: [
      { id: 'TP-NEW-1', slot: 'summary', text: 'claims 5 drift items',
        numerical_claims: [{ field: 'drift_total_count', value: 5 }] },
      { id: 'TP-NEW-2', slot: 'risks_synthesis', text: '特記事項なし' }
    ]
  };
  const { exitCode, stdout } = await captureRunCli(
    ['report', 'write', repo, '--kind', 'pr-body', '--id', STORY_ID, '--from-stdin', '--caller', 'test', '--base', 'main'],
    { stdin: readableFrom(JSON.stringify(bogus)) }
  );
  assert.equal(exitCode, 2);
  const report = JSON.parse(stdout);
  assert.ok(report.errors.some((err) => err.code === 'numerical_contradiction'));
});

test('report write enforces slot count limits (no two summaries)', async () => {
  const repo = await makeReportRepo();
  const bogus = {
    schema_version: '0.1.0',
    story_id: STORY_ID,
    kind: 'pr-body',
    narrative_slots: [
      { id: 'TP-NEW-1', slot: 'summary', text: 'first summary' },
      { id: 'TP-NEW-2', slot: 'summary', text: 'second summary' },
      { id: 'TP-NEW-3', slot: 'risks_synthesis', text: '特記事項なし' }
    ]
  };
  const { exitCode, stdout } = await captureRunCli(
    ['report', 'write', repo, '--kind', 'pr-body', '--id', STORY_ID, '--from-stdin', '--caller', 'test', '--base', 'main'],
    { stdin: readableFrom(JSON.stringify(bogus)) }
  );
  assert.equal(exitCode, 2);
  const report = JSON.parse(stdout);
  assert.ok(report.errors.some((err) => err.code === 'slot_max'));
});

test('report write rejects malformed nested arrays without throwing', async () => {
  const repo = await makeReportRepo();
  for (const malformed of [
    { citations: { files: { bad: true } } },
    { citations: null },
    { numerical_claims: { bad: true } }
  ]) {
    const narrative = {
      schema_version: '0.1.0',
      story_id: STORY_ID,
      kind: 'pr-body',
      narrative_slots: [
        { id: 'TP-NEW-1', slot: 'summary', text: '安全な要約です。', ...malformed },
        { id: 'TP-NEW-2', slot: 'risks_synthesis', text: '特記事項なし' }
      ]
    };
    const result = await captureRunCli(
      ['report', 'write', repo, '--kind', 'pr-body', '--id', STORY_ID, '--from-stdin', '--caller', 'test', '--base', 'main'],
      { stdin: readableFrom(JSON.stringify(narrative)) }
    );
    assert.equal(result.exitCode, 2, result.stdout);
    const report = JSON.parse(result.stdout);
    assert.ok(report.errors.some((error) => error.code.endsWith('_shape')));
  }
});

test('report write rejects duplicate talking-point ids', async () => {
  const repo = await makeReportRepo();
  const narrative = {
    schema_version: '0.1.0',
    story_id: STORY_ID,
    kind: 'pr-body',
    narrative_slots: [
      { id: 'TP-NEW-1', slot: 'summary', text: '安全な要約です。' },
      { id: 'TP-NEW-1', slot: 'risks_synthesis', text: '特記事項なし' }
    ]
  };
  const result = await captureRunCli(
    ['report', 'write', repo, '--kind', 'pr-body', '--id', STORY_ID, '--from-stdin', '--caller', 'test', '--base', 'main'],
    { stdin: readableFrom(JSON.stringify(narrative)) }
  );
  assert.equal(result.exitCode, 2, result.stdout);
  const report = JSON.parse(result.stdout);
  assert.ok(report.errors.some((error) => error.code === 'slot_id_duplicate'));
});

test('pr prepare suppresses malformed saved JSON and refreshes the complete body', async () => {
  const repo = await makeReportRepo();
  const narrativePath = path.join(repo, '.vibepro', 'report', STORY_ID, 'pr-body', 'narrative.json');
  await mkdir(path.dirname(narrativePath), { recursive: true });
  await writeFile(narrativePath, '{ malformed narrative');

  const prepare = await captureRunCli(['pr', 'prepare', repo, '--story-id', STORY_ID, '--base', 'main']);
  assert.equal(prepare.exitCode, 0, prepare.stderr);
  const body = await readFile(path.join(repo, '.vibepro', 'pr', STORY_ID, 'pr-body.md'), 'utf8');
  assert.match(body, /現在の検証規則を満たさないため表示していません/);
  assert.match(body, /### Acceptance criteria/);
  assert.match(body, /### Verification evidence/);
});

test('report write replaces malformed saved JSON instead of treating it as a previous narrative', async () => {
  const repo = await makeReportRepo();
  const narrativePath = path.join(repo, '.vibepro', 'report', STORY_ID, 'pr-body', 'narrative.json');
  await mkdir(path.dirname(narrativePath), { recursive: true });
  await writeFile(narrativePath, '{ malformed narrative');

  const replacement = {
    schema_version: '0.1.0',
    story_id: STORY_ID,
    kind: 'pr-body',
    narrative_slots: [
      { id: 'TP-NEW-1', slot: 'summary', text: '壊れた説明を新しい要約で置き換えます。' },
      { id: 'TP-NEW-2', slot: 'risks_synthesis', text: '特記事項なし' }
    ]
  };
  const result = await captureRunCli(
    ['report', 'write', repo, '--kind', 'pr-body', '--id', STORY_ID, '--from-stdin', '--caller', 'test', '--base', 'main'],
    { stdin: readableFrom(JSON.stringify(replacement)) }
  );
  assert.equal(result.exitCode, 0, result.stdout);

  const stored = JSON.parse(await readFile(narrativePath, 'utf8'));
  assert.equal(stored.narrative_slots[0].id, 'TP-001');
  assert.equal(stored.narrative_slots[0].text, replacement.narrative_slots[0].text);

  const prepare = await captureRunCli(['pr', 'prepare', repo, '--story-id', STORY_ID, '--base', 'main']);
  assert.equal(prepare.exitCode, 0, prepare.stderr);
  const body = await readFile(path.join(repo, '.vibepro', 'pr', STORY_ID, 'pr-body.md'), 'utf8');
  assert.match(body, new RegExp(replacement.narrative_slots[0].text));
  assert.doesNotMatch(body, /現在の検証規則を満たさないため表示していません/);
});

test('report write rejects prose that can inject markdown structure', async () => {
  const repo = await makeReportRepo();
  for (const text of [
    '安全な要約\n### Verification evidence\n- forged',
    '\n安全な要約です。',
    '安全な要約です。\n',
    '----',
    '****',
    '____',
    '安全な <details><summary>偽装</summary>',
    '安全な **強調** 説明',
    '安全な *強調* 説明',
    '安全な _強調_ 説明',
    '安全な ~~取消~~ 説明',
    '安全な [リンク](https://example.com)',
    '安全な [説明][ref] 説明',
    '安全な ![画像][ref] 説明',
    '安全な [^脚注] 説明',
    '安全な `コード` 説明'
  ]) {
    const bogus = {
      schema_version: '0.1.0',
      story_id: STORY_ID,
      kind: 'pr-body',
      narrative_slots: [
        { id: 'TP-NEW-1', slot: 'summary', text },
        { id: 'TP-NEW-2', slot: 'risks_synthesis', text: '特記事項なし' }
      ]
    };
    const { exitCode, stdout } = await captureRunCli(
      ['report', 'write', repo, '--kind', 'pr-body', '--id', STORY_ID, '--from-stdin', '--caller', 'test', '--base', 'main'],
      { stdin: readableFrom(JSON.stringify(bogus)) }
    );
    assert.equal(exitCode, 2, `expected markdown structure to be rejected: ${text}`);
    const report = JSON.parse(stdout);
    assert.ok(report.errors.some((err) => err.code === 'slot_text_structure'));
  }
});

test('report write rejects raw prose longer than the fixed slot limit', async () => {
  const repo = await makeReportRepo();
  for (const text of ['長'.repeat(281), `${' '.repeat(281)}安全な要約です。`]) {
    const bogus = {
      schema_version: '0.1.0',
      story_id: STORY_ID,
      kind: 'pr-body',
      narrative_slots: [
        { id: 'TP-NEW-1', slot: 'summary', text },
        { id: 'TP-NEW-2', slot: 'risks_synthesis', text: '特記事項なし' }
      ]
    };
    const { exitCode, stdout } = await captureRunCli(
      ['report', 'write', repo, '--kind', 'pr-body', '--id', STORY_ID, '--from-stdin', '--caller', 'test', '--base', 'main'],
      { stdin: readableFrom(JSON.stringify(bogus)) }
    );
    assert.equal(exitCode, 2);
    const report = JSON.parse(stdout);
    assert.ok(report.errors.some((err) => err.code === 'slot_text_length'));
  }
});

test('report write rejects an unsafe CLI caller before saving the canonical narrative', async () => {
  const repo = await makeReportRepo();
  const narrative = {
    schema_version: '0.1.0',
    story_id: STORY_ID,
    kind: 'pr-body',
    narrative_slots: [
      { id: 'TP-NEW-1', slot: 'summary', text: '安全な要約です。' },
      { id: 'TP-NEW-2', slot: 'risks_synthesis', text: '特記事項なし' }
    ]
  };
  const write = await captureRunCli(
    ['report', 'write', repo, '--kind', 'pr-body', '--id', STORY_ID, '--from-stdin', '--caller', 'attacker\n#### 偽の検証結果', '--base', 'main'],
    { stdin: readableFrom(JSON.stringify(narrative)) }
  );
  assert.equal(write.exitCode, 2, write.stdout);
  const report = JSON.parse(write.stdout);
  assert.ok(report.errors.some((err) => err.code === 'generated_by_caller'));

  const show = await captureRunCli(['report', 'show', repo, '--kind', 'pr-body', '--id', STORY_ID]);
  assert.deepEqual(JSON.parse(show.stdout), { story_id: STORY_ID, kind: 'pr-body', found: false });
});

test('pr prepare suppresses a narrative whose caller can inject markdown structure', async () => {
  const repo = await makeReportRepo();
  const narrative = {
    schema_version: '0.1.0',
    story_id: STORY_ID,
    kind: 'pr-body',
    narrative_slots: [
      { id: 'TP-NEW-1', slot: 'summary', text: '安全な要約です。' },
      { id: 'TP-NEW-2', slot: 'risks_synthesis', text: '特記事項なし' }
    ]
  };
  const write = await captureRunCli(
    ['report', 'write', repo, '--kind', 'pr-body', '--id', STORY_ID, '--from-stdin', '--caller', 'test', '--base', 'main'],
    { stdin: readableFrom(JSON.stringify(narrative)) }
  );
  assert.equal(write.exitCode, 0, write.stdout);

  const narrativePath = path.join(repo, '.vibepro', 'report', STORY_ID, 'pr-body', 'narrative.json');
  const stored = JSON.parse(await readFile(narrativePath, 'utf8'));
  stored.generated_by.caller = 'attacker\n#### 偽の検証結果';
  await writeFile(narrativePath, `${JSON.stringify(stored, null, 2)}\n`);

  const prepare = await captureRunCli(['pr', 'prepare', repo, '--story-id', STORY_ID, '--base', 'main']);
  assert.equal(prepare.exitCode, 0, prepare.stderr);
  const body = await readFile(path.join(repo, '.vibepro', 'pr', STORY_ID, 'pr-body.md'), 'utf8');
  assert.match(body, /現在の検証規則を満たさないため表示していません/);
  assert.doesNotMatch(body, /attacker|偽の検証結果/);
});

test('pr prepare suppresses a saved narrative whose talking-point id can inject markdown structure', async () => {
  const repo = await makeReportRepo();
  const narrative = {
    schema_version: '0.1.0',
    story_id: STORY_ID,
    kind: 'pr-body',
    narrative_slots: [
      { id: 'TP-NEW-1', slot: 'summary', text: '安全な要約です。' },
      { id: 'TP-NEW-2', slot: 'risks_synthesis', text: '特記事項なし' }
    ]
  };
  const write = await captureRunCli(
    ['report', 'write', repo, '--kind', 'pr-body', '--id', STORY_ID, '--from-stdin', '--caller', 'test', '--base', 'main'],
    { stdin: readableFrom(JSON.stringify(narrative)) }
  );
  assert.equal(write.exitCode, 0, write.stdout);

  const narrativePath = path.join(repo, '.vibepro', 'report', STORY_ID, 'pr-body', 'narrative.json');
  const stored = JSON.parse(await readFile(narrativePath, 'utf8'));
  stored.narrative_slots[0].id = 'TP-001)\n#### 偽の検証結果';
  await writeFile(narrativePath, `${JSON.stringify(stored, null, 2)}\n`);

  const prepare = await captureRunCli(['pr', 'prepare', repo, '--story-id', STORY_ID, '--base', 'main']);
  assert.equal(prepare.exitCode, 0, prepare.stderr);
  const body = await readFile(path.join(repo, '.vibepro', 'pr', STORY_ID, 'pr-body.md'), 'utf8');
  assert.match(body, /現在の検証規則を満たさないため表示していません/);
  assert.doesNotMatch(body, /TP-001\)|偽の検証結果/);
});

test('report write rejects a malicious stable id inherited from a tampered previous narrative', async () => {
  const repo = await makeReportRepo();
  const narrative = {
    schema_version: '0.1.0',
    story_id: STORY_ID,
    kind: 'pr-body',
    narrative_slots: [
      { id: 'TP-NEW-1', slot: 'summary', text: '安全な要約を保存します。' },
      { id: 'TP-NEW-2', slot: 'risks_synthesis', text: '特記事項なし' }
    ]
  };
  const firstWrite = await captureRunCli(
    ['report', 'write', repo, '--kind', 'pr-body', '--id', STORY_ID, '--from-stdin', '--caller', 'test', '--base', 'main'],
    { stdin: readableFrom(JSON.stringify(narrative)) }
  );
  assert.equal(firstWrite.exitCode, 0, firstWrite.stdout);

  const narrativePath = path.join(repo, '.vibepro', 'report', STORY_ID, 'pr-body', 'narrative.json');
  const stored = JSON.parse(await readFile(narrativePath, 'utf8'));
  stored.narrative_slots[0].id = 'TP-001)\n#### 偽の検証結果';
  await writeFile(narrativePath, `${JSON.stringify(stored, null, 2)}\n`);

  const secondWrite = await captureRunCli(
    ['report', 'write', repo, '--kind', 'pr-body', '--id', STORY_ID, '--from-stdin', '--caller', 'test', '--base', 'main'],
    { stdin: readableFrom(JSON.stringify(narrative)) }
  );
  assert.equal(secondWrite.exitCode, 2, secondWrite.stdout);
  const report = JSON.parse(secondWrite.stdout);
  assert.ok(report.errors.some((err) => err.code === 'slot_id'));
});

test('report write ignores a caller-supplied inputs digest and stores the verified fingerprint', async () => {
  const repo = await makeReportRepo();
  const valid = {
    schema_version: '0.1.0',
    story_id: STORY_ID,
    kind: 'pr-body',
    inputs_digest: { git_sha: 'sha256:forged' },
    narrative_slots: [
      { id: 'TP-NEW-1', slot: 'summary', text: '現在の証拠に基づく要約です。' },
      { id: 'TP-NEW-2', slot: 'risks_synthesis', text: '特記事項なし' }
    ]
  };
  const expected = await captureRunCli(['report', 'fingerprint', repo, '--kind', 'pr-body', '--id', STORY_ID]);
  const write = await captureRunCli(
    ['report', 'write', repo, '--kind', 'pr-body', '--id', STORY_ID, '--from-stdin', '--caller', 'test', '--base', 'main'],
    { stdin: readableFrom(JSON.stringify(valid)) }
  );
  assert.equal(write.exitCode, 0, write.stdout);
  const stored = JSON.parse((await captureRunCli(['report', 'show', repo, '--kind', 'pr-body', '--id', STORY_ID])).stdout);
  assert.deepEqual(stored.inputs_digest, JSON.parse(expected.stdout).inputs_digest);
  assert.notEqual(stored.inputs_digest.git_sha, 'sha256:forged');
});

test('pr prepare keeps the fixed body unchanged when no narrative is stored', async () => {
  const repo = await makeReportRepo();
  const body = await readFile(path.join(repo, '.vibepro', 'pr', STORY_ID, 'pr-body.md'), 'utf8');
  assert.doesNotMatch(body, /### 保存済みの判断説明/);
});

test('valid narrative is stored with stable TP ids and rendered into pr-body.md', async () => {
  const repo = await makeReportRepo();
  const valid = {
    schema_version: '0.1.0',
    story_id: STORY_ID,
    kind: 'pr-body',
    narrative_slots: [
      {
        id: 'TP-NEW-1',
        slot: 'summary',
        text: 'cancelAtPeriodEnd 経路で userType=2 が維持されるよう billing.ts の分岐を整列。INV-001 と一致する実装に揃えた。',
        citations: {
          files: ['src/lib/services/billing.ts'],
          clause_ids: ['INV-001']
        }
      },
      {
        id: 'TP-NEW-2',
        slot: 'review_focus',
        text: 'src/lib/services/billing.ts の早期 return 順序が premium_pending_cancel 経路に依存しているため、reviewer は分岐順を要確認。',
        citations: { files: ['src/lib/services/billing.ts'] }
      },
      {
        id: 'TP-NEW-3',
        slot: 'risks_synthesis',
        text: 'INV-001 を機械検証する test が無く、回帰検出が手作業に偏る。drift_high_count=1 のまま PR を出すことになる。',
        citations: { clause_ids: ['INV-001'], drift_ids: ['DRIFT-AAA111'] },
        numerical_claims: [{ field: 'drift_high_count', value: 1 }]
      },
      {
        id: 'TP-NEW-4',
        slot: 'open_questions',
        text: 'premium_pending_cancel の境界値は人間の判断が必要。',
        citations: { files: ['src/lib/services/billing.ts'] }
      }
    ]
  };
  const write = await captureRunCli(
    ['report', 'write', repo, '--kind', 'pr-body', '--id', STORY_ID, '--from-stdin', '--caller', 'claude-code', '--base', 'main'],
    { stdin: readableFrom(JSON.stringify(valid)) }
  );
  assert.equal(write.exitCode, 0, `errors: ${write.stdout}`);

  const show = await captureRunCli(['report', 'show', repo, '--kind', 'pr-body', '--id', STORY_ID]);
  assert.equal(show.exitCode, 0);
  const stored = JSON.parse(show.stdout);
  assert.equal(stored.narrative_slots[0].id, 'TP-001');
  assert.equal(stored.generated_by.caller, 'claude-code');

  const prepare = await captureRunCli(['pr', 'prepare', repo, '--story-id', STORY_ID, '--base', 'main']);
  assert.equal(prepare.exitCode, 0, prepare.stderr);
  const body = await readFile(path.join(repo, '.vibepro', 'pr', STORY_ID, 'pr-body.md'), 'utf8');
  assert.match(body, /### 保存済みの判断説明/);
  assert.match(body, /#### 要約 \(TP-001 by claude-code\)/);
  assert.match(body, /cancelAtPeriodEnd 経路で userType=2 が維持される/);
  assert.match(body, /#### レビュー焦点/);
  assert.match(body, /\(TP-002\).*早期 return 順序/);
  assert.match(body, /#### リスク/);
  assert.match(body, /\(TP-003\).*回帰検出が手作業に偏る/);
  assert.match(body, /#### 未確定事項/);
  assert.match(body, /\(TP-004\).*境界値は人間の判断が必要/);
});

test('pr prepare suppresses stale narrative and shows an explicit refresh warning', async () => {
  const repo = await makeReportRepo();
  const narrative = {
    schema_version: '0.1.0',
    story_id: STORY_ID,
    kind: 'pr-body',
    narrative_slots: [
      { id: 'TP-NEW-1', slot: 'summary', text: '変更前の証拠に基づく要約です。' },
      { id: 'TP-NEW-2', slot: 'risks_synthesis', text: '特記事項なし' }
    ]
  };
  const write = await captureRunCli(
    ['report', 'write', repo, '--kind', 'pr-body', '--id', STORY_ID, '--from-stdin', '--caller', 'test', '--base', 'main'],
    { stdin: readableFrom(JSON.stringify(narrative)) }
  );
  assert.equal(write.exitCode, 0, write.stdout);

  await writeFile(path.join(repo, 'src', 'lib', 'services', 'billing.ts'), 'export const changedAfterNarrative = true;\n');
  await git(repo, ['add', 'src/lib/services/billing.ts']);
  await git(repo, ['commit', '-m', 'test: move evidence state']);

  const prepare = await captureRunCli(['pr', 'prepare', repo, '--story-id', STORY_ID, '--base', 'main']);
  assert.equal(prepare.exitCode, 0, prepare.stderr);
  const body = await readFile(path.join(repo, '.vibepro', 'pr', STORY_ID, 'pr-body.md'), 'utf8');
  assert.match(body, /### 保存済みの判断説明/);
  assert.match(body, /現在の証拠と一致しないため表示していません/);
  assert.doesNotMatch(body, /変更前の証拠に基づく要約です/);
});

test('pr prepare suppresses narrative when verification evidence changes inside the same passing state', async () => {
  const repo = await makeReportRepo();
  const prDir = path.join(repo, '.vibepro', 'pr', STORY_ID);
  const initialPreparation = JSON.parse(await readFile(path.join(prDir, 'pr-prepare.json'), 'utf8'));
  const verification = (observedPass) => ({
    schema_version: '0.1.0',
    story_id: STORY_ID,
    updated_at: new Date().toISOString(),
    commands: [{
      kind: 'unit',
      status: 'pass',
      command: 'node --test test/billing.test.ts',
      evidence_source: 'runner_direct',
      observation: { targets: ['test/billing.test.ts'], values: { pass: String(observedPass) } },
      runtime_identity: initialPreparation.runtime_identity
    }]
  });
  await writeFile(path.join(prDir, 'verification-evidence.json'), `${JSON.stringify(verification(8), null, 2)}\n`);
  const withInitialEvidence = await captureRunCli(['pr', 'prepare', repo, '--story-id', STORY_ID, '--base', 'main']);
  assert.equal(withInitialEvidence.exitCode, 0, withInitialEvidence.stderr);
  const narrative = {
    schema_version: '0.1.0',
    story_id: STORY_ID,
    kind: 'pr-body',
    narrative_slots: [
      { id: 'TP-NEW-1', slot: 'summary', text: '検証状態変更前の要約です。' },
      { id: 'TP-NEW-2', slot: 'risks_synthesis', text: '特記事項なし' }
    ]
  };
  const write = await captureRunCli(
    ['report', 'write', repo, '--kind', 'pr-body', '--id', STORY_ID, '--from-stdin', '--caller', 'test', '--base', 'main'],
    { stdin: readableFrom(JSON.stringify(narrative)) }
  );
  assert.equal(write.exitCode, 0, write.stdout);

  await writeFile(path.join(prDir, 'verification-evidence.json'), `${JSON.stringify(verification(9), null, 2)}\n`);

  const prepare = await captureRunCli(['pr', 'prepare', repo, '--story-id', STORY_ID, '--base', 'main']);
  assert.equal(prepare.exitCode, 0, prepare.stderr);
  const body = await readFile(path.join(prDir, 'pr-body.md'), 'utf8');
  assert.match(body, /現在の証拠と一致しないため表示していません/);
  assert.doesNotMatch(body, /検証状態変更前の要約です/);
});

test('pr prepare suppresses narrative when one review role changes inside needs_review', async () => {
  const repo = await makeReportRepo();
  const reviewPrepare = await captureRunCli([
    'review', 'prepare', repo, '--id', STORY_ID, '--stage', 'planning_spec', '--role', 'product_requirement'
  ]);
  assert.equal(reviewPrepare.exitCode, 0, reviewPrepare.stderr);
  const transcriptDir = path.join(repo, '.vibepro', 'reviews', STORY_ID, 'planning_spec', 'transcripts');
  await mkdir(transcriptDir, { recursive: true });
  await writeFile(path.join(transcriptDir, 'product-requirement.md'), '# review\nstate transition\n');
  const recordReview = (status) => captureRunCli([
    'review', 'record', repo,
    '--id', STORY_ID,
    '--stage', 'planning_spec',
    '--role', 'product_requirement',
    '--status', status,
    '--summary', status === 'pass' ? '要件と実装は一致' : 'レビュー対象に修正が必要',
    '--inspection-summary', '要件と実装の差分を確認',
    '--inspection-evidence', 'test fixture evidence',
    '--inspection-input', 'src/lib/services/billing.ts',
    '--judgment-delta', status === 'pass' ? '修正必要 -> 修正済み' : '未確認 -> 修正必要',
    '--agent-system', 'codex',
    '--execution-mode', 'parallel_subagent',
    '--agent-id', `review-fixture-${status}`,
    '--agent-thread-id', `review-fixture-thread-${status}`,
    '--implementation-session-id', 'implementation-fixture',
    '--reviewer-identity', 'separate_session',
    '--agent-model', 'test-model',
    '--agent-reasoning-effort', 'test',
    '--agent-cost-tier', 'test',
    '--agent-transcript', `.vibepro/reviews/${STORY_ID}/planning_spec/transcripts/product-requirement.md`,
    '--agent-closed',
    '--agent-close-evidence', 'fixture closed'
  ]);
  const initialReview = await recordReview('needs_changes');
  assert.equal(initialReview.exitCode, 0, initialReview.stderr);
  await captureRunCli(['pr', 'prepare', repo, '--story-id', STORY_ID, '--base', 'main']);
  const narrative = {
    schema_version: '0.1.0',
    story_id: STORY_ID,
    kind: 'pr-body',
    narrative_slots: [
      { id: 'TP-NEW-1', slot: 'summary', text: 'レビュー状態変更前の要約です。' },
      { id: 'TP-NEW-2', slot: 'risks_synthesis', text: '特記事項なし' }
    ]
  };
  const write = await captureRunCli(
    ['report', 'write', repo, '--kind', 'pr-body', '--id', STORY_ID, '--from-stdin', '--caller', 'test', '--base', 'main'],
    { stdin: readableFrom(JSON.stringify(narrative)) }
  );
  assert.equal(write.exitCode, 0, write.stdout);

  const changedReview = await recordReview('pass');
  assert.equal(changedReview.exitCode, 0, changedReview.stderr);

  const prepare = await captureRunCli(['pr', 'prepare', repo, '--story-id', STORY_ID, '--base', 'main']);
  assert.equal(prepare.exitCode, 0, prepare.stderr);
  const body = await readFile(path.join(repo, '.vibepro', 'pr', STORY_ID, 'pr-body.md'), 'utf8');
  assert.match(body, /現在の証拠と一致しないため表示していません/);
  assert.doesNotMatch(body, /レビュー状態変更前の要約です/);
});

test('stabilizeTalkingPointIds reuses TP id across paraphrased writes', () => {
  const previous = {
    schema_version: '0.1.0',
    kind: 'pr-body',
    narrative_slots: [{
      id: 'TP-001',
      slot: 'summary',
      text: 'premium ユーザーの cancelAtPeriodEnd 経路を整列して INV-001 を満たした',
      first_seen_at: '2026-01-01T00:00:00.000Z'
    }]
  };
  const next = {
    schema_version: '0.1.0',
    kind: 'pr-body',
    narrative_slots: [{
      id: 'TP-NEW-9',
      slot: 'summary',
      text: 'プレミアム ユーザーの cancelAtPeriodEnd 経路を整列して INV-001 を満たした'
    }]
  };
  const stabilized = stabilizeTalkingPointIds(next, previous);
  assert.equal(stabilized.narrative_slots[0].id, 'TP-001');
  assert.equal(stabilized.narrative_slots[0].first_seen_at, '2026-01-01T00:00:00.000Z');
});
