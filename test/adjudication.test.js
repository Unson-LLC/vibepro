import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
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
  recordAdjudication,
  summarizeAdjudicationForPr
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

test('ADJ-S-005 gate fails closed when a current-head verdict uses an unknown vocabulary value', () => {
  const gate = buildEvidenceAdjudicationGate({
    storyId: STORY_ID,
    acceptanceCriteria: [{ id: 'AC-1', text: 'a' }],
    adjudication: {
      verdicts: [{ clause_id: 'AC-1', verdict: 'totally_invalid', reason: 'corrupt artifact', head_commit: 'head-1' }]
    },
    headSha: 'head-1'
  });
  assert.equal(gate.status, 'failed');
  assert.deepEqual(gate.invalid_verdicts, [{ clause_id: 'AC-1', verdict: 'totally_invalid' }]);
  assert.match(gate.reason, /unknown adjudication verdict/);
  assert.doesNotMatch(gate.reason, /All 1 acceptance criteria/);
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

test('ADJ-S-011 task-scoped verdicts cannot be reused by a different task on the same HEAD', () => {
  const taskA = {
    source: 'task',
    story_id: STORY_ID,
    task_id: 'TASK-A',
    acceptance_criteria: ['Task A outcome']
  };
  const taskB = {
    source: 'task',
    story_id: STORY_ID,
    task_id: 'TASK-B',
    acceptance_criteria: ['Task B outcome']
  };
  const adjudication = {
    verdicts: [{
      clause_id: 'ac:1',
      verdict: 'demonstrated',
      reason: 'Task A evidence demonstrates Task A only.',
      head_commit: 'head-1',
      acceptance_scope: taskA
    }]
  };

  const taskAGate = buildEvidenceAdjudicationGate({
    storyId: STORY_ID,
    acceptanceCriteria: [{ id: 'ac:1', text: 'Task A outcome' }],
    acceptanceScope: taskA,
    adjudication,
    headSha: 'head-1'
  });
  assert.equal(taskAGate.status, 'passed');

  const taskBGate = buildEvidenceAdjudicationGate({
    storyId: STORY_ID,
    acceptanceCriteria: [{ id: 'ac:1', text: 'Task B outcome' }],
    acceptanceScope: taskB,
    adjudication,
    headSha: 'head-1'
  });
  assert.equal(taskBGate.status, 'needs_evidence');
  assert.deepEqual(taskBGate.missing_clauses, ['ac:1']);

  const taskAFingerprint = createHash('sha256')
    .update(JSON.stringify(taskA))
    .digest('hex');
  const humanAdjudication = {
    verdicts: [{
      clause_id: 'ac:1',
      verdict: 'not_verifiable_by_automation',
      reason: 'Task A requires a human observation.',
      head_commit: 'head-1',
      acceptance_scope: taskA
    }]
  };
  const unscopedClosure = buildEvidenceAdjudicationGate({
    storyId: STORY_ID,
    acceptanceCriteria: [{ id: 'ac:1', text: 'Task A outcome' }],
    acceptanceScope: taskA,
    adjudication: humanAdjudication,
    headSha: 'head-1',
    decisions: [{
      source: 'gate:evidence_adjudication:ac:1',
      status: 'accepted',
      reason: 'Unscoped observation.',
      artifact: 'evidence/unscoped.png'
    }]
  });
  assert.equal(unscopedClosure.status, 'needs_evidence');

  const scopedClosure = buildEvidenceAdjudicationGate({
    storyId: STORY_ID,
    acceptanceCriteria: [{ id: 'ac:1', text: 'Task A outcome' }],
    acceptanceScope: taskA,
    adjudication: humanAdjudication,
    headSha: 'head-1',
    decisions: [{
      source: `gate:evidence_adjudication:${taskAFingerprint}:ac:1`,
      status: 'accepted',
      reason: 'Task A scope was observed.',
      artifact: 'evidence/task-a.png',
      git_context: { head_sha: 'head-1' }
    }]
  });
  assert.equal(scopedClosure.status, 'passed');

  const staleScopedClosure = buildEvidenceAdjudicationGate({
    storyId: STORY_ID,
    acceptanceCriteria: [{ id: 'ac:1', text: 'Task A outcome' }],
    acceptanceScope: taskA,
    adjudication: humanAdjudication,
    headSha: 'head-1',
    decisions: [{
      source: `gate:evidence_adjudication:${taskAFingerprint}:ac:1`,
      status: 'accepted',
      reason: 'Task A was observed on an older implementation.',
      artifact: 'evidence/task-a-old-head.png',
      git_context: { head_sha: 'old-head' }
    }]
  });
  assert.equal(staleScopedClosure.status, 'needs_evidence');
});

test('ADJ-S-014 contradictory stored scope and fingerprint fail closed for the gate and PR summary', () => {
  const taskA = {
    source: 'task',
    story_id: STORY_ID,
    task_id: 'TASK-A',
    acceptance_criteria: ['Task A outcome']
  };
  const taskB = {
    source: 'task',
    story_id: STORY_ID,
    task_id: 'TASK-B',
    acceptance_criteria: ['Task B outcome']
  };
  const taskBFingerprint = createHash('sha256')
    .update(JSON.stringify(taskB))
    .digest('hex');
  const adjudication = {
    verdicts: [{
      clause_id: 'ac:1',
      verdict: 'demonstrated',
      reason: 'The embedded scope and claimed fingerprint contradict each other.',
      head_commit: 'head-1',
      acceptance_scope: taskA,
      acceptance_scope_fingerprint: taskBFingerprint
    }]
  };

  const gate = buildEvidenceAdjudicationGate({
    storyId: STORY_ID,
    acceptanceCriteria: [{ id: 'ac:1', text: 'Task B outcome' }],
    acceptanceScope: taskB,
    adjudication,
    headSha: 'head-1'
  });
  assert.equal(gate.status, 'needs_evidence');
  assert.deepEqual(gate.missing_clauses, ['ac:1']);

  const summary = summarizeAdjudicationForPr({
    storyId: STORY_ID,
    acceptanceCriteria: [{ id: 'ac:1', text: 'Task B outcome' }],
    acceptanceScope: taskB,
    adjudication,
    headSha: 'head-1'
  });
  assert.equal(summary.fresh_verdict_count, 0);
  assert.equal(summary.demonstrated_count, 0);
});

test('ADJ-S-015 invalid acceptance scope sources fail closed instead of falling back to Story scope', async () => {
  const invalidScope = {
    source: 'tasks',
    story_id: STORY_ID,
    task_id: 'TASK-A',
    acceptance_criteria: ['Task A outcome']
  };
  const missingSourceScope = {
    story_id: STORY_ID,
    task_id: 'TASK-A',
    acceptance_criteria: ['Task A outcome']
  };
  for (const [scope, expectedError] of [
    [invalidScope, /Invalid adjudication acceptance scope source "tasks"/],
    [missingSourceScope, /Invalid adjudication acceptance scope: source is required/],
    [{ ...missingSourceScope, source: null }, /Invalid adjudication acceptance scope: source is required/]
  ]) {
    assert.throws(
      () => buildEvidenceAdjudicationGate({
        storyId: STORY_ID,
        acceptanceCriteria: [{ id: 'ac:1', text: 'Task A outcome' }],
        acceptanceScope: scope,
        adjudication: {
          verdicts: [{
            clause_id: 'ac:1',
            verdict: 'demonstrated',
            reason: 'A legacy unscoped verdict must not pass an invalid Task scope.',
            head_commit: 'head-1'
          }]
        },
        headSha: 'head-1'
      }),
      expectedError
    );
  }

  const repo = await makeRepo();
  const prDir = path.join(repo, '.vibepro', 'pr', STORY_ID);
  await mkdir(prDir, { recursive: true });
  for (const [scope, expectedError] of [
    [invalidScope, /Invalid adjudication acceptance scope source "tasks"/],
    [missingSourceScope, /Invalid adjudication acceptance scope: source is required/]
  ]) {
    await writeFile(path.join(prDir, 'pr-prepare.json'), `${JSON.stringify({
      pr_context: { acceptance_scope: scope }
    }, null, 2)}\n`);
    await assert.rejects(
      () => prepareAdjudication(repo, { storyId: STORY_ID }),
      expectedError
    );
  }
});

test('ADJ-S-016 present malformed acceptance scopes never use the legacy Story fallback', async () => {
  const repo = await makeRepo();
  const prDir = path.join(repo, '.vibepro', 'pr', STORY_ID);
  await mkdir(prDir, { recursive: true });

  for (const scope of [null, false, 0, '']) {
    await writeFile(path.join(prDir, 'pr-prepare.json'), `${JSON.stringify({
      pr_context: { acceptance_scope: scope }
    }, null, 2)}\n`);
    await assert.rejects(
      () => prepareAdjudication(repo, { storyId: STORY_ID }),
      /Invalid adjudication acceptance scope/
    );
  }

  const gate = buildEvidenceAdjudicationGate({
    storyId: STORY_ID,
    acceptanceCriteria: [{ id: 'ac:1', text: 'Story outcome' }],
    acceptanceScope: null,
    adjudication: {
      verdicts: [{
        clause_id: 'ac:1',
        verdict: 'demonstrated',
        reason: 'A present malformed scope must not be accepted as legacy unscoped evidence.',
        head_commit: 'head-1',
        acceptance_scope: null
      }]
    },
    headSha: 'head-1'
  });
  assert.equal(gate.status, 'needs_evidence');
  assert.deepEqual(gate.missing_clauses, ['ac:1']);
});

test('ADJ-S-017 present partial acceptance scopes fail closed while an absent scope retains the legacy Story fallback', async () => {
  const repo = await makeRepo();
  const prDir = path.join(repo, '.vibepro', 'pr', STORY_ID);
  await mkdir(prDir, { recursive: true });

  for (const [scope, expectedError] of [
    [
      { source: 'story', acceptance_criteria: ['Story outcome'] },
      /Invalid adjudication acceptance scope: story_id is required/
    ],
    [
      { source: 'story', story_id: STORY_ID },
      /Invalid adjudication acceptance scope: acceptance_criteria is required/
    ],
    [
      {
        source: 'task',
        task_id: 'TASK-A',
        acceptance_criteria: ['Task A outcome']
      },
      /Invalid adjudication acceptance scope: story_id is required/
    ],
    [
      {
        source: 'task',
        story_id: STORY_ID,
        task_id: 'TASK-A',
        acceptance_criteria: null
      },
      /acceptance scope.*acceptance_criteria/
    ]
  ]) {
    await writeFile(path.join(prDir, 'pr-prepare.json'), `${JSON.stringify({
      pr_context: { acceptance_scope: scope }
    }, null, 2)}\n`);
    await assert.rejects(
      () => prepareAdjudication(repo, { storyId: STORY_ID }),
      expectedError
    );
  }

  await writeFile(path.join(prDir, 'pr-prepare.json'), `${JSON.stringify({
    pr_context: {}
  }, null, 2)}\n`);
  const legacy = await prepareAdjudication(repo, { storyId: STORY_ID });
  assert.equal(legacy.acceptance_scope.source, 'story');
  assert.equal(legacy.acceptance_scope.story_id, STORY_ID);
  assert.deepEqual(
    legacy.acceptance_scope.acceptance_criteria,
    ['初見のユーザーが責任範囲を区別できる', '検索から該当ページへ到達できる']
  );

  assert.throws(
    () => buildEvidenceAdjudicationGate({
      storyId: STORY_ID,
      acceptanceCriteria: [{ id: 'ac:1', text: 'Borrowed criterion' }],
      acceptanceScope: {
        source: 'task',
        story_id: STORY_ID,
        task_id: 'TASK-A',
        acceptance_criteria: null
      },
      adjudication: { verdicts: [] },
      headSha: 'head-1'
    }),
    /Invalid adjudication acceptance scope: acceptance_criteria must be an array/
  );
  assert.throws(
    () => buildEvidenceAdjudicationGate({
      storyId: STORY_ID,
      acceptanceCriteria: [],
      acceptanceScope: {
        source: 'task',
        story_id: STORY_ID,
        task_id: 'TASK-A',
        acceptance_criteria: null
      },
      adjudication: { verdicts: [] },
      headSha: 'head-1'
    }),
    /Invalid adjudication acceptance scope: acceptance_criteria must be an array/
  );
});

test('ADJ-S-012 prepare and record bind verdicts to the active task scope from pr-prepare.json', async () => {
  const repo = await makeRepo();
  await git(repo, ['add', '.']);
  await git(repo, ['commit', '-m', 'chore: baseline']);
  const prDir = path.join(repo, '.vibepro', 'pr', STORY_ID);
  await mkdir(prDir, { recursive: true });
  const writePrepare = async (taskId, criterion) => {
    await writeFile(path.join(prDir, 'pr-prepare.json'), `${JSON.stringify({
      pr_context: {
        acceptance_scope: {
          source: 'task',
          story_id: STORY_ID,
          task_id: taskId,
          acceptance_criteria: [criterion]
        }
      }
    }, null, 2)}\n`);
  };

  await writePrepare('TASK-A', 'Task A outcome');
  const taskARequest = await prepareAdjudication(repo, { storyId: STORY_ID });
  assert.equal(taskARequest.acceptance_scope.task_id, 'TASK-A');
  assert.deepEqual(taskARequest.clauses, [{ id: 'ac:1', text: 'Task A outcome' }]);
  await recordAdjudication(repo, {
    storyId: STORY_ID,
    clauseId: 'ac:1',
    verdict: 'demonstrated',
    reason: 'Task A evidence demonstrates Task A only.',
    agentSystem: 'codex',
    agentId: 'adjudicator-task-a'
  });
  const stored = await readAdjudicationIfExists(repo, STORY_ID);
  assert.equal(stored.verdicts[0].acceptance_scope.task_id, 'TASK-A');

  await writePrepare('TASK-B', 'Task B outcome');
  const taskBRequest = await prepareAdjudication(repo, { storyId: STORY_ID });
  assert.equal(taskBRequest.acceptance_scope.task_id, 'TASK-B');
  assert.notEqual(
    taskBRequest.acceptance_scope_fingerprint,
    taskARequest.acceptance_scope_fingerprint
  );
  const taskBGate = buildEvidenceAdjudicationGate({
    storyId: STORY_ID,
    acceptanceCriteria: taskBRequest.clauses,
    acceptanceScope: taskBRequest.acceptance_scope,
    adjudication: stored,
    headSha: stored.verdicts[0].head_commit
  });
  assert.equal(taskBGate.status, 'needs_evidence');
});

test('ADJ-S-013 real PR prepare keeps same-HEAD adjudication isolated between selected tasks', async () => {
  const repo = await makeRepo();
  const tasksDir = path.join(repo, '.vibepro', 'stories', STORY_ID, 'tasks');
  await mkdir(tasksDir, { recursive: true });
  const task = (id, criterion) => ({
    id,
    source_type: 'story_plan_candidate',
    source_id: id,
    title: id,
    priority: 'high',
    status: 'completed',
    execution_policy: 'proposal_only',
    mutates_repository: false,
    target_count: 1,
    target_files: ['README.md'],
    target_routes: [],
    target_groups: [],
    read_first_files: [{ file: 'README.md', reason: 'fixture' }],
    recommended_strategy: { id: 'fixture', reason: 'scope regression' },
    implementation_steps: [],
    acceptance_criteria: [criterion],
    graph_context: null,
    pre_fix_briefing: null
  });
  await writeFile(path.join(tasksDir, 'tasks.json'), `${JSON.stringify({
    schema_version: '0.1.0',
    generated_at: '2026-07-28T00:00:00.000Z',
    story: { story_id: STORY_ID, title: 'Adjudication fixture story' },
    source_run: { run_id: 'story-plan', gate_status: 'pass' },
    tasks: [task('TASK-A', 'Task A outcome'), task('TASK-B', 'Task B outcome')]
  }, null, 2)}\n`);
  await git(repo, ['add', '.']);
  await git(repo, ['commit', '-m', 'chore: baseline']);
  await git(repo, ['switch', '-c', 'feature/task-scope-adjudication']);
  await writeFile(path.join(repo, 'README.md'), '# Fixture\n\nsame HEAD task scope change\n');
  await git(repo, ['add', 'README.md']);
  await git(repo, ['commit', '-m', 'feat: change']);

  const taskAPrepare = await preparePullRequest(repo, {
    storyId: STORY_ID,
    baseRef: 'main',
    branchName: 'feature/task-scope-adjudication',
    taskId: 'TASK-A',
    evidenceDepth: 'summary'
  });
  assert.equal(taskAPrepare.preparation.pr_context.acceptance_scope.task_id, 'TASK-A');
  await recordAdjudication(repo, {
    storyId: STORY_ID,
    clauseId: 'ac:1',
    verdict: 'demonstrated',
    reason: 'Task A evidence demonstrates Task A only.',
    agentSystem: 'codex',
    agentId: 'adjudicator-task-a'
  });
  const taskAWithVerdict = await preparePullRequest(repo, {
    storyId: STORY_ID,
    baseRef: 'main',
    branchName: 'feature/task-scope-adjudication',
    taskId: 'TASK-A',
    evidenceDepth: 'summary'
  });
  const taskAGate = taskAWithVerdict.preparation.pr_context.gate_dag.nodes
    .find((node) => node.id === 'gate:evidence_adjudication');
  assert.equal(taskAGate.status, 'passed', JSON.stringify(taskAGate));

  const taskBPrepare = await preparePullRequest(repo, {
    storyId: STORY_ID,
    baseRef: 'main',
    branchName: 'feature/task-scope-adjudication',
    taskId: 'TASK-B',
    evidenceDepth: 'summary'
  });
  assert.equal(taskBPrepare.preparation.pr_context.acceptance_scope.task_id, 'TASK-B');
  assert.equal(
    taskBPrepare.preparation.pr_context.gate_dag.nodes
      .find((node) => node.id === 'gate:evidence_adjudication').status,
    'needs_evidence'
  );
});

test('ADJ-S-010 verdicts without a head_commit are stale (fail closed), and record refuses to run outside a git repository', async () => {
  const gate = buildEvidenceAdjudicationGate({
    storyId: STORY_ID,
    acceptanceCriteria: [{ id: 'AC-1', text: 'a' }],
    adjudication: { verdicts: [{ clause_id: 'AC-1', verdict: 'demonstrated', reason: 'ok', head_commit: null }] },
    headSha: 'head-1'
  });
  assert.equal(gate.status, 'needs_evidence');
  assert.deepEqual(gate.missing_clauses, ['AC-1']);

  const unknownHeadGate = buildEvidenceAdjudicationGate({
    storyId: STORY_ID,
    acceptanceCriteria: [{ id: 'AC-1', text: 'a' }],
    adjudication: { verdicts: [{ clause_id: 'AC-1', verdict: 'demonstrated', reason: 'ok', head_commit: 'head-1' }] },
    headSha: null
  });
  assert.equal(unknownHeadGate.status, 'needs_evidence');

  const nonGitDir = await mkdtemp(path.join(os.tmpdir(), 'vibepro-adjudication-nogit-'));
  await mkdir(path.join(nonGitDir, '.vibepro'), { recursive: true });
  await assert.rejects(
    () => recordAdjudication(nonGitDir, {
      storyId: STORY_ID,
      clauseId: 'AC-1',
      verdict: 'demonstrated',
      reason: 'x',
      agentSystem: 'claude_code',
      agentId: 'judge-1'
    }),
    /could not resolve the current HEAD commit/
  );
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
