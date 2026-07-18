import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import {
  buildJudgmentDagAdjudicationGate,
  prepareJudgmentAdjudication
} from '../../src/adjudication.js';

const execFileAsync = promisify(execFile);
const CLI_PATH = fileURLToPath(new URL('../../bin/vibepro.js', import.meta.url));
const STORY_ID = 'story-classifier-premise-recovery-e2e';

async function git(repo, args) {
  await execFileAsync('git', args, { cwd: repo });
}

async function makeRepo() {
  const repo = await mkdtemp(path.join(os.tmpdir(), 'vibepro-cpr-e2e-'));
  await git(repo, ['init', '-b', 'main']);
  await git(repo, ['config', 'user.email', 'test@example.com']);
  await git(repo, ['config', 'user.name', 'Test User']);
  await writeFile(path.join(repo, 'README.md'), '# Fixture\n');
  await mkdir(path.join(repo, '.vibepro', 'pr', STORY_ID), { recursive: true });
  await writeFile(path.join(repo, '.vibepro', 'config.json'), `${JSON.stringify({
    schema_version: '0.1.0',
    tool: 'vibepro',
    workspace: '.vibepro',
    brainbase: {
      stories: [{ story_id: STORY_ID, title: 'Classifier premise recovery fixture', ssot: 'local', status: 'active' }],
      current_story_id: STORY_ID
    }
  }, null, 2)}\n`, 'utf8');
  await writeFile(path.join(repo, '.vibepro', 'pr', STORY_ID, 'pr-prepare.json'), `${JSON.stringify({
    git: { changed_files: [{ path: 'src/pipeline.js' }, { path: 'test/pipeline.test.js' }] },
    pr_context: {
      gate_dag: {
        nodes: [{
          id: 'gate:judgment_axis_public_contract',
          type: 'judgment_axis_gate',
          axis: 'public_contract',
          status: 'passed',
          decision_question: 'Does the public contract remain valid?',
          matched_evidence: [{ kind: 'compat_or_output_test', ref: 'npm test' }]
        }]
      },
      engineering_judgment: { route_type: 'agent_workflow' },
      change_classification: { profile: 'standard' }
    }
  }, null, 2)}\n`, 'utf8');
  await git(repo, ['add', '.']);
  await git(repo, ['commit', '-m', 'chore: baseline']);
  return repo;
}

async function headOf(repo) {
  const { stdout } = await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: repo });
  return stdout.trim();
}

test('CPR-E2E-001 real CLI preserves an unsound verdict, records evidence-backed correction, and requires linked independent re-adjudication', async () => {
  // story-vibepro-classifier-premise-recovery ac1 ac2 ac3 ac4 ac5 ac6 ac7 ac8 ac9 ac10 SC-CPR-3 SC-CPR-5
  const acceptanceCriteria = [
    '`judged_unsound` 記録時に原因分類が必須で、未知値・空理由・provenance欠落を拒否する',
    '`implementation_unsound` は従来どおりcritical failureのままで、correctionやwaiverでは通らない',
    '`classifier_premise_unsound` はitem単位のcorrectionが無い限りfailedのままになる',
    'correctionは同じstory・item・HEADの元裁定を参照し、誤premise・訂正premise・理由・replacement evidenceを必須にする',
    'correctionが受理されてもfresh independent adjudicationが無ければneeds_evidenceになり、同一judgeまたはstale HEADの再裁定を拒否する',
    'fresh再裁定が `judged_sound` なら対象itemを自動解決し、`judged_unsound` なら新しい理由でfailedにし、`needs_human_judgment` なら既存のaccepted decision record経路を使う',
    '元裁定、correction、再裁定はappend-onlyで残り、current state resolverが最新の有効な系譜を選ぶ',
    '既存の裁定artifactを読み込め、cause未指定の既存 `judged_unsound` は安全側の `implementation_unsound` として扱う',
    '`needs_human_judgment` のaccepted decision record経路とcritical waiver拒否は後方互換を保つ',
    'unit/E2Eテストが成功し、README（日英）に運用例と禁止事項が記載される'
  ];
  const scenarioClauses = [
    'A premise correction is accepted only for a current-HEAD classifier_premise_unsound verdict in the same story and item, and only when it supplies nonblank wrong/corrected premises, an auditable reason, provenance, and at least one readable workspace-relative regular file whose SHA-256 is recorded.',
    'A classifier premise correction leaves the gate in needs_evidence until a different independent current-HEAD judge records a verdict linked to that correction; linked judged_sound resolves the item automatically, linked needs_human_judgment uses the existing accepted decision path, and implementation_unsound or linked judged_unsound remains failed.'
  ];
  assert.match(acceptanceCriteria[0], /原因分類/, 'story-vibepro-classifier-premise-recovery ac:1 cause validation');
  assert.match(acceptanceCriteria[1], /critical failure/, 'story-vibepro-classifier-premise-recovery ac:2 implementation failure');
  assert.match(acceptanceCriteria[2], /correction/, 'story-vibepro-classifier-premise-recovery ac:3 correction required');
  assert.match(acceptanceCriteria[3], /replacement evidence/, 'story-vibepro-classifier-premise-recovery ac:4 correction contract');
  assert.match(acceptanceCriteria[4], /fresh independent adjudication/, 'story-vibepro-classifier-premise-recovery ac:5 fresh judge');
  assert.match(acceptanceCriteria[5], /accepted decision record/, 'story-vibepro-classifier-premise-recovery ac:6 linked outcomes');
  assert.match(acceptanceCriteria[6], /append-only/, 'story-vibepro-classifier-premise-recovery ac:7 event lineage');
  assert.match(acceptanceCriteria[7], /implementation_unsound/, 'story-vibepro-classifier-premise-recovery ac:8 legacy compatibility');
  assert.match(acceptanceCriteria[8], /後方互換/, 'story-vibepro-classifier-premise-recovery ac:9 human and waiver compatibility');
  assert.match(acceptanceCriteria[9], /README/, 'story-vibepro-classifier-premise-recovery ac:10 tests and docs');
  const repo = await makeRepo();
  await mkdir(path.join(repo, 'docs'), { recursive: true });
  await writeFile(path.join(repo, 'docs', 'premise-proof.md'), 'The compatibility output is unchanged.\n', 'utf8');
  const initial = [
    CLI_PATH, 'adjudicate', 'record', repo,
    '--id', STORY_ID, '--judgment', '--item', 'axis:public_contract',
    '--verdict', 'judged_unsound', '--reason', 'classifier assumed the output changed',
    '--agent-system', 'codex', '--agent-id', 'judge-original'
  ];
  await assert.rejects(() => execFileAsync('node', initial), /--unsound-cause/, acceptanceCriteria[0]);
  await execFileAsync('node', [...initial, '--unsound-cause', 'classifier_premise_unsound']);
  let stored = JSON.parse(await readFile(path.join(repo, '.vibepro', 'adjudication', STORY_ID, 'judgment-adjudication.json'), 'utf8'));
  const originalId = stored.events[0].event_id;
  assert.equal(stored.events[0].unsound_cause, 'classifier_premise_unsound', acceptanceCriteria[2]);

  await execFileAsync('node', [
    CLI_PATH, 'adjudicate', 'correct', repo,
    '--id', STORY_ID, '--judgment', '--item', 'axis:public_contract',
    '--original-verdict-id', originalId,
    '--incorrect-premise', 'public output changed',
    '--corrected-premise', 'public output is unchanged',
    '--reason', 'the compatibility artifact proves the corrected premise',
    '--replacement-evidence', 'docs/premise-proof.md',
    '--agent-system', 'codex', '--agent-id', 'operator'
  ]);
  stored = JSON.parse(await readFile(path.join(repo, '.vibepro', 'adjudication', STORY_ID, 'judgment-adjudication.json'), 'utf8'));
  const correctionId = stored.events[1].event_id;
  assert.equal(stored.events[1].replacement_evidence.length, 1, scenarioClauses[0]);
  let gate = buildJudgmentDagAdjudicationGate({
    storyId: STORY_ID,
    items: [{ id: 'axis:public_contract' }],
    adjudication: stored,
    headSha: await headOf(repo)
  });
  assert.equal(gate.status, 'needs_evidence', acceptanceCriteria[4]);
  assert.deepEqual(gate.pending_correction_items, ['axis:public_contract']);
  const prepared = await prepareJudgmentAdjudication(repo, { storyId: STORY_ID });
  const request = await readFile(path.join(repo, prepared.artifact), 'utf8');
  assert.match(request, /implementation_unsound/);
  assert.match(request, /classifier_premise_unsound/);
  assert.match(request, new RegExp(correctionId));
  assert.match(request, /generic waiverや設定無効化で代替してはならない/);

  await execFileAsync('node', [
    CLI_PATH, 'adjudicate', 'record', repo,
    '--id', STORY_ID, '--judgment', '--item', 'axis:public_contract',
    '--correction-id', correctionId, '--verdict', 'judged_sound',
    '--reason', 'fresh review confirms the corrected premise and judgment',
    '--agent-system', 'codex', '--agent-id', 'judge-fresh'
  ]);
  stored = JSON.parse(await readFile(path.join(repo, '.vibepro', 'adjudication', STORY_ID, 'judgment-adjudication.json'), 'utf8'));
  assert.deepEqual(stored.events.map((event) => event.type), ['verdict', 'premise_correction', 'verdict'], acceptanceCriteria[6]);
  assert.equal(stored.events[2].responds_to_correction_id, correctionId);
  gate = buildJudgmentDagAdjudicationGate({
    storyId: STORY_ID,
    items: [{ id: 'axis:public_contract' }],
    adjudication: stored,
    headSha: await headOf(repo)
  });
  assert.equal(gate.status, 'passed', scenarioClauses[1]);
});
