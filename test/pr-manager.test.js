import './support/scratch-tmpdir.js';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

import { runCli } from '../src/cli.js';
import { preparePullRequest, renderPrPrepareSummary } from '../src/pr-manager.js';
import { writeInferredSpec } from '../src/spec-store.js';

const execFileAsync = promisify(execFile);

async function git(repo, args) {
  return execFileAsync('git', args, { cwd: repo, encoding: 'utf8' });
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'));
}

const STORY_DOC = [
  '---',
  'story_id: story-pr-manager-ac',
  'title: AC coverage story',
  '---',
  '',
  '# Story',
  '',
  '## Acceptance Criteria',
  '- AC-1: The widget renders without error',
  '- AC-2: Something completely unrelated to any changed file',
  ''
].join('\n');

async function setupRepo({ storyId = 'story-pr-manager-ac', storyDoc = STORY_DOC } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vibepro-pr-manager-'));
  await writeFile(path.join(root, 'index.html'), '<!doctype html><title>Test</title>');
  await git(root, ['init', '-b', 'main']);
  await git(root, ['config', 'user.email', 'vibepro@example.com']);
  await git(root, ['config', 'user.name', 'VibePro Test']);
  await runCli(['init', root, '--story-id', storyId, '--title', 'AC coverage story']);
  await mkdir(path.join(root, 'docs', 'management', 'stories', 'active'), { recursive: true });
  await writeFile(path.join(root, 'docs', 'management', 'stories', 'active', `${storyId}.md`), storyDoc);
  await git(root, ['add', '.']);
  await git(root, ['commit', '-m', 'init']);
  await git(root, ['switch', '-c', 'feature/ac-coverage']);
  await writeFile(path.join(root, 'widget.js'), 'export function renderWidget() { return true; }\n');
  await git(root, ['add', 'widget.js']);
  await git(root, ['commit', '-m', 'implement widget rendering']);
  return root;
}

test('pr prepare embeds story_source and traceability, with unmapped clauses shown as unaddressed (non-blocking)', async () => {
  const storyId = 'story-pr-manager-ac';
  const root = await setupRepo({ storyId });

  const result = await runCli(['pr', 'prepare', root, '--story-id', storyId, '--base', 'main', '--json']);
  assert.equal(result.exitCode, 0, 'pr prepare must not block even though AC-2 has no matching evidence');

  const preparation = await readJson(path.join(root, '.vibepro', 'pr', storyId, 'pr-prepare.json'));

  assert.equal(preparation.story_source.found, true);
  assert.equal(preparation.story_source.path, `docs/management/stories/active/${storyId}.md`);
  assert.equal(preparation.story_source.acceptance_criteria_count, 2);

  const clauses = preparation.traceability.acceptance_criteria;
  assert.equal(clauses.length, 2);
  const ac1 = clauses.find((clause) => /AC-1/.test(clause.text));
  const ac2 = clauses.find((clause) => /AC-2/.test(clause.text));
  assert.ok(ac1, 'AC-1 must be present in the clause map');
  assert.ok(ac2, 'AC-2 must be present in the clause map');
  assert.notEqual(ac1.status, 'unmapped', 'AC-1 mentions the changed widget.js file and should not be unmapped');
  assert.equal(ac2.status, 'unmapped', 'AC-2 has no matching file, test, or evidence and must be unmapped');

  assert.equal(preparation.traceability.summary.acceptance_criteria_count, 2);
  assert.ok(preparation.traceability.summary.unmapped_count >= 1);
  assert.equal(preparation.runtime_identity.integrity.status, 'trusted');
  assert.match(preparation.runtime_identity.identity_digest, /^[0-9a-f]{64}$/);

  const body = await readFile(path.join(root, '.vibepro', 'pr', storyId, 'pr-body.md'), 'utf8');
  assert.match(body, /### Story document/);
  assert.match(body, new RegExp(`docs/management/stories/active/${storyId}\\.md`));
  assert.match(body, /### Acceptance criteria/);
  assert.match(body, /\[未対応\].*AC-2/, 'unmapped AC must be rendered as unaddressed, not as a blocker');
  assert.match(body, /### VibePro runtime identity/);
  assert.match(body, new RegExp(preparation.runtime_identity.identity_digest));
});

test('pr prepare summarizes multi-tenant contract, six views, findings, and review lenses', async () => {
  const storyId = 'story-pr-manager-tenant';
  const storyDoc = STORY_DOC
    .replaceAll('story-pr-manager-ac', storyId)
    .replace('# Story', '# Multi-tenant Story\n\n複数テナントのqueue、credential、storage境界をtenant_idで分離する。');
  const root = await setupRepo({ storyId, storyDoc });
  const contract = JSON.parse(await readFile(
    path.join(import.meta.dirname, 'fixtures', 'multi-tenant-architecture', 'pooled.json'),
    'utf8'
  ));
  await writeInferredSpec(root, storyId, {
    schema_version: '0.1.0',
    story_id: storyId,
    clauses: [],
    multi_tenancy: contract
  });

  await preparePullRequest(root, { storyId, baseRef: 'main' });
  const preparation = await readJson(path.join(root, '.vibepro', 'pr', storyId, 'pr-prepare.json'));
  assert.equal(preparation.multi_tenant_architecture.status, 'ready');
  assert.equal(Object.keys(preparation.multi_tenant_architecture.views).length, 6);
  assert.deepEqual(
    preparation.multi_tenant_architecture.review_lenses.map((lens) => lens.id),
    ['tenant_architecture', 'security_boundary', 'operations_and_migration']
  );

  const body = await readFile(path.join(root, '.vibepro', 'pr', storyId, 'pr-body.md'), 'utf8');
  assert.match(body, /### Multi-tenant architecture/);
  assert.match(body, /status: ready/);
  assert.match(body, /system_context/);
  assert.match(body, /evidence coverage: verified/);
  assert.match(body, /review\/security_boundary \[ready\]/);
  assert.match(body, /unconfirmed: none/);
});

test('pr prepare projects non-applicability readiness from caller evidence bound to current HEAD', async () => {
  const storyId = 'story-pr-manager-tenant-na';
  const storyDoc = STORY_DOC
    .replaceAll('story-pr-manager-ac', storyId)
    .replace('# Story', '# Story\n\naccount設定の表示順を変更する。');
  const root = await setupRepo({ storyId, storyDoc });
  await writeInferredSpec(root, storyId, {
    schema_version: '0.1.0', story_id: storyId, clauses: [],
    multi_tenancy: { applicability: 'not_applicable' }
  });
  const { stdout } = await git(root, ['rev-parse', 'HEAD']);
  const head = stdout.trim();
  const evidence = {
    source: 'caller', status: 'verified', head_commit: head,
    required_surfaces: ['story', 'spec', 'implementation'],
    verified_surfaces: ['story', 'spec', 'implementation']
  };

  await preparePullRequest(root, {
    storyId, baseRef: 'main', multiTenantApplicabilityEvidence: evidence
  });
  const fresh = await readJson(path.join(root, '.vibepro', 'pr', storyId, 'pr-prepare.json'));
  assert.equal(fresh.multi_tenant_architecture.status, 'not_applicable');
  assert.equal(fresh.multi_tenant_architecture.implementation_readiness.status, 'ready');

  await preparePullRequest(root, {
    storyId, baseRef: 'main', multiTenantApplicabilityEvidence: { ...evidence, head_commit: 'b'.repeat(40) }
  });
  const wrongHead = await readJson(path.join(root, '.vibepro', 'pr', storyId, 'pr-prepare.json'));
  assert.equal(wrongHead.multi_tenant_architecture.implementation_readiness.status, 'needs_review');
  assert.ok(wrongHead.multi_tenant_architecture.implementation_readiness.reasons.includes('head_mismatch'));
});

test('pr prepare rejects legacy verification evidence without runtime identity before writing judgment', async () => {
  const storyId = 'story-pr-manager-legacy-runtime';
  const root = await setupRepo({ storyId, storyDoc: STORY_DOC.replaceAll('story-pr-manager-ac', storyId) });
  const prDir = path.join(root, '.vibepro', 'pr', storyId);
  await mkdir(prDir, { recursive: true });
  await writeFile(path.join(prDir, 'verification-evidence.json'), `${JSON.stringify({
    schema_version: '0.1.0',
    story_id: storyId,
    commands: [{ kind: 'unit', status: 'pass', command: 'node --test test/example.test.js' }]
  }, null, 2)}\n`);

  await assert.rejects(
    () => preparePullRequest(root, { storyId, baseRef: 'main' }),
    /runtime_mismatch/
  );
  await assert.rejects(readFile(path.join(prDir, 'pr-prepare.json')), /ENOENT/);
});

test('pr prepare does not block when no story document exists', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vibepro-pr-manager-nodoc-'));
  await writeFile(path.join(root, 'index.html'), '<!doctype html><title>Test</title>');
  await git(root, ['init', '-b', 'main']);
  await git(root, ['config', 'user.email', 'vibepro@example.com']);
  await git(root, ['config', 'user.name', 'VibePro Test']);
  await runCli(['init', root, '--story-id', 'story-no-doc', '--title', 'No doc story']);
  await git(root, ['add', '.']);
  await git(root, ['commit', '-m', 'init']);
  await git(root, ['switch', '-c', 'feature/no-doc']);
  await writeFile(path.join(root, 'README.md'), '# Hello\n');
  await git(root, ['add', 'README.md']);
  await git(root, ['commit', '-m', 'feat: add README']);

  const result = await runCli(['pr', 'prepare', root, '--story-id', 'story-no-doc', '--base', 'main', '--json']);
  assert.equal(result.exitCode, 0);

  const preparation = await readJson(path.join(root, '.vibepro', 'pr', 'story-no-doc', 'pr-prepare.json'));
  assert.equal(preparation.story_source.found, false);
  assert.equal(preparation.story_source.acceptance_criteria_count, 0);
  assert.deepEqual(preparation.traceability.acceptance_criteria, []);

  const body = await readFile(path.join(root, '.vibepro', 'pr', 'story-no-doc', 'pr-body.md'), 'utf8');
  assert.match(body, /no story document found/);
  assert.match(body, /no acceptance criteria found/);
});

test('pr readiness reports configured but incomplete reviews and blocks PR creation until complete', async () => {
  const storyId = 'story-pr-manager-review-readiness';
  const root = await setupRepo({
    storyId,
    storyDoc: STORY_DOC.replaceAll('story-pr-manager-ac', storyId)
  });

  const prepared = await runCli(['pr', 'prepare', root, '--story-id', storyId, '--base', 'main', '--json']);
  assert.equal(prepared.exitCode, 0);

  const preparation = await readJson(path.join(root, '.vibepro', 'pr', storyId, 'pr-prepare.json'));
  assert.equal(preparation.review.configured, true);
  assert.equal(preparation.review.recorded, false);
  assert.equal(preparation.review.complete, false);
  assert.equal(preparation.review.status, 'needs_review');
  assert.equal(preparation.gate_status, 'needs_review');
  assert.deepEqual(preparation.blocking_reasons, ['agent_review:needs_review']);
  assert.equal(preparation.agent_review_instruction.status, 'dispatch_required');
  assert.equal(preparation.agent_review_instruction.current_stage, 'planning_spec');
  assert.ok(preparation.agent_review_instruction.roles.length > 0);
  assert.ok(preparation.agent_review_instruction.next_commands.length > 0);
  assert.ok(preparation.agent_review_instruction.next_commands.every((command) => (
    command.includes('--stage planning_spec') || command.includes('vibepro pr prepare')
  )), 'only the current review stage and the follow-up pr prepare command may be projected');
  assert.equal(
    preparation.execution_dag.nodes.find((node) => node.id === 'agent_review_recorded').status,
    'pending'
  );
  assert.equal(
    preparation.execution_dag.nodes.find((node) => node.id === 'pr_prepare_ready').status,
    'pending'
  );

  const body = await readFile(path.join(root, '.vibepro', 'pr', storyId, 'pr-body.md'), 'utf8');
  assert.match(body, /### Review\n- configured: true\n- recorded: false\n- complete: false\n- status: needs_review/);
  assert.match(body, /- blocking reasons: agent_review:needs_review/);
  assert.match(body, /- error: none/);
  assert.match(body, /- agent review instruction: dispatch_required/);
  assert.match(body, /- current stage: planning_spec/);
  for (const command of preparation.agent_review_instruction.next_commands) {
    assert.match(body, new RegExp(`    ${command.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
  }
  const humanSummary = renderPrPrepareSummary({
    preparation,
    artifacts: {
      json: path.join(root, '.vibepro', 'pr', storyId, 'pr-prepare.json'),
      pr_body: path.join(root, '.vibepro', 'pr', storyId, 'pr-body.md')
    }
  });
  assert.match(humanSummary, /- agent review instruction: dispatch_required/);
  assert.match(humanSummary, /- current review stage: planning_spec/);

  let createError = '';
  const created = await runCli(
    ['pr', 'create', root, '--story-id', storyId, '--base', 'main', '--dry-run', '--json'],
    { stderr: { write: (chunk) => { createError += chunk; } } }
  );
  assert.equal(created.exitCode, 1);
  assert.match(createError, /PR creation blocked: agent_review:needs_review/);
});

test('pr readiness marks the execution DAG ready after every configured review passes', async () => {
  const storyId = 'story-pr-manager-review-complete';
  const root = await setupRepo({
    storyId,
    storyDoc: STORY_DOC.replaceAll('story-pr-manager-ac', storyId)
  });
  const configPath = path.join(root, '.vibepro', 'config.json');
  const config = await readJson(configPath);
  config.agent_reviews = {
    stages: {
      planning_spec: ['product_requirement'],
      requirement: [],
      architecture_spec: [],
      test_plan: [],
      implementation: [],
      gate: [],
      preview: []
    }
  };
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);
  await git(root, ['add', configPath]);
  await git(root, ['commit', '-m', 'test: configure one lightweight review']);

  const preparedReview = await runCli([
    'review', 'prepare', root,
    '--id', storyId,
    '--stage', 'planning_spec',
    '--roles', 'product_requirement',
    '--json'
  ]);
  assert.equal(preparedReview.exitCode, 0);

  const recordedReview = await runCli([
    'review', 'record', root,
    '--id', storyId,
    '--stage', 'planning_spec',
    '--role', 'product_requirement',
    '--status', 'pass',
    '--summary', 'the configured lightweight review passed',
    '--inspection-summary', 'inspected the story and implementation diff',
    '--inspection-input', `docs/management/stories/active/${storyId}.md`,
    '--inspection-input', 'widget.js',
    '--judgment-delta', 'review missing -> passed after inspecting the current content surface',
    '--agent-system', 'codex',
    '--execution-mode', 'parallel_subagent',
    '--agent-id', 'reviewer-ready-1',
    '--reviewer-identity', 'separate_session',
    '--implementation-session-id', 'implementation-session-1',
    '--agent-session-id', 'review-session-1',
    '--agent-closed',
    '--json'
  ]);
  assert.equal(recordedReview.exitCode, 0);

  const prepared = await runCli(['pr', 'prepare', root, '--story-id', storyId, '--base', 'main', '--json']);
  assert.equal(prepared.exitCode, 0);
  const preparation = await readJson(path.join(root, '.vibepro', 'pr', storyId, 'pr-prepare.json'));
  assert.equal(preparation.review.configured, true);
  assert.equal(preparation.review.recorded, true);
  assert.equal(preparation.review.complete, true);
  assert.equal(preparation.review.status, 'pass');
  assert.equal(preparation.gate_status, 'ready');
  assert.equal(preparation.agent_review_instruction, null);
  assert.deepEqual(preparation.blocking_reasons, []);
  assert.equal(
    preparation.execution_dag.nodes.find((node) => node.id === 'agent_review_recorded').status,
    'passed'
  );
  assert.equal(
    preparation.execution_dag.nodes.find((node) => node.id === 'pr_prepare_ready').status,
    'passed'
  );

  const changedReview = await runCli([
    'review', 'record', root,
    '--id', storyId,
    '--stage', 'planning_spec',
    '--role', 'product_requirement',
    '--status', 'needs_changes',
    '--summary', 'the configured review found a required change',
    '--inspection-summary', 'reinspected the story and implementation diff',
    '--inspection-input', `docs/management/stories/active/${storyId}.md`,
    '--inspection-input', 'widget.js',
    '--judgment-delta', 'pass -> needs changes after finding a contract mismatch',
    '--agent-system', 'codex',
    '--execution-mode', 'parallel_subagent',
    '--agent-id', 'reviewer-ready-2',
    '--reviewer-identity', 'separate_session',
    '--implementation-session-id', 'implementation-session-1',
    '--agent-session-id', 'review-session-2',
    '--agent-closed',
    '--json'
  ]);
  assert.equal(changedReview.exitCode, 0);

  const preparedAfterChange = await runCli(['pr', 'prepare', root, '--story-id', storyId, '--base', 'main', '--json']);
  assert.equal(preparedAfterChange.exitCode, 0);
  const changedPreparation = await readJson(path.join(root, '.vibepro', 'pr', storyId, 'pr-prepare.json'));
  assert.equal(changedPreparation.review.recorded, true);
  assert.equal(changedPreparation.review.complete, false);
  assert.equal(changedPreparation.review.status, 'needs_review');
  assert.equal(changedPreparation.gate_status, 'needs_review');
  assert.deepEqual(changedPreparation.blocking_reasons, ['agent_review:needs_review']);
  assert.equal(
    changedPreparation.execution_dag.nodes.find((node) => node.id === 'agent_review_recorded').status,
    'pending'
  );
  assert.equal(
    changedPreparation.execution_dag.nodes.find((node) => node.id === 'pr_prepare_ready').status,
    'pending'
  );

  const blockedReview = await runCli([
    'review', 'record', root,
    '--id', storyId,
    '--stage', 'planning_spec',
    '--role', 'product_requirement',
    '--status', 'block',
    '--summary', 'the configured review found a release blocker',
    '--inspection-summary', 'reinspected the story and implementation diff',
    '--inspection-input', `docs/management/stories/active/${storyId}.md`,
    '--inspection-input', 'widget.js',
    '--judgment-delta', 'needs changes -> blocked after confirming a release blocker',
    '--agent-system', 'codex',
    '--execution-mode', 'parallel_subagent',
    '--agent-id', 'reviewer-ready-3',
    '--reviewer-identity', 'separate_session',
    '--implementation-session-id', 'implementation-session-1',
    '--agent-session-id', 'review-session-3',
    '--agent-closed',
    '--json'
  ]);
  assert.equal(blockedReview.exitCode, 0);

  const preparedAfterBlock = await runCli(['pr', 'prepare', root, '--story-id', storyId, '--base', 'main', '--json']);
  assert.equal(preparedAfterBlock.exitCode, 0);
  const blockedPreparation = await readJson(path.join(root, '.vibepro', 'pr', storyId, 'pr-prepare.json'));
  assert.equal(blockedPreparation.review.recorded, true);
  assert.equal(blockedPreparation.review.complete, false);
  assert.equal(blockedPreparation.review.status, 'block');
  assert.equal(blockedPreparation.gate_status, 'blocked');
  assert.equal(blockedPreparation.agent_review_instruction, null);
  assert.deepEqual(blockedPreparation.blocking_reasons, ['agent_review:block']);
  assert.equal(
    blockedPreparation.execution_dag.nodes.find((node) => node.id === 'agent_review_recorded').status,
    'pending'
  );
  assert.equal(
    blockedPreparation.execution_dag.nodes.find((node) => node.id === 'pr_prepare_ready').status,
    'pending'
  );

  const blockedBody = await readFile(path.join(root, '.vibepro', 'pr', storyId, 'pr-body.md'), 'utf8');
  assert.match(blockedBody, /### Review\n- configured: true\n- recorded: true\n- complete: false\n- status: block/);
  assert.match(blockedBody, /- blocking reasons: agent_review:block/);

  let blockCreateError = '';
  const blockedCreate = await runCli(
    ['pr', 'create', root, '--story-id', storyId, '--base', 'main', '--dry-run', '--json'],
    { stderr: { write: (chunk) => { blockCreateError += chunk; } } }
  );
  assert.equal(blockedCreate.exitCode, 1);
  assert.match(blockCreateError, /PR creation blocked: agent_review:block/);
});

test('pr readiness fails closed when the configured review status cannot be read', async () => {
  const storyId = 'story-pr-manager-review-status-error';
  const root = await setupRepo({
    storyId,
    storyDoc: STORY_DOC.replaceAll('story-pr-manager-ac', storyId)
  });
  const configPath = path.join(root, '.vibepro', 'config.json');
  const config = await readJson(configPath);
  config.agent_reviews = {
    defaults: {
      freshness_mode: 'strict_head'
    }
  };
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);
  await git(root, ['add', configPath]);
  await git(root, ['commit', '-m', 'test: configure an invalid review policy']);

  const prepared = await runCli(['pr', 'prepare', root, '--story-id', storyId, '--base', 'main', '--json']);
  assert.equal(prepared.exitCode, 0, 'pr prepare must persist the blocked review status for inspection');
  const preparation = await readJson(path.join(root, '.vibepro', 'pr', storyId, 'pr-prepare.json'));
  assert.equal(preparation.review.configured, true);
  assert.equal(preparation.review.recorded, false);
  assert.equal(preparation.review.complete, false);
  assert.equal(preparation.review.status, 'error');
  assert.match(preparation.review.error.message, /freshness_mode cannot be strict_head/);
  assert.equal(preparation.gate_status, 'blocked');
  assert.equal(preparation.agent_review_instruction, null);
  assert.deepEqual(preparation.blocking_reasons, ['agent_review:status_unavailable']);
  assert.equal(
    preparation.execution_dag.nodes.find((node) => node.id === 'agent_review_recorded').status,
    'pending'
  );
  assert.equal(
    preparation.execution_dag.nodes.find((node) => node.id === 'pr_prepare_ready').status,
    'pending'
  );

  const body = await readFile(path.join(root, '.vibepro', 'pr', storyId, 'pr-body.md'), 'utf8');
  assert.match(body, /### Review\n- configured: true\n- recorded: false\n- complete: false\n- status: error/);
  assert.match(body, /- blocking reasons: agent_review:status_unavailable/);
  assert.match(body, /- error: .*freshness_mode cannot be strict_head/);

  let createError = '';
  const created = await runCli(
    ['pr', 'create', root, '--story-id', storyId, '--base', 'main', '--dry-run', '--json'],
    { stderr: { write: (chunk) => { createError += chunk; } } }
  );
  assert.equal(created.exitCode, 1);
  assert.match(createError, /PR creation blocked: agent_review:status_unavailable/);
});

test('pr readiness stays ready when every review stage is explicitly disabled', async () => {
  const storyId = 'story-pr-manager-review-disabled';
  const root = await setupRepo({
    storyId,
    storyDoc: STORY_DOC.replaceAll('story-pr-manager-ac', storyId)
  });
  const configPath = path.join(root, '.vibepro', 'config.json');
  const config = await readJson(configPath);
  config.agent_reviews = {
    stages: {
      planning_spec: [],
      requirement: [],
      architecture_spec: [],
      test_plan: [],
      implementation: [],
      gate: [],
      preview: []
    }
  };
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);
  await git(root, ['add', configPath]);
  await git(root, ['commit', '-m', 'test: explicitly disable review stages']);

  const prepared = await runCli(['pr', 'prepare', root, '--story-id', storyId, '--base', 'main', '--json']);
  assert.equal(prepared.exitCode, 0);
  const preparation = await readJson(path.join(root, '.vibepro', 'pr', storyId, 'pr-prepare.json'));
  assert.equal(preparation.review.configured, false);
  assert.equal(preparation.review.recorded, false);
  assert.equal(preparation.review.complete, false);
  assert.equal(preparation.review.status, 'needs_review');
  assert.equal(preparation.review.error, null);
  assert.equal(preparation.gate_status, 'ready');
  assert.equal(preparation.agent_review_instruction, null);
  assert.deepEqual(preparation.blocking_reasons, []);
  assert.equal(
    preparation.execution_dag.nodes.find((node) => node.id === 'agent_review_recorded').status,
    'not_applicable'
  );
  assert.equal(
    preparation.execution_dag.nodes.find((node) => node.id === 'pr_prepare_ready').status,
    'passed'
  );

  const body = await readFile(path.join(root, '.vibepro', 'pr', storyId, 'pr-body.md'), 'utf8');
  assert.match(body, /### Review\n- configured: false\n- recorded: false\n- complete: false\n- status: needs_review/);
  assert.match(body, /- blocking reasons: none/);
  assert.match(body, /- error: none/);
});
