import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { access, mkdir, mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

import { runCli } from '../src/cli.js';

const execFileAsync = promisify(execFile);

async function git(repo, args) {
  return execFileAsync('git', args, { cwd: repo, encoding: 'utf8' });
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'));
}

async function exists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function setupLowRiskRepo() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vibepro-edp-'));
  await writeFile(path.join(root, 'index.html'), '<!doctype html><title>Test</title>\n');
  await git(root, ['init', '-b', 'main']);
  await git(root, ['config', 'user.email', 'vibepro@example.com']);
  await git(root, ['config', 'user.name', 'VibePro Test']);
  await runCli(['init', root, '--story-id', 'story-low-risk', '--title', 'Low risk']);
  await mkdir(path.join(root, 'docs', 'management', 'stories', 'active'), { recursive: true });
  await writeFile(path.join(root, 'docs', 'management', 'stories', 'active', 'story-low-risk.md'), `---
story_id: story-low-risk
title: Low risk
---

# Story

## Acceptance Criteria
- Update README only.
`);
  await git(root, ['add', '.']);
  await git(root, ['commit', '-m', 'init']);
  await git(root, ['switch', '-c', 'feature/readme']);
  await writeFile(path.join(root, 'README.md'), '# Hello\n');
  await git(root, ['add', 'README.md']);
  await git(root, ['commit', '-m', 'docs: update readme']);
  return root;
}

async function setupHighRiskAuthRepo() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vibepro-edp-auth-'));
  await writeFile(path.join(root, 'index.html'), '<!doctype html><title>Test</title>\n');
  await git(root, ['init', '-b', 'main']);
  await git(root, ['config', 'user.email', 'vibepro@example.com']);
  await git(root, ['config', 'user.name', 'VibePro Test']);
  await runCli(['init', root, '--story-id', 'story-auth-risk', '--title', 'Auth risk']);
  await mkdir(path.join(root, 'docs', 'management', 'stories', 'active'), { recursive: true });
  await writeFile(path.join(root, 'docs', 'management', 'stories', 'active', 'story-auth-risk.md'), `---
story_id: story-auth-risk
title: Auth risk
---

# Story

## Background
The auth permission boundary must reject unauthorized sessions.

## Acceptance Criteria
- Update the auth permission check.
`);
  await git(root, ['add', '.']);
  await git(root, ['commit', '-m', 'init']);
  await git(root, ['switch', '-c', 'feature/auth-risk']);
  await mkdir(path.join(root, 'src'), { recursive: true });
  await writeFile(path.join(root, 'src', 'auth.js'), [
    'export function canAccessSession(user, session) {',
    '  return Boolean(user?.id && session?.ownerId === user.id);',
    '}',
    ''
  ].join('\n'));
  await git(root, ['add', 'src/auth.js']);
  await git(root, ['commit', '-m', 'feat: add auth permission check']);
  return root;
}

test('pr prepare summary depth writes plan/index but skips HTML and standalone Gate DAG dump', async () => {
  const repo = await setupLowRiskRepo();

  const result = await runCli(['pr', 'prepare', repo, '--story-id', 'story-low-risk', '--base', 'main', '--json']);
  assert.equal(result.exitCode, 0);
  const prDir = path.join(repo, '.vibepro', 'pr', 'story-low-risk');
  const plan = await readJson(path.join(prDir, 'evidence-plan.json'));
  const index = await readJson(path.join(prDir, 'decision-index.json'));
  const prepare = await readJson(path.join(prDir, 'pr-prepare.json'));

  assert.equal(plan.evidence_depth, 'summary');
  assert.equal(plan.artifact_policy.write_html_reports, false);
  assert.equal(index.evidence_depth, 'summary');
  assert.equal(prepare.evidence_plan.evidence_depth, 'summary');
  await stat(path.join(prDir, 'pr-body.md'));
  await stat(path.join(prDir, 'split-plan.json'));
  assert.equal(await exists(path.join(prDir, 'pr-prepare.html')), false);
  assert.equal(await exists(path.join(prDir, 'review-cockpit.html')), false);
  assert.equal(await exists(path.join(prDir, 'gate-dag.html')), false);
  assert.equal(await exists(path.join(prDir, 'gate-dag.json')), false);
  assert.equal(await exists(path.join(prDir, 'split-plan.html')), false);
  const prBody = await readFile(path.join(prDir, 'pr-body.md'), 'utf8');
  assert.doesNotMatch(prBody, /story-low-risk\/gate-dag\.json/);
  assert.doesNotMatch(prBody, /story-low-risk\/review-cockpit\.html/);
  assert.match(prBody, /## 判断/);
  assert.match(prBody, /- 証跡: \[\.vibepro\/pr\/story-low-risk\/\]\(\.vibepro\/pr\/story-low-risk\/\)/);
  assert.match(prBody, /- 判断索引: \[\.vibepro\/pr\/story-low-risk\/decision-index\.json\]\(\.vibepro\/pr\/story-low-risk\/decision-index\.json\)/);

  const manifest = await readJson(path.join(repo, '.vibepro', 'vibepro-manifest.json'));
  const entry = manifest.pr_preparations['story-low-risk'];
  assert.equal(entry.latest_evidence_plan, '.vibepro/pr/story-low-risk/evidence-plan.json');
  assert.equal(entry.latest_decision_index, '.vibepro/pr/story-low-risk/decision-index.json');
  assert.equal(entry.latest_gate_dag, null);
  assert.equal(entry.latest_review_cockpit, null);
});

test('pr prepare summary depth removes stale full-surface artifacts from previous runs', async () => {
  const repo = await setupLowRiskRepo();

  const fullResult = await runCli([
    'pr',
    'prepare',
    repo,
    '--story-id',
    'story-low-risk',
    '--base',
    'main',
    '--evidence-depth',
    'full',
    '--evidence-depth-reason',
    'initial full reviewer surface',
    '--evidence-depth-consumer',
    'test',
    '--evidence-depth-target',
    'gate-dag.json'
  ]);
  assert.equal(fullResult.exitCode, 0);
  const prDir = path.join(repo, '.vibepro', 'pr', 'story-low-risk');
  assert.equal(await exists(path.join(prDir, 'gate-dag.json')), true);
  assert.equal(await exists(path.join(prDir, 'gate-dag.html')), true);
  assert.equal(await exists(path.join(prDir, 'review-cockpit.html')), true);

  const summaryResult = await runCli(['pr', 'prepare', repo, '--story-id', 'story-low-risk', '--base', 'main', '--json']);
  assert.equal(summaryResult.exitCode, 0);
  const plan = await readJson(path.join(prDir, 'evidence-plan.json'));

  assert.equal(plan.evidence_depth, 'summary');
  assert.equal(await exists(path.join(prDir, 'gate-dag.json')), false);
  assert.equal(await exists(path.join(prDir, 'gate-dag.html')), false);
  assert.equal(await exists(path.join(prDir, 'review-cockpit.html')), false);
  assert.equal(await exists(path.join(prDir, 'pr-prepare.html')), false);
  assert.equal(await exists(path.join(prDir, 'split-plan.html')), false);
});

test('GEFR-S-4: explicit evidence-depth wins over focused-view default', async () => {
  const repo = await setupLowRiskRepo();

  const result = await runCli([
    'pr',
    'prepare',
    repo,
    '--story-id',
    'story-low-risk',
    '--base',
    'main',
    '--evidence-depth',
    'full',
    '--evidence-depth-reason',
    'audit replay requested full evidence',
    '--evidence-depth-consumer',
    'value-audit',
    '--evidence-depth-target',
    'gate:network_contract',
    '--view',
    'readiness'
  ]);
  assert.equal(result.exitCode, 0);
  const prDir = path.join(repo, '.vibepro', 'pr', 'story-low-risk');
  const plan = await readJson(path.join(prDir, 'evidence-plan.json'));

  assert.equal(plan.evidence_depth, 'full');
  assert.equal(plan.manual_override.status, 'requested');
  assert.equal(plan.manual_override.reason, 'audit replay requested full evidence');
  assert.equal(plan.manual_override.consumer, 'value-audit');
  assert.equal(await exists(path.join(prDir, 'gate-dag.json')), true);
  assert.equal(await exists(path.join(prDir, 'review-cockpit.html')), true);
});

test('pr prepare keeps high-risk default summary while recording targeted risk surfaces', async () => {
  const repo = await setupHighRiskAuthRepo();

  const result = await runCli(['pr', 'prepare', repo, '--story-id', 'story-auth-risk', '--base', 'main', '--json']);
  assert.equal(result.exitCode, 0);
  const prDir = path.join(repo, '.vibepro', 'pr', 'story-auth-risk');
  const plan = await readJson(path.join(prDir, 'evidence-plan.json'));
  const prepare = await readJson(path.join(prDir, 'pr-prepare.json'));

  assert.equal(plan.default_depth, 'summary');
  assert.equal(plan.evidence_depth, 'summary');
  assert.equal(plan.artifact_policy.write_full_gate_dag_dump, false);
  assert.equal(await exists(path.join(prDir, 'gate-dag.json')), false);
  assert.ok(plan.risk_signals.some((signal) => signal.kind === 'risk_surface' && signal.value === 'auth_boundary'));
  assert.ok(plan.targeted_full_surfaces.some((surface) => surface.surface === 'auth_boundary'));
  assert.ok(prepare.evidence_plan.targeted_full_surfaces.some((surface) => surface.surface === 'auth_boundary'));
});

test('pr prepare focused view uses summary depth even for high-risk workflow', async () => {
  const repo = await setupHighRiskAuthRepo();

  const result = await runCli(['pr', 'prepare', repo, '--story-id', 'story-auth-risk', '--base', 'main', '--view', 'readiness']);
  assert.equal(result.exitCode, 0);
  const prDir = path.join(repo, '.vibepro', 'pr', 'story-auth-risk');
  const plan = await readJson(path.join(prDir, 'evidence-plan.json'));
  const prepare = await readJson(path.join(prDir, 'pr-prepare.json'));

  assert.equal(plan.default_depth, 'summary');
  assert.equal(plan.evidence_depth, 'summary');
  assert.equal(plan.manual_override.status, 'requested');
  assert.equal(plan.manual_override.reason, 'limited pr prepare view requested');
  assert.equal(plan.manual_override.consumer, 'limited_pr_prepare_view');
  assert.equal(plan.artifact_policy.write_html_reports, false);
  assert.equal(plan.artifact_policy.write_full_gate_dag_dump, false);
  assert.equal(prepare.evidence_plan.evidence_depth, 'summary');
  assert.equal(await exists(path.join(prDir, 'gate-dag.json')), false);
  assert.equal(await exists(path.join(prDir, 'review-cockpit.html')), false);
});

test('pr prepare logs each explicit drill-down target and reason', async () => {
  const repo = await setupLowRiskRepo();
  const args = [
    'pr', 'prepare', repo, '--story-id', 'story-low-risk', '--base', 'main',
    '--evidence-depth', 'standard', '--evidence-depth-reason', 'inspect traceability details',
    '--evidence-depth-consumer', 'agent-review', '--evidence-depth-target', 'traceability.json'
  ];
  assert.equal((await runCli(args)).exitCode, 0);
  assert.equal((await runCli(args)).exitCode, 0);

  const log = await readJson(path.join(repo, '.vibepro', 'pr', 'story-low-risk', 'evidence-drilldown-log.json'));
  assert.equal(log.entries.length, 2);
  assert.equal(log.entries[1].reason, 'inspect traceability details');
  assert.deepEqual(log.entries[1].targets, ['traceability.json']);
  assert.ok(log.entries[1].head_sha);
});
