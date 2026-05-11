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
  return repo;
}

test('report fingerprint --kind pr-body emits story, gate, drift, spec, schema, instructions', async () => {
  const repo = await makeReportRepo();
  const { exitCode, stdout } = await captureRunCli([
    'report', 'fingerprint', repo,
    '--kind', 'pr-body', '--id', STORY_ID,
    '--base', 'main', '--include-instructions'
  ]);
  assert.equal(exitCode, 0);
  const fp = JSON.parse(stdout);
  assert.equal(fp.kind, 'pr-body');
  assert.equal(fp.story_id, STORY_ID);
  assert.ok(fp.gate_dag?.nodes?.length > 0);
  assert.ok(fp.drift?.items?.some((item) => item.id === 'DRIFT-AAA111'));
  assert.ok(fp.inferred_spec?.clauses?.some((clause) => clause.id === 'INV-001'));
  assert.equal(fp.numerical_truth.drift_high_count, 1);
  assert.ok(fp.schema_for_your_output.$id.includes('report-pr-body'));
  assert.ok(typeof fp.instructions === 'string' && fp.instructions.length > 0);
});

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

  const prepare = await captureRunCli(['pr', 'prepare', repo, '--base', 'main', '--story-id', STORY_ID, '--allow-extra-files']);
  assert.equal(prepare.exitCode, 0);
  const prBody = await readFile(path.join(repo, '.vibepro', 'pr', STORY_ID, 'pr-body.md'), 'utf8');
  assert.match(prBody, /なぜこの PR か.*TP-001.*claude-code/s);
  assert.match(prBody, /レビュー焦点/);
  assert.match(prBody, /リスク合成.*TP-003/s);
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
