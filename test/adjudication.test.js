import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

import {
  ADJUDICATION_VERDICTS,
  buildEvidenceAdjudicationGate,
  prepareAdjudication,
  readAdjudicationIfExists,
  recordAdjudication
} from '../src/adjudication.js';
import { preparePullRequest } from '../src/pr-manager.js';

const execFileAsync = promisify(execFile);

const STORY_ID = 'story-adjudication-fixture';

async function git(repo, args) {
  await execFileAsync('git', args, { cwd: repo });
}

async function makeRepo({ withStory = true, acceptanceCriteria = true } = {}) {
  const repo = await mkdtemp(path.join(os.tmpdir(), 'vibepro-adjudication-'));
  await git(repo, ['init', '-b', 'main']);
  await git(repo, ['config', 'user.email', 'test@example.com']);
  await git(repo, ['config', 'user.name', 'Test User']);
  await writeFile(path.join(repo, '.gitignore'), '.vibepro/\n');
  await writeFile(path.join(repo, 'README.md'), '# Fixture\n');
  await mkdir(path.join(repo, '.vibepro'), { recursive: true });
  await writeFile(path.join(repo, '.vibepro', 'config.json'), `${JSON.stringify({
    schema_version: '0.1.0',
    tool: 'vibepro',
    workspace: '.vibepro',
    brainbase: {
      stories: [{ story_id: STORY_ID, title: 'Adjudication fixture story', ssot: 'local', status: 'active' }],
      selected_story_id: STORY_ID
    }
  }, null, 2)}\n`, 'utf8');
  if (withStory) {
    await mkdir(path.join(repo, 'docs', 'management', 'stories', 'active'), { recursive: true });
    await writeFile(
      path.join(repo, 'docs', 'management', 'stories', 'active', `${STORY_ID}.md`),
      `---
story_id: ${STORY_ID}
title: Adjudication fixture story
status: active
---

# Story

Fixture story for evidence adjudication.

## 受け入れ基準

${acceptanceCriteria ? '- [ ] 初見のユーザーが責任範囲を区別できる\n- [ ] 検索から該当ページへ到達できる\n' : ''}
`,
      'utf8'
    );
  }
  return repo;
}

async function writeVerificationEvidence(repo) {
  const prDir = path.join(repo, '.vibepro', 'pr', STORY_ID);
  await mkdir(prDir, { recursive: true });
  await writeFile(path.join(prDir, 'verification-evidence.json'), `${JSON.stringify({
    schema_version: '0.1.0',
    story_id: STORY_ID,
    commands: [{
      kind: 'unit',
      status: 'pass',
      command: 'npm test',
      summary: '52 tests passed',
      observation: {
        targets: ['src/view.test.ts'],
        scenarios: ['responsibility labels render'],
        values: { tests: '52' }
      }
    }]
  }, null, 2)}\n`, 'utf8');
}

test('ADJ-S-001 adjudicate prepare generates request with clause texts, evidence, verdict vocabulary, and independence instructions', async () => {
  const repo = await makeRepo();
  await writeVerificationEvidence(repo);
  const result = await prepareAdjudication(repo, { storyId: STORY_ID });
  assert.equal(result.clause_count, 2);
  assert.equal(result.evidence_count, 1);
  const request = await readFile(path.join(repo, result.artifact), 'utf8');
  assert.match(request, /AC-1/);
  assert.match(request, /初見のユーザーが責任範囲を区別できる/);
  assert.match(request, /検索から該当ページへ到達できる/);
  assert.match(request, /npm test/);
  assert.match(request, /52 tests passed/);
  assert.match(request, /responsibility labels render/);
  for (const verdict of ADJUDICATION_VERDICTS) {
    assert.match(request, new RegExp(verdict));
  }
  assert.match(request, /独立したfresh contextの裁定者/);
  assert.match(request, /反証の立場/);
  assert.match(request, /vibepro adjudicate record/);
});

test('ADJ-S-002 adjudicate prepare fails explicitly when the story has no acceptance criteria', async () => {
  const repo = await makeRepo({ acceptanceCriteria: false });
  await assert.rejects(
    () => prepareAdjudication(repo, { storyId: STORY_ID }),
    /has no acceptance criteria/
  );
});

test('ADJ-S-003 adjudicate record validates verdict, reason, and provenance, and binds the current HEAD commit', async () => {
  const repo = await makeRepo();
  await git(repo, ['add', '.']);
  await git(repo, ['commit', '-m', 'chore: baseline']);
  const valid = {
    storyId: STORY_ID,
    clauseId: 'AC-1',
    verdict: 'demonstrated',
    reason: 'Evidence observation shows the outcome directly.',
    agentSystem: 'claude_code',
    agentId: 'adjudicator-1'
  };
  await assert.rejects(() => recordAdjudication(repo, { ...valid, verdict: 'pass' }), /--verdict must be one of/);
  await assert.rejects(() => recordAdjudication(repo, { ...valid, reason: '' }), /--reason/);
  await assert.rejects(() => recordAdjudication(repo, { ...valid, agentSystem: null }), /--agent-system/);
  await assert.rejects(() => recordAdjudication(repo, { ...valid, agentId: '' }), /--agent-id/);
  const result = await recordAdjudication(repo, valid);
  const { stdout } = await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: repo });
  assert.equal(result.entry.head_commit, stdout.trim());
  const stored = await readAdjudicationIfExists(repo, STORY_ID);
  assert.equal(stored.verdicts.length, 1);
  assert.equal(stored.verdicts[0].clause_id, 'AC-1');
  assert.equal(stored.verdicts[0].provenance.agent_system, 'claude_code');
});

test('ADJ-S-004 gate is needs_evidence when clauses lack fresh verdicts and lists missing clause ids', () => {
  const clauses = [{ id: 'AC-1', text: 'a' }, { id: 'AC-2', text: 'b' }];
  const gate = buildEvidenceAdjudicationGate({
    storyId: STORY_ID,
    acceptanceCriteria: clauses,
    adjudication: {
      verdicts: [
        { clause_id: 'AC-1', verdict: 'demonstrated', reason: 'ok', head_commit: 'head-1' },
        { clause_id: 'AC-2', verdict: 'demonstrated', reason: 'ok', head_commit: 'stale-head' }
      ]
    },
    headSha: 'head-1'
  });
  assert.equal(gate.status, 'needs_evidence');
  assert.equal(gate.required, true);
  assert.deepEqual(gate.missing_clauses, ['AC-2']);
  assert.match(gate.reason, /AC-2/);
});

test('ADJ-S-005 gate fails when any clause is judged not_demonstrated and carries the adjudicator reason', () => {
  const gate = buildEvidenceAdjudicationGate({
    storyId: STORY_ID,
    acceptanceCriteria: [{ id: 'AC-1', text: 'a' }],
    adjudication: {
      verdicts: [{ clause_id: 'AC-1', verdict: 'not_demonstrated', reason: 'string-existence test does not demonstrate the outcome', head_commit: 'head-1' }]
    },
    headSha: 'head-1'
  });
  assert.equal(gate.status, 'failed');
  assert.match(gate.reason, /string-existence test does not demonstrate the outcome/);
});

test('ADJ-S-006 not_verifiable_by_automation demands human verification and is closed only by an accepted decision with reason and artifact', () => {
  const clauses = [{ id: 'AC-1', text: 'a' }];
  const adjudication = {
    verdicts: [{ clause_id: 'AC-1', verdict: 'not_verifiable_by_automation', reason: 'human comprehension outcome', head_commit: 'head-1' }]
  };
  const open = buildEvidenceAdjudicationGate({
    storyId: STORY_ID,
    acceptanceCriteria: clauses,
    adjudication,
    headSha: 'head-1',
    decisions: [
      { source: 'gate:evidence_adjudication:AC-1', status: 'accepted', reason: null, artifact: 'x.png' },
      { source: 'gate:evidence_adjudication:AC-1', status: 'open', reason: 'observed', artifact: 'x.png' }
    ]
  });
  assert.equal(open.status, 'needs_evidence');
  assert.equal(open.human_verification_clauses.length, 1);
  assert.match(open.reason, /human verification/);
  const closed = buildEvidenceAdjudicationGate({
    storyId: STORY_ID,
    acceptanceCriteria: clauses,
    adjudication,
    headSha: 'head-1',
    decisions: [{ source: 'gate:evidence_adjudication:AC-1', status: 'accepted', reason: 'human walked the flow', artifact: 'evidence/manual.png' }]
  });
  assert.equal(closed.status, 'passed');
});

test('ADJ-S-007 gate passes when every clause has a fresh demonstrated verdict, and is explicit not_applicable without clauses', () => {
  const passed = buildEvidenceAdjudicationGate({
    storyId: STORY_ID,
    acceptanceCriteria: [{ id: 'AC-1', text: 'a' }],
    adjudication: { verdicts: [{ clause_id: 'AC-1', verdict: 'demonstrated', reason: 'ok', head_commit: 'head-1' }] },
    headSha: 'head-1'
  });
  assert.equal(passed.status, 'passed');
  const empty = buildEvidenceAdjudicationGate({ storyId: STORY_ID, acceptanceCriteria: [] });
  assert.equal(empty.status, 'not_applicable');
  assert.match(empty.reason, /not a pass/);
});

test('ADJ-S-008 pr prepare emits a required critical evidence_adjudication gate that blocks readiness until adjudicated', async () => {
  const repo = await makeRepo();
  await git(repo, ['add', '.']);
  await git(repo, ['commit', '-m', 'chore: baseline']);
  await git(repo, ['switch', '-c', 'feature/adjudication']);
  await writeFile(path.join(repo, 'README.md'), '# Fixture\n\nchange\n');
  await git(repo, ['add', 'README.md']);
  await git(repo, ['commit', '-m', 'feat: change']);

  const result = await preparePullRequest(repo, {
    storyId: STORY_ID,
    baseRef: 'main',
    branchName: 'feature/adjudication',
    evidenceDepth: 'summary'
  });
  const gateDag = result.preparation.pr_context.gate_dag;
  const gate = gateDag.nodes.find((node) => node.id === 'gate:evidence_adjudication');
  assert.ok(gate, 'evidence_adjudication gate should be emitted');
  assert.equal(gate.type, 'evidence_adjudication_gate');
  assert.equal(gate.required, true);
  assert.equal(gate.status, 'needs_evidence');
  assert.equal(gateDag.overall_status, 'needs_verification');
  const gateStatus = result.preparation.gate_status;
  assert.equal(gateStatus.ready_for_pr_create, false);
  assert.ok(
    gateStatus.unresolved_gates.some((item) => item.id === 'gate:evidence_adjudication'),
    'evidence_adjudication should count as an unresolved required gate'
  );
  assert.ok(
    result.preparation.pr_context.execution_gate.blocking_gates.some((item) => item.id === 'gate:evidence_adjudication'),
    'evidence_adjudication should be critical (not waivable by reason alone)'
  );
});

test('ADJ-S-009 pr prepare omits the gate when evidence_adjudication.enabled is false and does not crash without artifacts', async () => {
  const repo = await makeRepo();
  const configPath = path.join(repo, '.vibepro', 'config.json');
  const config = JSON.parse(await readFile(configPath, 'utf8'));
  config.evidence_adjudication = { enabled: false };
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
  await git(repo, ['add', '.']);
  await git(repo, ['commit', '-m', 'chore: baseline']);
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
  assert.equal(gateDag.nodes.find((node) => node.id === 'gate:evidence_adjudication'), undefined);
});
