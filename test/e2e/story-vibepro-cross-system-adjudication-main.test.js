import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import {
  readImplementationProvenanceIfExists,
  recordImplementationProvenance,
  recordJudgmentAdjudication,
  recordPremiseCorrection,
  sameSystemLogPath
} from '../../src/adjudication.js';

const execFileAsync = promisify(execFile);
const CLI_PATH = fileURLToPath(new URL('../../bin/vibepro.js', import.meta.url));
const STORY_ID = 'story-csa-e2e';

async function git(repo, args) {
  await execFileAsync('git', args, { cwd: repo });
}

async function makeRepo() {
  const repo = await mkdtemp(path.join(os.tmpdir(), 'vibepro-csa-e2e-'));
  await git(repo, ['init', '-b', 'main']);
  await git(repo, ['config', 'user.email', 'test@example.com']);
  await git(repo, ['config', 'user.name', 'Test User']);
  await writeFile(path.join(repo, 'README.md'), '# Fixture\n');
  await mkdir(path.join(repo, '.vibepro'), { recursive: true });
  await writeFile(path.join(repo, '.vibepro', 'config.json'), `${JSON.stringify({
    schema_version: '0.1.0',
    tool: 'vibepro',
    workspace: '.vibepro',
    brainbase: {
      stories: [{ story_id: STORY_ID, title: 'Cross-system adjudication e2e fixture', ssot: 'local', status: 'active' }],
      current_story_id: STORY_ID
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

// story-vibepro-cross-system-adjudication ac:1 provenance records the implementer's agent system, rejecting unknown systems before any write
test('CSA-E2E-001 story-vibepro-cross-system-adjudication ac:1 [S-001] adjudicate provenance records implementation-provenance.json with recorded_at and head commit, rejecting unknown agent systems before any write', async () => {
  const repo = await makeRepo();
  await assert.rejects(
    () => execFileAsync('node', [CLI_PATH, 'adjudicate', 'provenance', repo, '--id', STORY_ID, '--agent-system', 'gpt5']),
    /ADJUDICATION_AGENT_SYSTEMS must be one of|--agent-system must be one of/
  );
  assert.equal(
    await readImplementationProvenanceIfExists(repo, STORY_ID),
    null,
    'ac:1 an agent system outside ADJUDICATION_AGENT_SYSTEMS must be rejected before any write'
  );
  await execFileAsync('node', [
    CLI_PATH, 'adjudicate', 'provenance', repo,
    '--id', STORY_ID, '--agent-system', 'claude_code', '--agent-id', 'impl-e2e'
  ]);
  const stored = JSON.parse(await readFile(
    path.join(repo, '.vibepro', 'adjudication', STORY_ID, 'implementation-provenance.json'),
    'utf8'
  ));
  assert.equal(stored.provenance.agent_system, 'claude_code');
  assert.ok(stored.recorded_at, 'ac:1 recorded_at must be present');
  assert.equal(stored.head_commit, await headOf(repo), 'ac:1 head commit must be recorded');
});

// story-vibepro-cross-system-adjudication ac:2 evidence-path record carries a same_system warning naming both systems and is never blocked
test('CSA-E2E-002 story-vibepro-cross-system-adjudication ac:2 [S-002] evidence-adjudication record with the same --agent-system as implementation provenance carries a same_system warning and is not blocked', async () => {
  const repo = await makeRepo();
  await recordImplementationProvenance(repo, { storyId: STORY_ID, agentSystem: 'claude_code', agentId: 'impl-e2e' });
  const storiesDir = path.join(repo, 'docs', 'management', 'stories', 'active');
  await mkdir(storiesDir, { recursive: true });
  await writeFile(
    path.join(storiesDir, `${STORY_ID}.md`),
    ['---', `story_id: ${STORY_ID}`, 'title: "Cross-system adjudication e2e"', 'status: active', '---', '', '# Cross-system adjudication e2e', '', '## 受け入れ基準', '', '- [ ] 初見のユーザーが機能を使える', ''].join('\n'),
    'utf8'
  );
  await git(repo, ['add', '.']);
  await git(repo, ['commit', '-m', 'docs: add story']);
  const { stdout } = await execFileAsync('node', [
    CLI_PATH, 'adjudicate', 'record', repo,
    '--id', STORY_ID, '--clause', 'AC-1', '--verdict', 'demonstrated',
    '--reason', 'Evidence observation shows the outcome directly.',
    '--agent-system', 'claude_code', '--agent-id', 'adjudicator-e2e', '--json'
  ]);
  const result = JSON.parse(stdout);
  assert.equal(result.warnings.length, 1, 'ac:2 the verdict is not blocked; recording must still succeed with a warning');
  assert.equal(result.warnings[0].id, 'same_system');
  assert.match(result.warnings[0].reason, /claude_code/, 'ac:2 warning must name both systems');
  assert.equal(result.entry.clause_id, 'AC-1', 'ac:2 verdict recording is not blocked on the evidence path');
});

// story-vibepro-cross-system-adjudication ac:3 judgment-DAG path rejects same-system before persistence unless --allow-same-system is given; override reason lands in the append-only log and the persisted event
test('CSA-E2E-003 story-vibepro-cross-system-adjudication ac:3 [S-003] judgment-DAG record/correct reject a same-system agent-system before persistence unless --allow-same-system is provided, and the override reason is appended to the append-only log and stored on the event', async () => {
  const repo = await makeRepo();
  await recordImplementationProvenance(repo, { storyId: STORY_ID, agentSystem: 'claude_code', agentId: 'impl-e2e' });
  const base = [
    CLI_PATH, 'adjudicate', 'record', repo,
    '--id', STORY_ID, '--judgment', '--item', 'axis:public_contract',
    '--verdict', 'judged_sound', '--reason', '互換テストが旧出力との差分を検証している',
    '--agent-system', 'claude_code', '--agent-id', 'judge-e2e'
  ];
  await assert.rejects(
    () => execFileAsync('node', base),
    /requires a cross-system adjudicator/,
    'ac:3 rejected before persistence unless --allow-same-system is provided'
  );
  const artifactPath = path.join(repo, '.vibepro', 'adjudication', STORY_ID, 'judgment-adjudication.json');
  await assert.rejects(() => readFile(artifactPath, 'utf8'), /ENOENT/, 'ac:3 rejection must not persist anything');

  await execFileAsync('node', [...base, '--allow-same-system', 'single-system CI environment']);
  const stored = JSON.parse(await readFile(artifactPath, 'utf8'));
  assert.equal(stored.events.length, 1);
  assert.equal(
    stored.events[0].provenance.same_system_override.reason,
    'single-system CI environment',
    'ac:3 the granted override reason must be stored on the persisted event provenance'
  );
  const logRaw = await readFile(sameSystemLogPath(repo, STORY_ID), 'utf8');
  const logLines = logRaw.trim().split('\n');
  assert.equal(logLines.length, 1, 'ac:3 append-only log');
  assert.equal(JSON.parse(logLines[0]).reason, 'single-system CI environment', 'ac:3 the override reason must be appended to the append-only log');
});

// story-vibepro-cross-system-adjudication ac:4 accepted decision record with source gate:judgment_dag_adjudication:same_system_environment downgrades rejection to a warning
test('CSA-E2E-004 story-vibepro-cross-system-adjudication ac:4 [S-004] an accepted decision record with source gate:judgment_dag_adjudication:same_system_environment (non-empty reason and artifact) downgrades judgment-DAG same-system rejection to a warning', async () => {
  const repo = await makeRepo();
  await recordImplementationProvenance(repo, { storyId: STORY_ID, agentSystem: 'claude_code', agentId: 'impl-e2e' });
  const decisionRecordsPath = path.join(repo, '.vibepro', 'pr', STORY_ID, 'decision-records.json');
  await mkdir(path.dirname(decisionRecordsPath), { recursive: true });
  await writeFile(decisionRecordsPath, `${JSON.stringify({
    schema_version: '0.1.0',
    model: 'vibepro-decision-records-v1',
    story_id: STORY_ID,
    decisions: [{
      decision_id: 'decision-csa-env-1',
      story_id: STORY_ID,
      type: 'waiver',
      status: 'accepted',
      source: 'gate:judgment_dag_adjudication:same_system_environment',
      reason: 'this environment only runs one agent system',
      artifact: 'docs/decisions/csa-environment.md'
    }]
  }, null, 2)}\n`, 'utf8');
  const result = await recordJudgmentAdjudication(repo, {
    storyId: STORY_ID,
    itemId: 'axis:public_contract',
    verdict: 'judged_sound',
    reason: '互換テストが旧出力との差分を検証している',
    agentSystem: 'claude_code',
    agentId: 'judge-e2e'
  });
  assert.equal(result.warnings.length, 1, 'ac:4 a single-system environment closes through a recorded decision, not an implicit pass');
  assert.equal(result.warnings[0].id, 'same_system');
  assert.match(result.warnings[0].reason, /decision-csa-env-1/, 'ac:4 the downgrade must reference the accepted decision record');
});

// story-vibepro-cross-system-adjudication ac:5 no provenance recorded emits provenance_missing warning and behaves exactly as before; cross-system with provenance produces no warning and no override requirement
test('CSA-E2E-005 story-vibepro-cross-system-adjudication ac:5 [S-005] no recorded implementation provenance emits a provenance_missing warning and otherwise behaves exactly as before this story; a cross-system adjudicator with provenance recorded produces no same-system warning and no override requirement', async () => {
  const repoNoProvenance = await makeRepo();
  const noProvenanceResult = await recordJudgmentAdjudication(repoNoProvenance, {
    storyId: STORY_ID,
    itemId: 'axis:public_contract',
    verdict: 'judged_sound',
    reason: '互換テストが旧出力との差分を検証している',
    agentSystem: 'claude_code',
    agentId: 'judge-e2e'
  });
  assert.equal(noProvenanceResult.warnings.length, 1);
  assert.equal(noProvenanceResult.warnings[0].id, 'provenance_missing', 'ac:5 no provenance recorded must emit a provenance_missing warning');
  assert.equal(noProvenanceResult.entry.verdict, 'judged_sound', 'ac:5 recording must otherwise behave exactly as before this story');

  const repoCrossSystem = await makeRepo();
  await recordImplementationProvenance(repoCrossSystem, { storyId: STORY_ID, agentSystem: 'codex', agentId: 'impl-e2e' });
  const crossSystemResult = await recordJudgmentAdjudication(repoCrossSystem, {
    storyId: STORY_ID,
    itemId: 'axis:public_contract',
    verdict: 'judged_sound',
    reason: '互換テストが旧出力との差分を検証している',
    agentSystem: 'claude_code',
    agentId: 'judge-e2e'
  });
  assert.deepEqual(crossSystemResult.warnings, [], 'ac:5 a cross-system adjudicator with provenance recorded produces no same-system warning');
  assert.equal(crossSystemResult.entry.provenance.same_system_override, undefined, 'ac:5 a cross-system adjudicator needs no override');
});

// story-vibepro-cross-system-adjudication ac:6 the existing same-judge-identity rejection for premise-correction re-adjudication is preserved unchanged
test('CSA-E2E-006 story-vibepro-cross-system-adjudication ac:6 [S-006] the existing same-judge-identity rejection for premise-correction re-adjudication is preserved unchanged alongside the new system-level check', async () => {
  const repo = await makeRepo();
  await recordImplementationProvenance(repo, { storyId: STORY_ID, agentSystem: 'codex', agentId: 'impl-e2e' });
  const evidencePath = path.join(repo, 'docs', 'premise-proof-csa-e2e.md');
  await mkdir(path.dirname(evidencePath), { recursive: true });
  await writeFile(evidencePath, '# Replacement evidence\n\nThe public output is unchanged.\n', 'utf8');
  const original = await recordJudgmentAdjudication(repo, {
    storyId: STORY_ID,
    itemId: 'axis:public_contract',
    verdict: 'judged_unsound',
    unsoundCause: 'classifier_premise_unsound',
    reason: 'classifier assumed a public output change',
    agentSystem: 'claude_code',
    agentId: 'judge-original-e2e'
  });
  const correction = await recordPremiseCorrection(repo, {
    storyId: STORY_ID,
    itemId: 'axis:public_contract',
    originalVerdictId: original.entry.event_id,
    incorrectPremise: 'public output changed',
    correctedPremise: 'public output is unchanged',
    reason: 'diff and compatibility fixture prove the corrected premise',
    replacementEvidence: ['docs/premise-proof-csa-e2e.md'],
    agentSystem: 'claude_code',
    agentId: 'operator-e2e'
  });
  await assert.rejects(() => recordJudgmentAdjudication(repo, {
    storyId: STORY_ID,
    itemId: 'axis:public_contract',
    correctionId: correction.entry.event_id,
    verdict: 'judged_sound',
    reason: 'same judge cannot independently re-adjudicate',
    agentSystem: 'claude_code',
    agentId: 'judge-original-e2e'
  }), /different independent judge/, 'ac:6 same-judge-identity rejection for premise-correction re-adjudication must remain in force');
  const reAdjudicated = await recordJudgmentAdjudication(repo, {
    storyId: STORY_ID,
    itemId: 'axis:public_contract',
    correctionId: correction.entry.event_id,
    verdict: 'judged_sound',
    reason: 'replacement evidence proves the corrected premise and the item now holds',
    agentSystem: 'claude_code',
    agentId: 'judge-fresh-e2e'
  });
  assert.equal(reAdjudicated.entry.verdict, 'judged_sound', 'ac:6 a genuinely different judge can still re-adjudicate');
});
