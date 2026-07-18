import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

import {
  JUDGMENT_ADJUDICATION_VERDICTS,
  buildJudgmentDagAdjudicationGate,
  collectJudgmentItems,
  prepareJudgmentAdjudication,
  readJudgmentAdjudicationIfExists,
  recordJudgmentAdjudication,
  recordPremiseCorrection,
  resolveCurrentJudgmentState,
  summarizeJudgmentAdjudicationForPr
} from '../src/adjudication.js';
import { preparePullRequest } from '../src/pr-manager.js';

const execFileAsync = promisify(execFile);
const STORY_ID = 'story-judgment-fixture';

async function git(repo, args) {
  await execFileAsync('git', args, { cwd: repo });
}

const FIXTURE_GATE_DAG = {
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
        },
        { id: 'failure_modes', status: 'needs_evidence', surface: 'workflow', matched_evidence: [], reason: 'failure modes need coverage' }
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

function fixtureItems() {
  return collectJudgmentItems({ gateDag: FIXTURE_GATE_DAG, routeType: 'agent_workflow', changeProfile: null });
}

async function makeRepo({ prPrepare = null, judgmentConfig = null } = {}) {
  const repo = await mkdtemp(path.join(os.tmpdir(), 'vibepro-judgment-'));
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
      stories: [{ story_id: STORY_ID, title: 'Judgment fixture', ssot: 'local', status: 'active' }],
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

test('JADJ-S-001 collectJudgmentItems gathers spine, axis, and failure mode items only on judgment routes', () => {
  const items = fixtureItems();
  const ids = items.map((item) => item.id);
  assert.deepEqual(ids, ['spine:current_reality', 'spine:failure_modes', 'axis:public_contract', 'failure_mode:parse_failure']);
  const axis = items.find((item) => item.id === 'axis:public_contract');
  assert.match(axis.question, /外部利用者/);
  assert.equal(axis.mechanical_status, 'passed');
  assert.match(axis.evidence_summary, /compat_or_output_test/);

  // 非判断route（general等）はアクティブ項目0件
  assert.deepEqual(collectJudgmentItems({ gateDag: FIXTURE_GATE_DAG, routeType: 'general_engineering', changeProfile: null }), []);
  // workflow_heavy profileはrouteに関わらず対象
  assert.equal(collectJudgmentItems({ gateDag: FIXTURE_GATE_DAG, routeType: 'general_engineering', changeProfile: 'workflow_heavy' }).length, 4);
});

test('JADJ-S-002 prepare --judgment fails explicitly without a pr prepare artifact and generates a checklist with one', async () => {
  const bare = await makeRepo();
  await assert.rejects(
    () => prepareJudgmentAdjudication(bare, { storyId: STORY_ID }),
    /no pr prepare artifact/
  );

  const repo = await makeRepo({
    prPrepare: {
      git: { changed_files: [{ path: 'src/a.js' }, { path: 'test/a.test.js' }] },
      pr_context: {
        gate_dag: FIXTURE_GATE_DAG,
        engineering_judgment: { route_type: 'agent_workflow' },
        change_classification: { profile: 'standard' }
      }
    }
  });
  const result = await prepareJudgmentAdjudication(repo, { storyId: STORY_ID });
  assert.equal(result.item_count, 4);
  const request = await readFile(path.join(repo, result.artifact), 'utf8');
  assert.match(request, /この変更は外部利用者、CLI\/API、設定、出力形式、またはPR本文契約を壊さないか。/);
  assert.match(request, /spine:current_reality/);
  assert.match(request, /failure_mode:parse_failure/);
  assert.match(request, /- src\/a\.js/);
  assert.match(request, /機械的消化の現状: passed/);
  for (const verdict of JUDGMENT_ADJUDICATION_VERDICTS) {
    assert.match(request, new RegExp(verdict));
  }
  assert.match(request, /独立したfresh contextの裁定者/);
  assert.match(request, /トークンや文言が揃っていることだけを根拠に judged_sound を選んではならない/);
});

test('JADJ-S-003 prepare --judgment on a non-judgment route fails explicitly instead of producing a pass-like artifact', async () => {
  const repo = await makeRepo({
    prPrepare: {
      git: { changed_files: [] },
      pr_context: {
        gate_dag: FIXTURE_GATE_DAG,
        engineering_judgment: { route_type: 'general_engineering' },
        change_classification: { profile: 'light' }
      }
    }
  });
  await assert.rejects(
    () => prepareJudgmentAdjudication(repo, { storyId: STORY_ID }),
    /no active judgment items/
  );
});

test('JADJ-S-004 record --judgment validates verdict, reason, provenance, binds HEAD, and refuses outside git', async () => {
  const repo = await makeRepo();
  const valid = {
    storyId: STORY_ID,
    itemId: 'axis:public_contract',
    verdict: 'judged_sound',
    reason: '互換テストが旧出力との差分を検証しており契約破壊なし',
    agentSystem: 'claude_code',
    agentId: 'judge-1'
  };
  await assert.rejects(() => recordJudgmentAdjudication(repo, { ...valid, verdict: 'pass' }), /--verdict must be one of/);
  await assert.rejects(() => recordJudgmentAdjudication(repo, { ...valid, reason: ' ' }), /--reason/);
  await assert.rejects(() => recordJudgmentAdjudication(repo, { ...valid, agentId: '' }), /--agent-id/);
  const result = await recordJudgmentAdjudication(repo, valid);
  const { stdout } = await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: repo });
  assert.equal(result.entry.head_commit, stdout.trim());
  const stored = await readJudgmentAdjudicationIfExists(repo, STORY_ID);
  assert.equal(stored.events.length, 1);
  assert.equal(stored.events[0].item_id, 'axis:public_contract');

  const nonGit = await mkdtemp(path.join(os.tmpdir(), 'vibepro-judgment-nogit-'));
  await mkdir(path.join(nonGit, '.vibepro'), { recursive: true });
  await assert.rejects(() => recordJudgmentAdjudication(nonGit, valid), /could not resolve the current HEAD commit/);
});

test('JADJ-S-005 gate lists missing items and treats stale or unbound verdicts as missing', () => {
  const items = fixtureItems();
  const gate = buildJudgmentDagAdjudicationGate({
    storyId: STORY_ID,
    items,
    adjudication: {
      verdicts: [
        { item_id: 'spine:current_reality', verdict: 'judged_sound', reason: 'ok', head_commit: 'head-1' },
        { item_id: 'axis:public_contract', verdict: 'judged_sound', reason: 'ok', head_commit: 'stale-head' },
        { item_id: 'failure_mode:parse_failure', verdict: 'judged_sound', reason: 'ok', head_commit: null }
      ]
    },
    headSha: 'head-1'
  });
  assert.equal(gate.status, 'needs_evidence');
  assert.deepEqual(gate.missing_items, ['spine:failure_modes', 'axis:public_contract', 'failure_mode:parse_failure']);
  assert.match(gate.reason, /axis:public_contract/);

  const unknownHead = buildJudgmentDagAdjudicationGate({
    storyId: STORY_ID,
    items,
    adjudication: { verdicts: [{ item_id: 'spine:current_reality', verdict: 'judged_sound', reason: 'ok', head_commit: 'head-1' }] },
    headSha: null
  });
  assert.equal(unknownHead.status, 'needs_evidence');
});

test('JADJ-S-006 judged_unsound fails the gate with the judge reason', () => {
  const items = fixtureItems();
  const verdicts = items.map((item) => ({ item_id: item.id, verdict: 'judged_sound', reason: 'ok', head_commit: 'head-1' }));
  verdicts[2] = { item_id: 'axis:public_contract', verdict: 'judged_unsound', reason: 'compat_or_output_testトークンはあるが実際は新旧出力比較が存在しない', head_commit: 'head-1' };
  const gate = buildJudgmentDagAdjudicationGate({ storyId: STORY_ID, items, adjudication: { verdicts }, headSha: 'head-1' });
  assert.equal(gate.status, 'failed');
  assert.match(gate.reason, /新旧出力比較が存在しない/);
});

test('JADJ-S-007 needs_human_judgment resolves only via an accepted decision record with reason and artifact', () => {
  const items = fixtureItems();
  const verdicts = items.map((item) => ({ item_id: item.id, verdict: 'judged_sound', reason: 'ok', head_commit: 'head-1' }));
  verdicts[0] = { item_id: 'spine:current_reality', verdict: 'needs_human_judgment', reason: '事業判断が必要', head_commit: 'head-1' };
  const open = buildJudgmentDagAdjudicationGate({
    storyId: STORY_ID,
    items,
    adjudication: { verdicts },
    headSha: 'head-1',
    decisions: [
      { source: 'gate:judgment_dag_adjudication:spine:current_reality', status: 'accepted', reason: null, artifact: 'x.md' },
      { source: 'gate:judgment_dag_adjudication:spine:current_reality', status: 'open', reason: 'judged', artifact: 'x.md' }
    ]
  });
  assert.equal(open.status, 'needs_evidence');
  assert.equal(open.human_judgment_items.length, 1);
  assert.match(open.reason, /human judgment/);

  const closed = buildJudgmentDagAdjudicationGate({
    storyId: STORY_ID,
    items,
    adjudication: { verdicts },
    headSha: 'head-1',
    decisions: [{ source: 'gate:judgment_dag_adjudication:spine:current_reality', status: 'accepted', reason: '人間が判断した', artifact: 'docs/decision.md' }]
  });
  assert.equal(closed.status, 'passed');
});

test('JADJ-S-008 gate passes with all sound fresh verdicts and is explicit not_applicable without items', () => {
  const items = fixtureItems();
  const verdicts = items.map((item) => ({ item_id: item.id, verdict: 'judged_sound', reason: 'ok', head_commit: 'head-1' }));
  const passed = buildJudgmentDagAdjudicationGate({ storyId: STORY_ID, items, adjudication: { verdicts }, headSha: 'head-1' });
  assert.equal(passed.status, 'passed');

  const empty = buildJudgmentDagAdjudicationGate({ storyId: STORY_ID, items: [] });
  assert.equal(empty.status, 'not_applicable');
  assert.match(empty.reason, /not a pass/);
});

test('JADJ-S-009 pr prepare emits a required critical judgment gate on judgment routes that blocks readiness', async () => {
  const repo = await makeRepo();
  await mkdir(path.join(repo, 'docs', 'management', 'stories', 'active'), { recursive: true });
  // route分類がagent workflowになるstory（agent/gate/review系の語を含む）
  await writeFile(path.join(repo, 'docs', 'management', 'stories', 'active', `${STORY_ID}.md`), `---
story_id: ${STORY_ID}
title: agent review gateの証跡lifecycleを更新する
status: active
---

# Story

agent review gateの証跡lifecycleとworkflowを更新する。

## 受け入れ基準

- [ ] agent review gateの証跡が更新される
`, 'utf8');
  await git(repo, ['add', '.']);
  await git(repo, ['commit', '-m', 'chore: story']);
  await git(repo, ['switch', '-c', 'feature/judgment']);
  await writeFile(path.join(repo, 'README.md'), '# Fixture\n\nchange\n');
  await git(repo, ['add', 'README.md']);
  await git(repo, ['commit', '-m', 'feat: change']);

  const result = await preparePullRequest(repo, {
    storyId: STORY_ID,
    baseRef: 'main',
    branchName: 'feature/judgment',
    evidenceDepth: 'summary'
  });
  const gateDag = result.preparation.pr_context.gate_dag;
  const routeType = result.preparation.pr_context.engineering_judgment?.route_type;
  assert.equal(routeType, 'agent_workflow', 'fixture must classify as agent_workflow for this test to be meaningful');
  const gate = gateDag.nodes.find((node) => node.id === 'gate:judgment_dag_adjudication');
  assert.ok(gate, 'judgment gate should be emitted');
  assert.equal(gate.status, 'needs_evidence');
  assert.equal(gate.required, true);
  assert.match(gate.reason, /spine:intent/);
  const gateStatus = result.preparation.gate_status;
  assert.equal(gateStatus.ready_for_pr_create, false);
  assert.ok(
    result.preparation.pr_context.execution_gate.blocking_gates.some((item) => item.id === 'gate:judgment_dag_adjudication'),
    'judgment gate should be critical (not waivable by reason alone)'
  );
});

test('JADJ-S-010 pr prepare omits the gate when judgment_adjudication.enabled is false and does not crash without artifacts', async () => {
  const repo = await makeRepo({ judgmentConfig: { enabled: false } });
  await git(repo, ['switch', '-c', 'feature/opt-out']);
  await writeFile(path.join(repo, 'README.md'), '# Fixture\n\nchange\n');
  await git(repo, ['add', 'README.md']);
  await git(repo, ['commit', '-m', 'feat: change']);

  const result = await preparePullRequest(repo, {
    storyId: STORY_ID,
    baseRef: 'main',
    branchName: 'feature/opt-out',
    evidenceDepth: 'summary'
  });
  const gateDag = result.preparation.pr_context.gate_dag;
  assert.equal(gateDag.nodes.find((node) => node.id === 'gate:judgment_dag_adjudication'), undefined);
});

test('JADJ-S-011 corrupt artifacts are reported as parse failures, not silently treated as missing', async () => {
  // 破損したpr-prepare.jsonは「成果物なし」と誤報告せず、parse失敗として明示エラーになる
  const repo = await makeRepo();
  const prDir = path.join(repo, '.vibepro', 'pr', STORY_ID);
  await mkdir(prDir, { recursive: true });
  await writeFile(path.join(prDir, 'pr-prepare.json'), '{ "pr_context": { malformed', 'utf8');
  await assert.rejects(
    () => prepareJudgmentAdjudication(repo, { storyId: STORY_ID }),
    (error) => {
      assert.match(error.message, /exists but is not valid JSON/);
      assert.doesNotMatch(error.message, /no pr prepare artifact was found/);
      return true;
    }
  );

  // 破損したjudgment-adjudication.jsonはsilent null（=needs_evidence偽装）にせずfail loud
  const adjDir = path.join(repo, '.vibepro', 'adjudication', STORY_ID);
  await mkdir(adjDir, { recursive: true });
  await writeFile(path.join(adjDir, 'judgment-adjudication.json'), '{"verdicts": [malformed', 'utf8');
  await assert.rejects(
    () => readJudgmentAdjudicationIfExists(repo, STORY_ID),
    /exists but is not valid JSON/
  );
});

test('CPR-S-001 new unsound verdicts require an explicit cause and records are append-only v2 events', async () => {
  const repo = await makeRepo();
  const base = {
    storyId: STORY_ID,
    itemId: 'axis:public_contract',
    verdict: 'judged_unsound',
    reason: 'classifier assumed a public output change that is absent from the diff',
    agentSystem: 'codex',
    agentId: 'judge-original'
  };
  await assert.rejects(() => recordJudgmentAdjudication(repo, base), /--unsound-cause/);
  await assert.rejects(
    () => recordJudgmentAdjudication(repo, { ...base, unsoundCause: 'unknown' }),
    /implementation_unsound, classifier_premise_unsound/
  );
  await assert.rejects(
    () => recordJudgmentAdjudication(repo, { ...base, verdict: 'judged_sound', unsoundCause: 'implementation_unsound' }),
    /only valid with judged_unsound/
  );

  const first = await recordJudgmentAdjudication(repo, { ...base, unsoundCause: 'classifier_premise_unsound' });
  const second = await recordJudgmentAdjudication(repo, {
    ...base,
    itemId: 'spine:current_reality',
    verdict: 'judged_sound',
    reason: 'runtime evidence answers the item',
    unsoundCause: null,
    agentId: 'judge-other'
  });
  assert.match(first.entry.event_id, /.+/);
  assert.equal(first.entry.unsound_cause, 'classifier_premise_unsound');
  assert.equal(second.records.schema_version, '0.2.0');
  assert.equal(second.records.model, 'vibepro-judgment-dag-adjudication-v2');
  assert.equal(second.records.events.length, 2);
  assert.deepEqual(second.records.events.map((event) => event.event_id), [first.entry.event_id, second.entry.event_id]);
});

test('CPR-S-002 correction validates lineage and evidence, then only a different linked judge can resolve it', async () => {
  const repo = await makeRepo();
  const evidencePath = path.join(repo, 'docs', 'premise-proof.md');
  await mkdir(path.dirname(evidencePath), { recursive: true });
  await writeFile(evidencePath, '# Replacement evidence\n\nThe public output is unchanged.\n', 'utf8');
  const original = await recordJudgmentAdjudication(repo, {
    storyId: STORY_ID,
    itemId: 'axis:public_contract',
    verdict: 'judged_unsound',
    unsoundCause: 'classifier_premise_unsound',
    reason: 'classifier assumed a public output change',
    agentSystem: 'codex',
    agentId: 'judge-original'
  });

  await assert.rejects(() => recordPremiseCorrection(repo, {
    storyId: STORY_ID,
    itemId: 'axis:other',
    originalVerdictId: original.entry.event_id,
    incorrectPremise: 'public output changed',
    correctedPremise: 'public output is unchanged',
    reason: 'diff and compatibility fixture prove the corrected premise',
    replacementEvidence: ['docs/premise-proof.md'],
    agentSystem: 'codex',
    agentId: 'operator'
  }), /same item/);

  const correction = await recordPremiseCorrection(repo, {
    storyId: STORY_ID,
    itemId: 'axis:public_contract',
    originalVerdictId: original.entry.event_id,
    incorrectPremise: 'public output changed',
    correctedPremise: 'public output is unchanged',
    reason: 'diff and compatibility fixture prove the corrected premise',
    replacementEvidence: ['docs/premise-proof.md'],
    agentSystem: 'codex',
    agentId: 'operator'
  });
  assert.equal(correction.entry.type, 'premise_correction');
  assert.match(correction.entry.replacement_evidence[0].sha256, /^[a-f0-9]{64}$/);

  const items = [{ id: 'axis:public_contract' }];
  let artifact = await readJudgmentAdjudicationIfExists(repo, STORY_ID);
  let gate = buildJudgmentDagAdjudicationGate({ storyId: STORY_ID, items, adjudication: artifact, headSha: await gitHead(repo) });
  assert.equal(gate.status, 'needs_evidence');
  assert.deepEqual(gate.pending_correction_items, ['axis:public_contract']);

  await assert.rejects(() => recordJudgmentAdjudication(repo, {
    storyId: STORY_ID,
    itemId: 'axis:public_contract',
    correctionId: correction.entry.event_id,
    verdict: 'judged_sound',
    reason: 'same judge cannot independently re-adjudicate',
    agentSystem: 'codex',
    agentId: 'judge-original'
  }), /different independent judge/);

  await recordJudgmentAdjudication(repo, {
    storyId: STORY_ID,
    itemId: 'axis:public_contract',
    correctionId: correction.entry.event_id,
    verdict: 'judged_sound',
    reason: 'replacement evidence proves the corrected premise and the item now holds',
    agentSystem: 'codex',
    agentId: 'judge-fresh'
  });
  artifact = await readJudgmentAdjudicationIfExists(repo, STORY_ID);
  gate = buildJudgmentDagAdjudicationGate({ storyId: STORY_ID, items, adjudication: artifact, headSha: await gitHead(repo) });
  assert.equal(gate.status, 'passed');
  assert.equal(artifact.events.length, 3);
  assert.deepEqual(artifact.events.map((event) => event.type), ['verdict', 'premise_correction', 'verdict']);
});

test('CPR-S-003 resolver is reference-driven, order-independent, and legacy unsound remains implementation failure', () => {
  const original = {
    event_id: 'verdict-original', type: 'verdict', item_id: 'axis:public_contract',
    verdict: 'judged_unsound', unsound_cause: 'classifier_premise_unsound', responds_to_correction_id: null,
    reason: 'wrong premise', provenance: { agent_system: 'codex', agent_id: 'judge-a' }, head_commit: 'head-1'
  };
  const correction = {
    event_id: 'correction-1', type: 'premise_correction', item_id: 'axis:public_contract',
    corrects_verdict_id: 'verdict-original', wrong_premise: 'changed', corrected_premise: 'unchanged',
    reason: 'replacement evidence', replacement_evidence: [{ artifact: 'docs/proof.md', sha256: 'a'.repeat(64) }],
    provenance: { agent_system: 'codex', agent_id: 'operator' }, head_commit: 'head-1'
  };
  const resolved = {
    event_id: 'verdict-resolved', type: 'verdict', item_id: 'axis:public_contract', verdict: 'judged_sound',
    unsound_cause: null, responds_to_correction_id: 'correction-1', reason: 'holds now',
    provenance: { agent_system: 'codex', agent_id: 'judge-b' }, head_commit: 'head-1'
  };
  const options = { storyId: STORY_ID, itemIds: ['axis:public_contract'], headSha: 'head-1' };
  const forward = resolveCurrentJudgmentState({ ...options, adjudication: { story_id: STORY_ID, events: [original, correction, resolved] } });
  const reverse = resolveCurrentJudgmentState({ ...options, adjudication: { story_id: STORY_ID, events: [resolved, correction, original] } });
  assert.deepEqual(reverse, forward);
  assert.equal(forward.items[0].status, 'resolved');

  const legacyGate = buildJudgmentDagAdjudicationGate({
    storyId: STORY_ID,
    items: [{ id: 'axis:public_contract' }],
    adjudication: { story_id: STORY_ID, verdicts: [{ item_id: 'axis:public_contract', verdict: 'judged_unsound', reason: 'legacy gap', head_commit: 'head-1' }] },
    headSha: 'head-1'
  });
  assert.equal(legacyGate.status, 'failed');
  assert.equal(legacyGate.judged_unsound_items[0].unsound_cause, 'implementation_unsound');
});

test('CPR-S-004 summary counts resolved current item state, not append-only history rows', () => {
  const events = [
    { event_id: 'v1', type: 'verdict', item_id: 'axis:x', verdict: 'judged_unsound', unsound_cause: 'classifier_premise_unsound', reason: 'wrong', provenance: { agent_system: 'codex', agent_id: 'a' }, head_commit: 'h' },
    { event_id: 'c1', type: 'premise_correction', item_id: 'axis:x', corrects_verdict_id: 'v1', wrong_premise: 'x', corrected_premise: 'y', reason: 'proof', replacement_evidence: [{ artifact: 'docs/p.md', sha256: 'a'.repeat(64) }], provenance: { agent_system: 'codex', agent_id: 'op' }, head_commit: 'h' },
    { event_id: 'v2', type: 'verdict', item_id: 'axis:x', verdict: 'judged_sound', responds_to_correction_id: 'c1', reason: 'ok', provenance: { agent_system: 'codex', agent_id: 'b' }, head_commit: 'h' }
  ];
  const summary = summarizeJudgmentAdjudicationForPr({ items: [{ id: 'axis:x' }], adjudication: { story_id: STORY_ID, events }, headSha: 'h', storyId: STORY_ID });
  assert.equal(summary.fresh_verdict_count, 1);
  assert.equal(summary.judged_sound_count, 1);
  assert.equal(summary.judged_unsound_count, 0);
});

test('CPR-S-005 implementation failures cannot be corrected and a linked unsound re-adjudication remains failed', async () => {
  const repo = await makeRepo();
  await mkdir(path.join(repo, 'docs'), { recursive: true });
  await writeFile(path.join(repo, 'docs', 'proof.md'), 'replacement proof\n', 'utf8');
  const implementationFailure = await recordJudgmentAdjudication(repo, {
    storyId: STORY_ID,
    itemId: 'axis:implementation',
    verdict: 'judged_unsound',
    unsoundCause: 'implementation_unsound',
    reason: 'the implementation does not preserve the contract',
    agentSystem: 'codex',
    agentId: 'judge-a'
  });
  await assert.rejects(() => recordPremiseCorrection(repo, {
    storyId: STORY_ID,
    itemId: 'axis:implementation',
    originalVerdictId: implementationFailure.entry.event_id,
    incorrectPremise: 'contract changed',
    correctedPremise: 'contract unchanged',
    reason: 'attempted waiver',
    replacementEvidence: ['docs/proof.md'],
    agentSystem: 'codex',
    agentId: 'operator'
  }), /only classifier_premise_unsound/);

  const classifierFailure = await recordJudgmentAdjudication(repo, {
    storyId: STORY_ID,
    itemId: 'axis:classifier',
    verdict: 'judged_unsound',
    unsoundCause: 'classifier_premise_unsound',
    reason: 'classifier premise is wrong',
    agentSystem: 'codex',
    agentId: 'judge-a'
  });
  const correction = await recordPremiseCorrection(repo, {
    storyId: STORY_ID,
    itemId: 'axis:classifier',
    originalVerdictId: classifierFailure.entry.event_id,
    incorrectPremise: 'output changed',
    correctedPremise: 'output unchanged',
    reason: 'proof corrects the premise',
    replacementEvidence: ['docs/proof.md'],
    agentSystem: 'codex',
    agentId: 'operator'
  });
  await recordJudgmentAdjudication(repo, {
    storyId: STORY_ID,
    itemId: 'axis:classifier',
    correctionId: correction.entry.event_id,
    verdict: 'judged_unsound',
    unsoundCause: 'implementation_unsound',
    reason: 'the corrected premise reveals a real implementation gap',
    agentSystem: 'codex',
    agentId: 'judge-b'
  });
  const artifact = await readJudgmentAdjudicationIfExists(repo, STORY_ID);
  const gate = buildJudgmentDagAdjudicationGate({
    storyId: STORY_ID,
    items: [{ id: 'axis:implementation' }, { id: 'axis:classifier' }],
    adjudication: artifact,
    headSha: await gitHead(repo)
  });
  assert.equal(gate.status, 'failed');
  assert.ok(gate.judged_unsound_items.some((item) => item.item_id === 'axis:classifier'
    && item.reason.includes('real implementation gap')));
});

test('CPR-S-006 malformed correction lineage fails closed instead of selecting a convenient array entry', () => {
  const artifact = {
    story_id: STORY_ID,
    events: [
      {
        event_id: 'v1', type: 'verdict', item_id: 'axis:x', verdict: 'judged_unsound',
        unsound_cause: 'classifier_premise_unsound', reason: 'wrong premise',
        provenance: { agent_system: 'codex', agent_id: 'a' }, head_commit: 'h'
      },
      {
        event_id: 'c1', type: 'premise_correction', item_id: 'axis:x', corrects_verdict_id: 'missing',
        wrong_premise: 'x', corrected_premise: 'y', reason: 'proof',
        replacement_evidence: [{ artifact: 'docs/p.md', sha256: 'a'.repeat(64) }],
        provenance: { agent_system: 'codex', agent_id: 'op' }, head_commit: 'h'
      },
      {
        event_id: 'v2', type: 'verdict', item_id: 'axis:x', verdict: 'judged_sound',
        responds_to_correction_id: 'c1', reason: 'looks sound',
        provenance: { agent_system: 'codex', agent_id: 'b' }, head_commit: 'h'
      }
    ]
  };
  const gate = buildJudgmentDagAdjudicationGate({
    storyId: STORY_ID,
    items: [{ id: 'axis:x' }],
    adjudication: artifact,
    headSha: 'h'
  });
  assert.equal(gate.status, 'failed');
  assert.match(gate.reason, /history is invalid/);

  const malformedFields = {
    story_id: STORY_ID,
    events: [
      {
        type: 'verdict', item_id: 'axis:x', verdict: 'judged_unsound',
        unsound_cause: 'classifier_premise_unsound', reason: 'missing event id',
        provenance: null, head_commit: 'h'
      },
      {
        event_id: 'c2', type: 'premise_correction', item_id: 'axis:x', corrects_verdict_id: 'missing',
        wrong_premise: 'x', corrected_premise: 'y', reason: 'proof',
        replacement_evidence: [{ artifact: 'docs/p.md', sha256: 'a'.repeat(64) }],
        provenance: null, head_commit: 'h'
      },
      {
        event_id: 'v3', type: 'verdict', item_id: 'axis:x', verdict: 'judged_sound',
        responds_to_correction_id: 'c2', reason: 'looks sound', provenance: null, head_commit: 'h'
      }
    ]
  };
  const malformedGate = buildJudgmentDagAdjudicationGate({
    storyId: STORY_ID,
    items: [{ id: 'axis:x' }],
    adjudication: malformedFields,
    headSha: 'h'
  });
  assert.equal(malformedGate.status, 'failed');
  assert.match(malformedGate.reason, /history is invalid/);
});

async function gitHead(repo) {
  const { stdout } = await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: repo });
  return stdout.trim();
}
