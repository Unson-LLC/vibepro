import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, symlink, writeFile } from 'node:fs/promises';
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

async function runVibePro(args) {
  return execFileAsync('node', [CLI_PATH, ...args]);
}

async function seedClassifierCorrection(repo, { originalJudge = 'judge-original', operator = 'operator' } = {}) {
  await mkdir(path.join(repo, 'docs'), { recursive: true });
  await writeFile(path.join(repo, 'docs', 'premise-proof.md'), 'The compatibility output is unchanged.\n', 'utf8');
  await runVibePro([
    'adjudicate', 'record', repo,
    '--id', STORY_ID, '--judgment', '--item', 'axis:public_contract',
    '--verdict', 'judged_unsound', '--unsound-cause', 'classifier_premise_unsound',
    '--reason', 'classifier assumed the output changed',
    '--agent-system', 'codex', '--agent-id', originalJudge
  ]);
  let stored = JSON.parse(await readFile(path.join(repo, '.vibepro', 'adjudication', STORY_ID, 'judgment-adjudication.json'), 'utf8'));
  await runVibePro([
    'adjudicate', 'correct', repo,
    '--id', STORY_ID, '--judgment', '--item', 'axis:public_contract',
    '--original-verdict-id', stored.events[0].event_id,
    '--incorrect-premise', 'public output changed',
    '--corrected-premise', 'public output is unchanged',
    '--reason', 'the compatibility artifact proves the corrected premise',
    '--replacement-evidence', 'docs/premise-proof.md',
    '--agent-system', 'codex', '--agent-id', operator
  ]);
  stored = JSON.parse(await readFile(path.join(repo, '.vibepro', 'adjudication', STORY_ID, 'judgment-adjudication.json'), 'utf8'));
  return { stored, originalId: stored.events[0].event_id, correctionId: stored.events[1].event_id };
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
  const repo = await makeRepo();
  await mkdir(path.join(repo, 'docs'), { recursive: true });
  await writeFile(path.join(repo, 'docs', 'premise-proof.md'), 'The compatibility output is unchanged.\n', 'utf8');
  const initial = [
    CLI_PATH, 'adjudicate', 'record', repo,
    '--id', STORY_ID, '--judgment', '--item', 'axis:public_contract',
    '--verdict', 'judged_unsound', '--reason', 'classifier assumed the output changed',
    '--agent-system', 'codex', '--agent-id', 'judge-original'
  ];
  await assert.rejects(
    () => execFileAsync('node', initial),
    /--unsound-cause/,
    `story-vibepro-classifier-premise-recovery ac:1 ${acceptanceCriteria[0]}`
  );
  const unknownProvenance = [...initial, '--unsound-cause', 'classifier_premise_unsound'];
  unknownProvenance[unknownProvenance.indexOf('codex')] = 'other';
  await assert.rejects(
    () => execFileAsync('node', unknownProvenance),
    /--agent-system must be one of/,
    `story-vibepro-classifier-premise-recovery ac:1 ${acceptanceCriteria[0]}`
  );
  await execFileAsync('node', [...initial, '--unsound-cause', 'classifier_premise_unsound']);
  let stored = JSON.parse(await readFile(path.join(repo, '.vibepro', 'adjudication', STORY_ID, 'judgment-adjudication.json'), 'utf8'));
  const originalId = stored.events[0].event_id;
  let gate = buildJudgmentDagAdjudicationGate({
    storyId: STORY_ID,
    items: [{ id: 'axis:public_contract' }],
    adjudication: stored,
    headSha: await headOf(repo)
  });
  assert.equal(
    gate.status,
    'failed',
    `story-vibepro-classifier-premise-recovery ac:3 ${acceptanceCriteria[2]}`
  );

  const implementationRepo = await makeRepo();
  await runVibePro([
    'adjudicate', 'record', implementationRepo,
    '--id', STORY_ID, '--judgment', '--item', 'axis:public_contract',
    '--verdict', 'judged_unsound', '--unsound-cause', 'implementation_unsound',
    '--reason', 'the implementation breaks the public contract',
    '--agent-system', 'codex', '--agent-id', 'judge-implementation'
  ]);
  const implementationStored = JSON.parse(await readFile(
    path.join(implementationRepo, '.vibepro', 'adjudication', STORY_ID, 'judgment-adjudication.json'),
    'utf8'
  ));
  const implementationGate = buildJudgmentDagAdjudicationGate({
    storyId: STORY_ID,
    items: [{ id: 'axis:public_contract' }],
    adjudication: implementationStored,
    headSha: await headOf(implementationRepo),
    decisions: [{
      source: 'gate:judgment_dag_adjudication:axis:public_contract',
      status: 'accepted',
      reason: 'attempted critical waiver',
      artifact: 'README.md'
    }]
  });
  assert.equal(
    implementationGate.status,
    'failed',
    `story-vibepro-classifier-premise-recovery ac:2 ac:9 ${acceptanceCriteria[1]} ${acceptanceCriteria[8]}`
  );
  await assert.rejects(
    () => runVibePro([
      'adjudicate', 'correct', implementationRepo,
      '--id', STORY_ID, '--judgment', '--item', 'axis:public_contract',
      '--original-verdict-id', implementationStored.events[0].event_id,
      '--incorrect-premise', 'contract changed', '--corrected-premise', 'contract is unchanged',
      '--reason', 'a correction must not mask implementation failure',
      '--replacement-evidence', 'README.md',
      '--agent-system', 'codex', '--agent-id', 'operator'
    ]),
    /only classifier_premise_unsound verdicts may receive a premise correction/,
    `story-vibepro-classifier-premise-recovery ac:2 ${acceptanceCriteria[1]}`
  );

  const externalDir = await mkdtemp(path.join(os.tmpdir(), 'vibepro-cpr-e2e-external-'));
  const externalProof = path.join(externalDir, 'proof.md');
  await writeFile(externalProof, 'external proof must not be accepted\n', 'utf8');
  await symlink(externalProof, path.join(repo, 'docs', 'external-proof.md'));
  await assert.rejects(() => execFileAsync('node', [
    CLI_PATH, 'adjudicate', 'correct', repo,
    '--id', STORY_ID, '--judgment', '--item', 'axis:public_contract',
    '--original-verdict-id', originalId,
    '--incorrect-premise', 'public output changed',
    '--corrected-premise', 'public output is unchanged',
    '--reason', 'an external symlink must not establish the corrected premise',
    '--replacement-evidence', 'docs/external-proof.md',
    '--agent-system', 'codex', '--agent-id', 'operator'
  ]), /symbolic links are not accepted/, scenarioClauses[0]);

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
  assert.equal(
    stored.events[1].replacement_evidence.length,
    1,
    `story-vibepro-classifier-premise-recovery ac:4 SC-CPR-3 ${acceptanceCriteria[3]} ${scenarioClauses[0]}`
  );
  gate = buildJudgmentDagAdjudicationGate({
    storyId: STORY_ID,
    items: [{ id: 'axis:public_contract' }],
    adjudication: stored,
    headSha: await headOf(repo)
  });
  assert.equal(gate.status, 'needs_evidence', `story-vibepro-classifier-premise-recovery ac:5 ${acceptanceCriteria[4]}`);
  assert.deepEqual(gate.pending_correction_items, ['axis:public_contract']);
  const prepared = await prepareJudgmentAdjudication(repo, { storyId: STORY_ID });
  const request = await readFile(path.join(repo, prepared.artifact), 'utf8');
  assert.match(request, /implementation_unsound/);
  assert.match(request, /classifier_premise_unsound/);
  assert.match(request, new RegExp(correctionId));
  assert.match(request, /generic waiverや設定無効化で代替してはならない/);

  await assert.rejects(
    () => runVibePro([
      'adjudicate', 'record', repo,
      '--id', STORY_ID, '--judgment', '--item', 'axis:public_contract',
      '--correction-id', correctionId, '--verdict', 'judged_sound',
      '--reason', 'the original judge must not close its own premise correction',
      '--agent-system', 'codex', '--agent-id', 'judge-original'
    ]),
    /different independent judge/,
    `story-vibepro-classifier-premise-recovery ac:5 ${acceptanceCriteria[4]}`
  );

  const staleRepo = await makeRepo();
  const stale = await seedClassifierCorrection(staleRepo);
  await git(staleRepo, ['add', 'docs/premise-proof.md']);
  await git(staleRepo, ['commit', '-m', 'docs: advance head after correction']);
  await assert.rejects(
    () => runVibePro([
      'adjudicate', 'record', staleRepo,
      '--id', STORY_ID, '--judgment', '--item', 'axis:public_contract',
      '--correction-id', stale.correctionId, '--verdict', 'judged_sound',
      '--reason', 'a stale correction must not be re-adjudicated',
      '--agent-system', 'codex', '--agent-id', 'judge-fresh'
    ]),
    /does not reference a current-HEAD premise correction/,
    `story-vibepro-classifier-premise-recovery ac:5 ${acceptanceCriteria[4]}`
  );

  await execFileAsync('node', [
    CLI_PATH, 'adjudicate', 'record', repo,
    '--id', STORY_ID, '--judgment', '--item', 'axis:public_contract',
    '--correction-id', correctionId, '--verdict', 'judged_sound',
    '--reason', 'fresh review confirms the corrected premise and judgment',
    '--agent-system', 'codex', '--agent-id', 'judge-fresh'
  ]);
  stored = JSON.parse(await readFile(path.join(repo, '.vibepro', 'adjudication', STORY_ID, 'judgment-adjudication.json'), 'utf8'));
  assert.deepEqual(
    stored.events.map((event) => event.type),
    ['verdict', 'premise_correction', 'verdict'],
    `story-vibepro-classifier-premise-recovery ac:7 ${acceptanceCriteria[6]}`
  );
  assert.equal(stored.events[2].responds_to_correction_id, correctionId);
  gate = buildJudgmentDagAdjudicationGate({
    storyId: STORY_ID,
    items: [{ id: 'axis:public_contract' }],
    adjudication: stored,
    headSha: await headOf(repo)
  });
  assert.equal(
    gate.status,
    'passed',
    `story-vibepro-classifier-premise-recovery ac:6 SC-CPR-5 ${acceptanceCriteria[5]} ${scenarioClauses[1]}`
  );

  const unsoundRepo = await makeRepo();
  const unsound = await seedClassifierCorrection(unsoundRepo);
  await runVibePro([
    'adjudicate', 'record', unsoundRepo,
    '--id', STORY_ID, '--judgment', '--item', 'axis:public_contract',
    '--correction-id', unsound.correctionId, '--verdict', 'judged_unsound',
    '--unsound-cause', 'implementation_unsound',
    '--reason', 'fresh review found an actual implementation regression',
    '--agent-system', 'codex', '--agent-id', 'judge-unsound'
  ]);
  const unsoundStored = JSON.parse(await readFile(
    path.join(unsoundRepo, '.vibepro', 'adjudication', STORY_ID, 'judgment-adjudication.json'),
    'utf8'
  ));
  const unsoundGate = buildJudgmentDagAdjudicationGate({
    storyId: STORY_ID,
    items: [{ id: 'axis:public_contract' }],
    adjudication: unsoundStored,
    headSha: await headOf(unsoundRepo)
  });
  assert.equal(
    unsoundGate.status,
    'failed',
    `story-vibepro-classifier-premise-recovery ac:6 ${acceptanceCriteria[5]}`
  );
  assert.match(unsoundGate.reason, /actual implementation regression/);

  const humanRepo = await makeRepo();
  const human = await seedClassifierCorrection(humanRepo);
  await runVibePro([
    'adjudicate', 'record', humanRepo,
    '--id', STORY_ID, '--judgment', '--item', 'axis:public_contract',
    '--correction-id', human.correctionId, '--verdict', 'needs_human_judgment',
    '--reason', 'production observation requires a human decision',
    '--agent-system', 'codex', '--agent-id', 'judge-human'
  ]);
  const humanStored = JSON.parse(await readFile(
    path.join(humanRepo, '.vibepro', 'adjudication', STORY_ID, 'judgment-adjudication.json'),
    'utf8'
  ));
  const humanOpen = buildJudgmentDagAdjudicationGate({
    storyId: STORY_ID,
    items: [{ id: 'axis:public_contract' }],
    adjudication: humanStored,
    headSha: await headOf(humanRepo)
  });
  assert.equal(humanOpen.status, 'needs_evidence');
  const humanClosed = buildJudgmentDagAdjudicationGate({
    storyId: STORY_ID,
    items: [{ id: 'axis:public_contract' }],
    adjudication: humanStored,
    headSha: await headOf(humanRepo),
    decisions: [{
      source: 'gate:judgment_dag_adjudication:axis:public_contract',
      status: 'accepted',
      reason: 'operator confirmed the production behavior',
      artifact: 'README.md'
    }]
  });
  assert.equal(
    humanClosed.status,
    'passed',
    `story-vibepro-classifier-premise-recovery ac:6 ac:9 ${acceptanceCriteria[5]} ${acceptanceCriteria[8]}`
  );

  const legacyRepo = await makeRepo();
  const legacyDir = path.join(legacyRepo, '.vibepro', 'adjudication', STORY_ID);
  await mkdir(legacyDir, { recursive: true });
  await writeFile(path.join(legacyDir, 'judgment-adjudication.json'), `${JSON.stringify({
    schema_version: '0.1.0',
    model: 'vibepro-judgment-dag-adjudication-v1',
    story_id: STORY_ID,
    verdicts: [{
      item_id: 'axis:public_contract',
      verdict: 'judged_unsound',
      reason: 'legacy artifact omitted cause and provenance',
      head_commit: await headOf(legacyRepo)
    }]
  }, null, 2)}\n`, 'utf8');
  await runVibePro([
    'adjudicate', 'record', legacyRepo,
    '--id', STORY_ID, '--judgment', '--item', 'axis:secondary',
    '--verdict', 'judged_sound', '--reason', 'new event triggers safe migration',
    '--agent-system', 'codex', '--agent-id', 'judge-new'
  ]);
  const legacyStored = JSON.parse(await readFile(path.join(legacyDir, 'judgment-adjudication.json'), 'utf8'));
  const legacyGate = buildJudgmentDagAdjudicationGate({
    storyId: STORY_ID,
    items: [{ id: 'axis:public_contract' }, { id: 'axis:secondary' }],
    adjudication: legacyStored,
    headSha: await headOf(legacyRepo)
  });
  assert.equal(
    legacyGate.judged_unsound_items[0].unsound_cause,
    'implementation_unsound',
    `story-vibepro-classifier-premise-recovery ac:8 ${acceptanceCriteria[7]}`
  );
  assert.equal(legacyStored.events[0].legacy_origin.schema_version, '0.1.0');

  const projectRoot = path.resolve(path.dirname(CLI_PATH), '..');
  const [readmeEn, readmeJa] = await Promise.all([
    readFile(path.join(projectRoot, 'README.md'), 'utf8'),
    readFile(path.join(projectRoot, 'README.ja.md'), 'utf8')
  ]);
  assert.match(
    readmeEn,
    /adjudicate correct[\s\S]*generic waiver/i,
    `story-vibepro-classifier-premise-recovery ac:10 ${acceptanceCriteria[9]}`
  );
  assert.match(
    readmeJa,
    /adjudicate correct[\s\S]*generic waiver/,
    `story-vibepro-classifier-premise-recovery ac:10 ${acceptanceCriteria[9]}`
  );
});
