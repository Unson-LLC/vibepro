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

  const manifest = await readJson(path.join(repo, '.vibepro', 'vibepro-manifest.json'));
  const entry = manifest.pr_preparations['story-low-risk'];
  assert.equal(entry.latest_evidence_plan, '.vibepro/pr/story-low-risk/evidence-plan.json');
  assert.equal(entry.latest_decision_index, '.vibepro/pr/story-low-risk/decision-index.json');
  assert.equal(entry.latest_gate_dag, null);
  assert.equal(entry.latest_review_cockpit, null);
});

test('pr prepare records manual full evidence-depth override', async () => {
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
    '--json'
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
