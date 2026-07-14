import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import {
  JUDGMENT_ADJUDICATION_VERDICTS,
  buildJudgmentDagAdjudicationGate,
  collectJudgmentItems,
  prepareJudgmentAdjudication,
  recordJudgmentAdjudication
} from '../../src/adjudication.js';
import { preparePullRequest } from '../../src/pr-manager.js';

const execFileAsync = promisify(execFile);
const CLI_PATH = fileURLToPath(new URL('../../bin/vibepro.js', import.meta.url));
const STORY_ID = 'story-jda-e2e';

async function git(repo, args) {
  await execFileAsync('git', args, { cwd: repo });
}

const GATE_DAG = {
  nodes: [
    {
      id: 'gate:common_judgment_spine',
      type: 'engineering_judgment_spine_gate',
      subchecks: [
        {
          id: 'current_reality',
          status: 'passed',
          surface: 'workflow',
          matched_evidence: [{ kind: 'flow_replay', ref: 'npm test' }],
          reason: 'workflow changes need focused runtime evidence'
        }
      ]
    },
    {
      id: 'gate:judgment_axis_public_contract',
      type: 'judgment_axis_gate',
      axis: 'public_contract',
      status: 'passed',
      decision_question: 'この変更は外部利用者、CLI/API、設定、出力形式、またはPR本文契約を壊さないか。',
      matched_evidence: [{ kind: 'compat_or_output_test', ref: 'npm test' }]
    },
    {
      id: 'gate:failure_mode_coverage',
      type: 'failure_mode_coverage_gate',
      modes: [
        { id: 'parse_failure', reason: 'Parser can fail on malformed input', keywords: ['parse'], status: 'covered', evidence: 'npm test' }
      ]
    }
  ]
};

const ITEM_IDS = ['spine:current_reality', 'axis:public_contract', 'failure_mode:parse_failure'];

async function makeRepo({ prPrepare = null, judgmentConfig = null } = {}) {
  const repo = await mkdtemp(path.join(os.tmpdir(), 'vibepro-jda-e2e-'));
  await git(repo, ['init', '-b', 'main']);
  await git(repo, ['config', 'user.email', 'test@example.com']);
  await git(repo, ['config', 'user.name', 'Test User']);
  await writeFile(path.join(repo, 'README.md'), '# Fixture\n');
  await mkdir(path.join(repo, '.vibepro'), { recursive: true });
  const config = {
    schema_version: '0.1.0',
    tool: 'vibepro',
    workspace: '.vibepro',
    brainbase: {
      stories: [{ story_id: STORY_ID, title: 'Judgment e2e fixture', ssot: 'local', status: 'active' }],
      current_story_id: STORY_ID
    }
  };
  if (judgmentConfig) config.judgment_adjudication = judgmentConfig;
  await writeFile(path.join(repo, '.vibepro', 'config.json'), `${JSON.stringify(config, null, 2)}\n`, 'utf8');
  if (prPrepare) {
    const prDir = path.join(repo, '.vibepro', 'pr', STORY_ID);
    await mkdir(prDir, { recursive: true });
    await writeFile(path.join(prDir, 'pr-prepare.json'), `${JSON.stringify(prPrepare, null, 2)}\n`, 'utf8');
  }
  await git(repo, ['add', '.']);
  await git(repo, ['commit', '-m', 'chore: baseline']);
  return repo;
}

function judgmentPrPrepare() {
  return {
    git: { changed_files: [{ path: 'src/pipeline.js' }, { path: 'test/pipeline.test.js' }] },
    pr_context: {
      gate_dag: GATE_DAG,
      engineering_judgment: { route_type: 'agent_workflow' },
      change_classification: { profile: 'standard' }
    }
  };
}

async function headOf(repo) {
  const { stdout } = await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: repo });
  return stdout.trim();
}

function verdictEntry(itemId, verdict, headCommit, reason = '変更の実体に照らして判断が成立している') {
  return {
    item_id: itemId,
    verdict,
    reason,
    provenance: { agent_system: 'claude_code', agent_id: 'judge-e2e' },
    head_commit: headCommit,
    recorded_at: '2026-07-14T00:00:00.000Z'
  };
}

// story-vibepro-judgment-dag-adjudication ac:1
// story-vibepro-judgment-dag-adjudication S-001
test('JDA-E2E-001 story-vibepro-judgment-dag-adjudication ac:1 prepare --judgment collects the three item families with questions, discharge state, evidence, and changed files', async () => {
  // `adjudicate prepare --judgment` は最新pr-prepare.jsonからspine subcheck・judgment axis・failure modeのアクティブ項目を収集し、各項目の問い原文・現在の機械的消化状態・一致した証拠・変更ファイル一覧を含む依頼書を生成する
  const repo = await makeRepo({ prPrepare: judgmentPrPrepare() });
  const result = await prepareJudgmentAdjudication(repo, { storyId: STORY_ID });
  assert.equal(result.item_count, 3, 'S-001 the request checklist must contain every active judgment item');
  const request = await readFile(path.join(repo, result.artifact), 'utf8');
  for (const itemId of ITEM_IDS) assert.match(request, new RegExp(itemId.replace(/[:]/g, ':')));
  assert.match(request, /この変更は外部利用者、CLI\/API、設定、出力形式、またはPR本文契約を壊さないか。/);
  assert.match(request, /機械的消化の現状: passed/);
  assert.match(request, /flow_replay/);
  assert.match(request, /- src\/pipeline\.js/);
  assert.match(request, /- test\/pipeline\.test\.js/);
});

// story-vibepro-judgment-dag-adjudication ac:2
// story-vibepro-judgment-dag-adjudication S-002
test('JDA-E2E-002 story-vibepro-judgment-dag-adjudication ac:2 prepare --judgment without a pr prepare artifact fails explicitly and writes nothing', async () => {
  // pr prepare成果物が無い状態の `--judgment` prepareは、成果物を作らず「先にpr prepareを実行せよ」という明示エラーになる
  const repo = await makeRepo();
  await assert.rejects(() => prepareJudgmentAdjudication(repo, { storyId: STORY_ID }), /no pr prepare artifact.*vibepro pr prepare/s);
  await assert.rejects(
    () => readFile(path.join(repo, '.vibepro', 'adjudication', STORY_ID, 'judgment-adjudication-request.md'), 'utf8'),
    /ENOENT/
  );
});

// story-vibepro-judgment-dag-adjudication ac:3
test('JDA-E2E-003 story-vibepro-judgment-dag-adjudication ac:3 the request instructs a fresh-context judge, defines the three verdicts, and forbids token-match-only soundness', async () => {
  // 依頼書には独立fresh contextでの実行・反証を試みる立場・裁定語彙3値（judged_sound / judged_unsound / needs_human_judgment）の定義と、トークン一致だけでは判断成立と見なさない旨の指示が含まれる
  const repo = await makeRepo({ prPrepare: judgmentPrPrepare() });
  const result = await prepareJudgmentAdjudication(repo, { storyId: STORY_ID });
  const request = await readFile(path.join(repo, result.artifact), 'utf8');
  assert.match(request, /独立したfresh contextの裁定者/);
  assert.match(request, /反証/);
  for (const verdict of JUDGMENT_ADJUDICATION_VERDICTS) assert.match(request, new RegExp(verdict));
  assert.match(request, /トークンや文言が揃っていることだけを根拠に judged_sound を選んではならない/);
});

// story-vibepro-judgment-dag-adjudication ac:4
test('JDA-E2E-004 story-vibepro-judgment-dag-adjudication ac:4 record --judgment validates verdict, reason, provenance, and binds to the current HEAD via the real CLI', async () => {
  // `adjudicate record --judgment` は3値以外のverdict・空reason・provenance欠落をエラーにし、記録をcurrent HEADへバインドする（HEAD解決不能時は拒否）
  const repo = await makeRepo({ prPrepare: judgmentPrPrepare() });
  const base = [
    CLI_PATH, 'adjudicate', 'record', repo,
    '--id', STORY_ID, '--judgment', '--item', 'axis:public_contract',
    '--reason', '互換テストが旧出力との差分を検証している',
    '--agent-system', 'claude_code', '--agent-id', 'judge-e2e'
  ];
  await assert.rejects(() => execFileAsync('node', [...base, '--verdict', 'pass']), /--verdict must be one of/);
  await execFileAsync('node', [...base, '--verdict', 'judged_sound']);
  const stored = JSON.parse(await readFile(path.join(repo, '.vibepro', 'adjudication', STORY_ID, 'judgment-adjudication.json'), 'utf8'));
  assert.equal(stored.verdicts.length, 1);
  assert.equal(stored.verdicts[0].item_id, 'axis:public_contract');
  assert.equal(stored.verdicts[0].head_commit, await headOf(repo));
  assert.equal(stored.verdicts[0].provenance.agent_system, 'claude_code');

  const nonGit = await mkdtemp(path.join(os.tmpdir(), 'vibepro-jda-e2e-nogit-'));
  await mkdir(path.join(nonGit, '.vibepro'), { recursive: true });
  await assert.rejects(
    () => recordJudgmentAdjudication(nonGit, {
      storyId: STORY_ID, itemId: 'axis:public_contract', verdict: 'judged_sound',
      reason: 'x', agentSystem: 'claude_code', agentId: 'judge-e2e'
    }),
    /could not resolve the current HEAD commit/
  );
});

// story-vibepro-judgment-dag-adjudication ac:5
// story-vibepro-judgment-dag-adjudication S-003
test('JDA-E2E-005 story-vibepro-judgment-dag-adjudication ac:5 the gate reports needs_evidence with missing item ids for absent or stale adjudications', () => {
  // `pr prepare` の `gate:judgment_dag_adjudication` は、裁定が無い・stale・項目不足のとき `needs_evidence` になり、reasonへ不足item idを列挙する
  const items = collectJudgmentItems({ gateDag: GATE_DAG, routeType: 'agent_workflow', changeProfile: null });
  const empty = buildJudgmentDagAdjudicationGate({ items, adjudication: null, headSha: 'abc123', decisions: [] });
  assert.equal(empty.status, 'needs_evidence');
  for (const itemId of ITEM_IDS) assert.ok(empty.reason.includes(itemId), `${itemId} should be listed as missing`);

  // stale HEAD（別コミットへバインドされた裁定）はfail closedで欠落扱い
  const stale = buildJudgmentDagAdjudicationGate({
    items,
    adjudication: { verdicts: ITEM_IDS.map((id) => verdictEntry(id, 'judged_sound', 'old-head')) },
    headSha: 'abc123',
    decisions: []
  });
  assert.equal(stale.status, 'needs_evidence');
  // head_commit欠落エントリも欠落扱い（fail closed）
  const unbound = buildJudgmentDagAdjudicationGate({
    items,
    adjudication: { verdicts: ITEM_IDS.map((id) => ({ ...verdictEntry(id, 'judged_sound', 'abc123'), head_commit: null })) },
    headSha: 'abc123',
    decisions: []
  });
  assert.equal(unbound.status, 'needs_evidence');
});

// story-vibepro-judgment-dag-adjudication ac:6
// story-vibepro-judgment-dag-adjudication S-004
test('JDA-E2E-006 story-vibepro-judgment-dag-adjudication ac:6 any judged_unsound item fails the gate with the judge reasoning in the reason', () => {
  // いずれかの項目が `judged_unsound` のときゲートは `failed` になり、reasonにjudgeの理由が含まれる
  const items = collectJudgmentItems({ gateDag: GATE_DAG, routeType: 'agent_workflow', changeProfile: null });
  const verdicts = ITEM_IDS.map((id) => verdictEntry(id, 'judged_sound', 'abc123'));
  verdicts[1] = verdictEntry('axis:public_contract', 'judged_unsound', 'abc123', '互換テストは出力形式の変更点を実際には検証していない');
  const gate = buildJudgmentDagAdjudicationGate({ items, adjudication: { verdicts }, headSha: 'abc123', decisions: [] });
  assert.equal(gate.status, 'failed');
  assert.match(gate.reason, /互換テストは出力形式の変更点を実際には検証していない/);
});

// story-vibepro-judgment-dag-adjudication ac:7
test('JDA-E2E-007 story-vibepro-judgment-dag-adjudication ac:7 needs_human_judgment items resolve only through an accepted decision record with reason and artifact', () => {
  // `needs_human_judgment` の項目はdecision record（source `gate:judgment_dag_adjudication:<item-id>`、accepted+reason+artifact）でのみ解決される
  const items = collectJudgmentItems({ gateDag: GATE_DAG, routeType: 'agent_workflow', changeProfile: null });
  const verdicts = ITEM_IDS.map((id) => verdictEntry(id, 'judged_sound', 'abc123'));
  verdicts[0] = verdictEntry('spine:current_reality', 'needs_human_judgment', 'abc123', 'runtime挙動の妥当性は人間の判断が必要');
  const withoutDecision = buildJudgmentDagAdjudicationGate({ items, adjudication: { verdicts }, headSha: 'abc123', decisions: [] });
  assert.notEqual(withoutDecision.status, 'passed');

  const decision = {
    source: 'gate:judgment_dag_adjudication:spine:current_reality',
    status: 'accepted',
    reason: '人間がruntimeログを確認し妥当と判断',
    artifact: 'docs/decisions/jda-e2e.md'
  };
  const resolved = buildJudgmentDagAdjudicationGate({ items, adjudication: { verdicts }, headSha: 'abc123', decisions: [decision] });
  assert.equal(resolved.status, 'passed');
  // reason/artifact欠落のacceptedでは解決しない
  const bare = buildJudgmentDagAdjudicationGate({
    items, adjudication: { verdicts }, headSha: 'abc123',
    decisions: [{ ...decision, artifact: null }]
  });
  assert.notEqual(bare.status, 'passed');
});

// story-vibepro-judgment-dag-adjudication ac:8
// story-vibepro-judgment-dag-adjudication S-005
test('JDA-E2E-008 story-vibepro-judgment-dag-adjudication ac:8 all items resolved passes the gate and zero active items is an explicit not_applicable', () => {
  // 全アクティブ項目がcurrent HEADの裁定で解決されるとゲートは `passed`、アクティブ項目0件は明示 `not_applicable` になる
  const items = collectJudgmentItems({ gateDag: GATE_DAG, routeType: 'agent_workflow', changeProfile: null });
  const passed = buildJudgmentDagAdjudicationGate({
    items,
    adjudication: { verdicts: ITEM_IDS.map((id) => verdictEntry(id, 'judged_sound', 'abc123')) },
    headSha: 'abc123',
    decisions: []
  });
  assert.equal(passed.status, 'passed');

  const noItems = buildJudgmentDagAdjudicationGate({ items: [], adjudication: null, headSha: 'abc123', decisions: [] });
  assert.equal(noItems.status, 'not_applicable');
});

// story-vibepro-judgment-dag-adjudication ac:9
test('JDA-E2E-009 story-vibepro-judgment-dag-adjudication ac:9 pr prepare treats the unresolved gate as required and critical so ready_for_pr_create stays false', async () => {
  // ゲートは必須かつcriticalで、未解決の間 `ready_for_pr_create` はfalse、理由のみのwaiverでは通らない
  const repo = await makeRepo();
  const storiesDir = path.join(repo, 'docs', 'management', 'stories', 'active');
  await mkdir(storiesDir, { recursive: true });
  await writeFile(
    path.join(storiesDir, `${STORY_ID}.md`),
    ['---', `story_id: ${STORY_ID}`, 'title: "エージェントworkflowのゲートを見直す"', 'status: active', '---', '', '# エージェントworkflowのゲートを見直す', '', '## 受け入れ基準', '', '- [ ] エージェントのworkflow gateがレビューされる', ''].join('\n'),
    'utf8'
  );
  await writeFile(path.join(repo, 'src-workflow.js'), 'export const gate = () => true;\n', 'utf8');
  await git(repo, ['add', '.']);
  await git(repo, ['commit', '-m', 'feat: workflow gate fixture']);
  const result = await preparePullRequest(repo, { storyId: STORY_ID, baseBranch: 'main' });
  const routeType = result.preparation.pr_context.engineering_judgment?.route_type;
  assert.equal(routeType, 'agent_workflow', 'fixture must classify as agent_workflow');
  const gate = result.preparation.pr_context.gate_dag.nodes.find((node) => node.id === 'gate:judgment_dag_adjudication');
  assert.ok(gate, 'judgment gate should be present');
  assert.equal(gate.status, 'needs_evidence');
  assert.equal(gate.required, true);
  assert.equal(result.preparation.gate_status.ready_for_pr_create, false);
  assert.ok(
    result.preparation.pr_context.execution_gate.blocking_gates.some((item) => item.id === 'gate:judgment_dag_adjudication'),
    'gate must be critical (reason-only waivers cannot pass it)'
  );
});

// story-vibepro-judgment-dag-adjudication ac:10
// story-vibepro-judgment-dag-adjudication S-006
test('JDA-E2E-010 story-vibepro-judgment-dag-adjudication ac:10 config opt-out suppresses the gate and artifact-free repos do not crash', async () => {
  // `.vibepro/config.json` の `judgment_adjudication.enabled: false` でゲートが生成されず、成果物なしの既存リポジトリでも `pr prepare` はクラッシュしない
  const repo = await makeRepo({ judgmentConfig: { enabled: false } });
  const storiesDir = path.join(repo, 'docs', 'management', 'stories', 'active');
  await mkdir(storiesDir, { recursive: true });
  await writeFile(
    path.join(storiesDir, `${STORY_ID}.md`),
    ['---', `story_id: ${STORY_ID}`, 'title: "エージェントworkflowのゲートを見直す"', 'status: active', '---', '', '# エージェントworkflowのゲートを見直す', '', '## 受け入れ基準', '', '- [ ] エージェントのworkflow gateがレビューされる', ''].join('\n'),
    'utf8'
  );
  await writeFile(path.join(repo, 'src-workflow.js'), 'export const gate = () => true;\n', 'utf8');
  await git(repo, ['add', '.']);
  await git(repo, ['commit', '-m', 'feat: workflow gate fixture']);
  const result = await preparePullRequest(repo, { storyId: STORY_ID, baseBranch: 'main' });
  const gate = result.preparation.pr_context.gate_dag.nodes.find((node) => node.id === 'gate:judgment_dag_adjudication');
  assert.equal(gate, undefined, 'ac:10 judgment_adjudication.enabled=false must suppress the gate entirely and pr prepare must not crash');
});

// story-vibepro-judgment-dag-adjudication ac:11
test('JDA-E2E-011 story-vibepro-judgment-dag-adjudication ac:11 route scope: non-judgment routes collect zero items and workflow_heavy activates regardless of route', () => {
  // 対象routeは判断DAGがrelease判断を担う `agent_workflow` route / `workflow_heavy` profileのみ。それ以外のroute（fast lane・general等）はアクティブ項目0件として明示 `not_applicable` になる
  assert.deepEqual(collectJudgmentItems({ gateDag: GATE_DAG, routeType: 'general_engineering', changeProfile: null }), []);
  assert.deepEqual(collectJudgmentItems({ gateDag: GATE_DAG, routeType: 'fast_lane', changeProfile: 'light' }), []);
  assert.equal(collectJudgmentItems({ gateDag: GATE_DAG, routeType: 'general_engineering', changeProfile: 'workflow_heavy' }).length, 3);
  const gate = buildJudgmentDagAdjudicationGate({
    items: collectJudgmentItems({ gateDag: GATE_DAG, routeType: 'general_engineering', changeProfile: null }),
    adjudication: null,
    headSha: 'abc123',
    decisions: []
  });
  assert.equal(gate.status, 'not_applicable');
});
