import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { recordDecision } from '../../src/decision-records.js';

const execFileAsync = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const CLI_BIN = path.join(root, 'bin', 'vibepro.js');

// story-vibepro-budget-grant-tracked-decision-doc acceptance spec.
// One test per acceptance criterion, each replayed against the real CLI or the
// real repository content — no mocked decision store.
async function makeGrantRepo({ ignoreDocs = false } = {}) {
  const repo = await mkdtemp(path.join(os.tmpdir(), 'vibepro-bgt-acc-'));
  await execFileAsync('git', ['init'], { cwd: repo });
  await writeFile(path.join(repo, '.gitignore'), `.vibepro/*\n!.vibepro/config.json\n${ignoreDocs ? 'docs/\n' : ''}`);
  await mkdir(path.join(repo, '.vibepro'), { recursive: true });
  await writeFile(
    path.join(repo, '.vibepro', 'vibepro-manifest.json'),
    JSON.stringify({ schema_version: '0.1.0', runs: [], latest_run_by_story: {} }, null, 2)
  );
  await writeConfig(repo, { max_subagent_count: 10, amendment_reason: 'closure sequence raise' });
  return repo;
}

async function writeConfig(repo, override) {
  await writeFile(
    path.join(repo, '.vibepro', 'config.json'),
    JSON.stringify({
      schema_version: '0.1.0',
      budgets: {
        delivery_efficiency: { max_subagent_count: 6 },
        delivery_efficiency_by_story: { 'story-bgt-acc': override }
      }
    }, null, 2)
  );
}

function grantOptions(overrides = {}) {
  return {
    storyId: 'story-bgt-acc',
    type: 'waiver',
    status: 'accepted',
    source: 'budget:delivery_efficiency:story-bgt-acc',
    summary: 'owner approved raising the Story subagent cap to 10',
    reason: 'owner approved the raise for the closure sequence',
    budgetGrantor: 'sato-keigo',
    budgetGrantorKind: 'human',
    agentSystem: 'claude_code',
    agentId: 'agent-bgt-acc',
    ...overrides
  };
}

function grantArgs(repo) {
  return [
    CLI_BIN, 'decision', 'record', repo,
    '--id', 'story-bgt-acc',
    '--type', 'waiver',
    '--status', 'accepted',
    '--source', 'budget:delivery_efficiency:story-bgt-acc',
    '--summary', 'owner approved raising the Story subagent cap to 10',
    '--reason', 'owner approved the raise for the closure sequence',
    '--budget-grantor', 'sato-keigo',
    '--budget-grantor-kind', 'human',
    '--agent-system', 'claude_code',
    '--agent-id', 'agent-bgt-acc',
    '--json'
  ];
}

test('BGT-S-1 budget grant generates the tracked budget_override_approval document', async () => {
  // story-vibepro-budget-grant-tracked-decision-doc ac:1 budget grant を伴う decision record は docs/management/decisions/<date>-budget-override-<story-id>-<digest8>.md を生成する
  const repo = await makeGrantRepo();
  const { stdout } = await execFileAsync(process.execPath, grantArgs(repo), { cwd: root });
  const result = JSON.parse(stdout);
  const approval = result.decision.budget_approval;
  assert.match(approval.decision_doc,
    /^docs\/management\/decisions\/\d{4}-\d{2}-\d{2}-budget-override-story-bgt-acc-[0-9a-f]{8}\.md$/,
    'budget grant を伴う decision record は docs/management/decisions/<date>-budget-override-<story-id>-<digest8>.md を生成する');
  const doc = await readFile(path.join(repo, approval.decision_doc), 'utf8');
  assert.match(doc, /type: budget_override_approval/, 'frontmatter に type: budget_override_approval を含む');
  assert.match(doc, new RegExp(`decision_id: ${result.decision.decision_id}`), 'frontmatter に decision_id を含む');
  assert.match(doc, /approver: sato-keigo/, 'frontmatter に approver（grantor）を含む');
  assert.match(doc, /approver_kind: human/, 'frontmatter に approver_kind を含む');
  assert.match(doc, new RegExp(`approved_at: ${result.decision.recorded_at}`), 'frontmatter に approved_at を含む');
  assert.match(doc, new RegExp(`override_digest: ${approval.override_digest}`), 'frontmatter に override_digest を含む');
  assert.match(doc, /agent_id: agent-bgt-acc/, 'frontmatter に recorded_by を含む');
  assert.match(doc, /owner approved the raise for the closure sequence/, 'body に --reason の全文を含む');
});

test('BGT-S-2 the document path is cross-referenced as budget_approval.decision_doc', async () => {
  // story-vibepro-budget-grant-tracked-decision-doc ac:2 生成された document の repo 相対パスが workspace record 側の budget_approval.decision_doc に記録され、両チャネルが相互参照可能
  const repo = await makeGrantRepo();
  const { stdout } = await execFileAsync(process.execPath, grantArgs(repo), { cwd: root });
  const result = JSON.parse(stdout);
  const records = JSON.parse(await readFile(path.join(repo, '.vibepro', 'pr', 'story-bgt-acc', 'decision-records.json'), 'utf8'));
  assert.equal(records.decisions[0].budget_approval.decision_doc, result.decision.budget_approval.decision_doc,
    '生成された document の repo 相対パスが workspace record 側の budget_approval.decision_doc に記録され、両チャネルが相互参照可能');
  await assert.rejects(execFileAsync('git', ['check-ignore', result.decision.budget_approval.decision_doc], { cwd: repo }),
    undefined, 'document は tracked 側にあり git check-ignore に一致しない');
});

test('BGT-S-3 a gitignored document path fails the grant without a workspace record', async () => {
  // story-vibepro-budget-grant-tracked-decision-doc ac:3 document の生成先が gitignore されている場合、decision record は grant を記録せずに fail する
  const repo = await makeGrantRepo({ ignoreDocs: true });
  await assert.rejects(
    execFileAsync(process.execPath, grantArgs(repo), { cwd: root }),
    /gitignored/,
    'document の生成先が gitignore されている場合、decision record は fail する'
  );
  const leaked = await readFile(path.join(repo, '.vibepro', 'pr', 'story-bgt-acc', 'decision-records.json'), 'utf8')
    .catch((error) => error.code);
  assert.equal(leaked, 'ENOENT', 'untracked channel への silent fallback をしない（workspace record も書かれない）');
});

test('BGT-S-4 a decision without a budget grant writes no document', async () => {
  // story-vibepro-budget-grant-tracked-decision-doc ac:4 budget grant を伴わない decision record は document を生成せず、従来と同一の出力を返す
  const repo = await makeGrantRepo();
  const plain = await recordDecision(repo, {
    storyId: 'story-bgt-acc',
    type: 'needs_review',
    summary: 'plain decision',
    status: 'accepted'
  });
  assert.equal(plain.decision.budget_approval, null,
    'budget grant を伴わない decision record は budget_approval を持たず従来と同一の出力を返す');
  const decisionsDir = await readFile(path.join(repo, 'docs', 'management', 'decisions')).catch((error) => error.code);
  assert.equal(decisionsDir, 'ENOENT', 'budget grant を伴わない decision record は document を生成しない');
});

test('BGT-S-5 same digest overwrites deterministically; a changed budget becomes a new file', async () => {
  // story-vibepro-budget-grant-tracked-decision-doc ac:5 同一 story・同一 digest の再記録は同一パスへ決定論的に上書きされ、digest が変わる grant は別ファイルになる
  const repo = await makeGrantRepo();
  const first = await recordDecision(repo, grantOptions());
  const again = await recordDecision(repo, grantOptions());
  assert.equal(first.decision.budget_approval.decision_doc, again.decision.budget_approval.decision_doc,
    '同一 story・同一 digest の再記録は同一パスへ決定論的に上書きされる');
  await writeConfig(repo, { max_subagent_count: 14, amendment_reason: 'second raise' });
  const changed = await recordDecision(repo, grantOptions());
  assert.notEqual(changed.decision.budget_approval.decision_doc, first.decision.budget_approval.decision_doc,
    'digest が変わる grant は別ファイルになる（数値の変更が diff 上 新ファイルとして見える）');
  await readFile(path.join(repo, first.decision.budget_approval.decision_doc), 'utf8');
  await readFile(path.join(repo, changed.decision.budget_approval.decision_doc), 'utf8');
});

test('BGT-S-6 the backfill document for the parent story grants exists in the tracked channel', () => {
  // story-vibepro-budget-grant-tracked-decision-doc ac:6 親 Story story-vibepro-owner-gated-budget-override の 3 grant に対する backfill document が tracked channel に存在する
  const backfill = readFileSync(path.join(root,
    'docs/management/decisions/2026-07-30-budget-override-story-vibepro-owner-gated-budget-override-1f29ffff.md'), 'utf8');
  assert.match(backfill, /type: budget_override_approval/,
    '親 Story の 3 grant に対する backfill document が tracked channel に存在する');
  assert.match(backfill, /approver: sato_keigo/, 'backfill document は grantor（sato_keigo）を含む');
  assert.match(backfill, /override_digest: 1f29ffffec31a9405881c332f49136b4331b7d37cd0a9d869fd6b4ac20f02156/,
    'backfill document は現行 override の digest を含む');
  assert.match(backfill, /70ea817c-ee56-48c0-ab7c-612da8629872/, 'backfill document は承認セッション参照を含む');
});

test('BGT-S-7 the CLI reference documents the tracked document generation', () => {
  // story-vibepro-budget-grant-tracked-decision-doc ac:7 docs/reference/cli.md / docs/ja/reference/cli.md が tracked document 生成を明記する
  for (const ref of ['docs/reference/cli.md', 'docs/ja/reference/cli.md']) {
    const text = readFileSync(path.join(root, ref), 'utf8');
    assert.match(text, /budget_approval\.decision_doc/,
      `BGT-S-7: docs/reference/cli.md / docs/ja/reference/cli.md が tracked document 生成を明記する (${ref}: budget_approval.decision_doc)`);
    assert.match(text, /budget_override_approval/,
      `BGT-S-7: docs/reference/cli.md / docs/ja/reference/cli.md が tracked document 生成を明記する (${ref}: budget_override_approval type)`);
  }
});
