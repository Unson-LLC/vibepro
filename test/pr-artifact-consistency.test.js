import './support/scratch-tmpdir.js';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

import { runCli } from '../src/cli.js';
import { resolveArtifactRoute } from '../src/artifact-routing.js';
import { extractMarkdownAcceptanceCriteria } from '../src/markdown-acceptance-criteria.js';
import { readTaskAuthorities } from '../src/task-authority.js';

const execFileAsync = promisify(execFile);
const STORY_ID = 'story-pr-artifact-consistency-fixture';

async function git(repo, args) {
  return execFileAsync('git', args, { cwd: repo, encoding: 'utf8' });
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'));
}

function storyDocument(heading = '## 6. ACCEPTANCE CRITERIA') {
  return [
    '---',
    `story_id: ${STORY_ID}`,
    'title: PR artifact consistency fixture',
    '---',
    '',
    '# Story',
    '',
    '## Background',
    '- BACKGROUND-ONLY: this bullet must never become an acceptance criterion',
    '',
    heading,
    ...Array.from({ length: 12 }, (_, index) => {
      const id = `DSS-AC-${String(index + 1).padStart(3, '0')}`;
      return `- ${id}: fixture-${index + 1}.js remains traceable`;
    }),
    '',
    '## Boundary',
    '- BOUNDARY-ONLY: this bullet must never become an acceptance criterion',
    ''
  ].join('\n');
}

const HUMAN_TASKS = [
  '# Task Plan',
  '',
  '| Task | 内容 | 状態 |',
  '|---|---|---|',
  '| DSS-T01 | 設計1 | done |',
  '| DSS-T02 | 設計2 | done |',
  '| DSS-T03 | 設計3 | done |',
  '| DSS-T04 | 設計4 | done |',
  '| DSS-T05 | 実装 | pending |',
  '| DSS-T06 | 検証 | pending |',
  ''
].join('\n');

async function setupRepo() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vibepro-pr-artifact-consistency-'));
  await writeFile(path.join(root, 'index.html'), '<!doctype html><title>Test</title>');
  await git(root, ['init', '-b', 'main']);
  await git(root, ['config', 'user.email', 'vibepro@example.com']);
  await git(root, ['config', 'user.name', 'VibePro Test']);
  await runCli(['init', root, '--story-id', STORY_ID, '--title', 'PR artifact consistency fixture']);
  const storyDir = path.join(root, 'docs', 'management', 'stories', 'active');
  await mkdir(storyDir, { recursive: true });
  await writeFile(path.join(storyDir, `${STORY_ID}.md`), storyDocument());
  await writeFile(path.join(storyDir, '06_tasks.md'), HUMAN_TASKS);
  const taskRoute = await resolveArtifactRoute(root, 'task_plan', { storyId: STORY_ID });
  await mkdir(path.dirname(taskRoute.canonical.absolute_path), { recursive: true });
  await writeFile(taskRoute.canonical.absolute_path, `${JSON.stringify({
    schema_version: '0.1.0',
    story: { story_id: STORY_ID },
    tasks: [{
      id: 'VP-TASK-FLOW-006',
      status: 'todo',
      execution_policy: 'proposal_only',
      mutates_repository: false
    }]
  }, null, 2)}\n`);
  await git(root, ['add', '.']);
  await git(root, ['commit', '-m', 'init fixture']);
  await git(root, ['switch', '-c', 'feature/artifact-consistency']);
  for (let index = 1; index <= 12; index += 1) {
    await writeFile(path.join(root, `fixture-${index}.js`), `export const fixture${index} = true;\n`);
  }
  await git(root, ['add', '.']);
  await git(root, ['commit', '-m', 'implement fixtures']);
  return root;
}

test('shared Acceptance Criteria parser handles numbered/case/Japanese variants without background bullets', () => {
  for (const heading of [
    '## 6. ACCEPTANCE CRITERIA',
    '### 6.2 Acceptance Criteria',
    '## 受け入れ基準',
    '# 受け入れ条件',
    '## 受入条件'
  ]) {
    const criteria = extractMarkdownAcceptanceCriteria(storyDocument(heading));
    assert.equal(criteria.length, 12, heading);
    assert.deepEqual(criteria.map((item) => item.id), Array.from(
      { length: 12 },
      (_, index) => `DSS-AC-${String(index + 1).padStart(3, '0')}`
    ));
    assert.ok(criteria.every((item) => !item.text.includes('BACKGROUND-ONLY')));
    assert.ok(criteria.every((item) => !item.text.includes('BOUNDARY-ONLY')));
  }
});

test('pr prepare projects one exact clause map, computed counts, and distinct task authorities', async () => {
  const root = await setupRepo();
  const first = await runCli(['pr', 'prepare', root, '--story-id', STORY_ID, '--base', 'main', '--json']);
  assert.equal(first.exitCode, 0);
  const prDir = path.join(root, '.vibepro', 'pr', STORY_ID);
  const initialPreparation = await readJson(path.join(prDir, 'pr-prepare.json'));

  await writeFile(path.join(prDir, 'traceability.json'), `${JSON.stringify({
    schema_version: '0.1.0',
    story_id: STORY_ID,
    source: 'stale_fixture',
    lifecycle: 'in_progress',
    evidence: [],
    acceptance_criteria: [],
    scenario_clauses: [],
    scenario_lineage: null
  }, null, 2)}\n`);
  await writeFile(path.join(prDir, 'verification-evidence.json'), `${JSON.stringify({
    schema_version: '0.1.0',
    story_id: STORY_ID,
    commands: [{
      kind: 'unit',
      status: 'fail',
      command: 'node --test test/fixture.test.js',
      summary: '20/20 tests passed',
      evidence_source: 'runner_direct',
      observation: { targets: ['test/fixture.test.js'], scenarios: [], values: { tests: '20', pass: '19', fail: '1' } },
      computed_observation: {
        producer: 'vibepro verify run',
        computed_keys: ['tests', 'pass', 'fail'],
        values: { tests: '20', pass: '19', fail: '1' }
      },
      runtime_identity: initialPreparation.runtime_identity
    }]
  }, null, 2)}\n`);

  const second = await runCli(['pr', 'prepare', root, '--story-id', STORY_ID, '--base', 'main', '--json']);
  assert.equal(second.exitCode, 0);
  const preparation = await readJson(path.join(prDir, 'pr-prepare.json'));
  const traceability = await readJson(path.join(prDir, 'traceability.json'));
  const body = await readFile(path.join(prDir, 'pr-body.md'), 'utf8');

  assert.equal(preparation.traceability.acceptance_criteria.length, 12);
  assert.deepEqual(traceability.acceptance_criteria, preparation.traceability.acceptance_criteria);
  assert.deepEqual(traceability.coverage_summary, preparation.traceability.summary);
  assert.deepEqual(preparation.verification.commands[0].computed_counts, { tests: 20, pass: 19, fail: 1 });
  assert.equal(preparation.verification.commands[0].summary_authority, 'agent_provided_non_authoritative');
  assert.match(body, /tests=20, pass=19, fail=1/);
  assert.doesNotMatch(body, /20\/20 tests passed/);

  assert.equal(preparation.task_authorities.human.task_count, 6);
  assert.deepEqual(preparation.task_authorities.human.status_counts, { done: 4, pending: 2 });
  assert.equal(preparation.task_authorities.generated.task_count, 1);
  assert.deepEqual(preparation.task_authorities.generated.status_counts, { todo: 1 });
  assert.deepEqual(preparation.task_authorities.generated.execution_policies, ['proposal_only']);
  assert.deepEqual(preparation.task_authorities.generated.mutates_repository, [false]);
  assert.match(body, /人間作成タスク.*6件.*done=4.*pending=2/);
  assert.match(body, /生成proposal.*1件.*todo=1.*proposal_only.*mutates_repository=false/);

  const taskRoute = await resolveArtifactRoute(root, 'task_plan', { storyId: STORY_ID });
  await writeFile(taskRoute.canonical.absolute_path, [
    '# Generated Task Plan',
    '',
    '| 項目 | 内容 |',
    '|---|---|',
    '| Story | metadata-not-a-task |',
    '',
    '| ID | Finding | 優先度 | 対象 | 方針 | 状態 |',
    '|---|---|---|---|---|---|',
    '| VP-TASK-ARCH-001 | VP-ARCH-001 | low | 1件 | split | todo |',
    ''
  ].join('\n'));
  const markdownAuthorities = await readTaskAuthorities(root, STORY_ID, {
    path: `docs/management/stories/active/${STORY_ID}.md`
  });
  assert.equal(markdownAuthorities.generated.task_count, 1);
  assert.deepEqual(markdownAuthorities.generated.status_counts, { todo: 1 });
});

test('pr prepare fails closed when canonical traceability cannot be refreshed', async () => {
  const root = await setupRepo();
  const first = await runCli(['pr', 'prepare', root, '--story-id', STORY_ID, '--base', 'main', '--json']);
  assert.equal(first.exitCode, 0);

  const traceabilityPath = path.join(root, '.vibepro', 'pr', STORY_ID, 'traceability.json');
  await rm(traceabilityPath);
  await mkdir(traceabilityPath);

  const blocked = await runCli(['pr', 'prepare', root, '--story-id', STORY_ID, '--base', 'main', '--json']);
  assert.equal(blocked.exitCode, 1);
});

test('pr prepare --task accepts only explicitly bound authority without changing review readiness', async () => {
  const root = await setupRepo();
  const unbound = await runCli(['pr', 'prepare', root, '--story-id', STORY_ID, '--task', 'TASK-001', '--base', 'main', '--json']);
  assert.equal(unbound.exitCode, 1);

  const input = 'accepted-tasks.json';
  await writeFile(path.join(root, input), `${JSON.stringify({
    schema_version: '0.1.0',
    story_id: STORY_ID,
    tasks: [{ task_id: 'TASK-001', story_id: STORY_ID, allowed_paths: ['fixture-1.js'] }]
  }, null, 2)}\n`);
  await git(root, ['add', input]);
  const bound = await runCli(['task', 'bind', root, '--id', STORY_ID, '--input', input, '--json']);
  assert.equal(bound.exitCode, 0);

  const baseline = await runCli(['pr', 'prepare', root, '--story-id', STORY_ID, '--base', 'main', '--json']);
  const selected = await runCli(['pr', 'prepare', root, '--story-id', STORY_ID, '--task', 'TASK-001', '--base', 'main', '--json']);
  assert.equal(selected.exitCode, 0);
  assert.equal(selected.result.preparation.task_authorities.accepted.task_count, 1);
  assert.equal(selected.result.preparation.task_authorities.generated.present, false);
  assert.equal(selected.result.preparation.gate_status, baseline.result.preparation.gate_status);
  assert.equal(selected.result.preparation.review.status, baseline.result.preparation.review.status);
  assert.deepEqual(selected.result.preparation.review.summary, baseline.result.preparation.review.summary);
  assert.deepEqual(
    selected.result.preparation.review.stages.map(({ stage, status }) => ({ stage, status })),
    baseline.result.preparation.review.stages.map(({ stage, status }) => ({ stage, status }))
  );
  assert.deepEqual(
    {
      status: selected.result.preparation.agent_review_instruction?.status,
      current_stage: selected.result.preparation.agent_review_instruction?.current_stage,
      roles: selected.result.preparation.agent_review_instruction?.roles
    },
    {
      status: baseline.result.preparation.agent_review_instruction?.status,
      current_stage: baseline.result.preparation.agent_review_instruction?.current_stage,
      roles: baseline.result.preparation.agent_review_instruction?.roles
    }
  );

  const unknown = await runCli(['pr', 'prepare', root, '--story-id', STORY_ID, '--task', 'TASK-999', '--base', 'main', '--json']);
  assert.equal(unknown.exitCode, 1);
});
