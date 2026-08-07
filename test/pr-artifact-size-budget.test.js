import './support/scratch-tmpdir.js';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { access, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

import { runCli } from '../src/cli.js';
import {
  DEFAULT_PR_ARTIFACT_BYTES,
  buildArtifactSummaryContent,
  findBudgetSummaryPath,
  planArtifactBudget,
  resolveHandoffArtifact,
  resolvePrArtifactBudgetBytes,
  summaryFilenameFor
} from '../src/pr-artifact-budget.js';

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

async function makeRepo(storyId = 'story-pab') {
  const repo = await mkdtemp(path.join(os.tmpdir(), 'vibepro-pab-'));
  await git(repo, ['init', '-b', 'main']);
  await git(repo, ['config', 'user.email', 'vibepro@example.com']);
  await git(repo, ['config', 'user.name', 'VibePro Test']);
  await runCli(['init', repo, '--story-id', storyId, '--title', 'PR artifact size budget']);
  await mkdir(path.join(repo, 'docs', 'management', 'stories', 'active'), { recursive: true });
  await writeFile(path.join(repo, 'docs', 'management', 'stories', 'active', `${storyId}.md`), `---
story_id: ${storyId}
title: PR artifact size budget
---

# Story

## Acceptance Criteria
- Change the source module.
`);
  await mkdir(path.join(repo, 'src'), { recursive: true });
  await writeFile(path.join(repo, 'src', 'target.js'), 'export const value = 1;\n');
  await git(repo, ['add', '.']);
  await git(repo, ['commit', '-m', 'chore: init pab fixture']);
  await git(repo, ['switch', '-c', 'feature/pab']);
  await writeFile(path.join(repo, 'src', 'target.js'), 'export const value = 2;\n');
  await git(repo, ['add', 'src/target.js']);
  await git(repo, ['commit', '-m', 'feat: change target']);
  return repo;
}

async function setBudget(repo, bytes) {
  const configPath = path.join(repo, '.vibepro', 'config.json');
  const config = await readJson(configPath);
  config.budgets = { ...(config.budgets ?? {}), pr_artifact_bytes: bytes };
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);
}

function gateVerdicts(preparation) {
  return (preparation.pr_context.gate_dag.nodes ?? [])
    .map((node) => `${node.id}:${node.status}`)
    .sort();
}

test('resolvePrArtifactBudgetBytes falls back to the documented default', () => {
  assert.equal(resolvePrArtifactBudgetBytes(null), DEFAULT_PR_ARTIFACT_BYTES);
  assert.equal(resolvePrArtifactBudgetBytes({}), DEFAULT_PR_ARTIFACT_BYTES);
  assert.equal(resolvePrArtifactBudgetBytes({ budgets: {} }), DEFAULT_PR_ARTIFACT_BYTES);
  assert.equal(resolvePrArtifactBudgetBytes({ budgets: { pr_artifact_bytes: 0 } }), DEFAULT_PR_ARTIFACT_BYTES);
  assert.equal(resolvePrArtifactBudgetBytes({ budgets: { pr_artifact_bytes: 2048 } }), 2048);
});

test('PAB-S-1/PAB-CONTRACT-002 over-budget artifact gets a bounded summary under 10% of source', () => {
  const big = { status: 'pass', action_items: Array.from({ length: 400 }, (_, i) => `item-${i}`) };
  const content = `${JSON.stringify(big, null, 2)}\n`;
  const bytes = Buffer.byteLength(content, 'utf8');
  const plan = planArtifactBudget({
    artifacts: [{ filename: 'design-ssot-reconciliation.json', content }],
    budgetBytes: 512
  });
  assert.equal(plan.over_budget.length, 1);
  const entry = plan.over_budget[0];
  assert.equal(entry.artifact, 'design-ssot-reconciliation.json');
  assert.equal(entry.summary_status, 'generated');
  assert.equal(entry.summary_filename, 'design-ssot-reconciliation.summary.json');
  assert.equal(plan.summaries.length, 1);
  const summary = JSON.parse(plan.summaries[0].content);
  assert.equal(summary.schema_version, '0.1.0');
  assert.equal(summary.kind, 'artifact_summary');
  assert.equal(summary.source_artifact, 'design-ssot-reconciliation.json');
  assert.equal(summary.source_bytes, bytes);
  assert.match(summary.source_content_hash, /^sha256:[0-9a-f]{64}$/);
  assert.equal(summary.full_artifact_path, 'design-ssot-reconciliation.json');
  assert.ok(summary.conclusion);
  assert.equal(summary.conclusion.top_level_counts.action_items_count, 400);
  const summaryBytes = Buffer.byteLength(plan.summaries[0].content, 'utf8');
  assert.ok(summaryBytes <= Math.floor(bytes * 0.1), `summary ${summaryBytes} must be <= 10% of ${bytes}`);
});

test('PAB-S-2 within-budget artifact produces no summary', () => {
  const small = { status: 'pass' };
  const content = `${JSON.stringify(small, null, 2)}\n`;
  const plan = planArtifactBudget({
    artifacts: [{ filename: 'decision-index.json', content }],
    budgetBytes: DEFAULT_PR_ARTIFACT_BYTES
  });
  assert.equal(plan.over_budget.length, 0);
  assert.equal(plan.summaries.length, 0);
  const handoff = resolveHandoffArtifact(plan, 'decision-index.json', '.vibepro/pr/story/');
  assert.equal(handoff.is_summary, false);
  assert.equal(handoff.path, '.vibepro/pr/story/decision-index.json');
});

test('EDL-S3 bounded senior-gap summary preserves decision-use counts', () => {
  const parsed = {
    status: 'needs_review',
    cost_context: {
      artifact_value_ledger: {
        decision_changed_count: 2,
        decision_change_unconfirmed_count: 3,
        unused_artifact_count: 1
      }
    },
    padding: 'x'.repeat(12000)
  };
  const content = `${JSON.stringify(parsed, null, 2)}\n`;
  const summary = JSON.parse(buildArtifactSummaryContent({
    filename: 'senior-gap-judgment.json',
    content,
    bytes: Buffer.byteLength(content, 'utf8'),
    budgetBytes: 512
  }));
  assert.deepEqual(summary.conclusion.top_level_counts, {
    decision_changed_count: 2,
    decision_change_unconfirmed_count: 3,
    unused_artifact_count: 1
  });
});

test('PAB-CONTRACT-005 unparseable over-budget artifact degrades to failed with no summary', () => {
  const content = `not json ${'x'.repeat(2000)}`;
  const plan = planArtifactBudget({
    artifacts: [{ filename: 'decision-index.json', content }],
    budgetBytes: 256
  });
  assert.equal(plan.over_budget.length, 1);
  assert.equal(plan.over_budget[0].summary_status, 'failed');
  assert.equal(plan.over_budget[0].summary_filename, null);
  assert.equal(plan.summaries.length, 0);
  const handoff = resolveHandoffArtifact(plan, 'decision-index.json', '.vibepro/pr/story/');
  assert.equal(handoff.is_summary, false, 'failed summary must fall back to full path');
  assert.equal(handoff.path, '.vibepro/pr/story/decision-index.json');
});

test('resolveHandoffArtifact routes to summary and keeps a full pointer when generated', () => {
  const plan = {
    resolver: new Map([['decision-index.json', {
      over_budget: true,
      summary_status: 'generated',
      summary_filename: 'decision-index.summary.json'
    }]])
  };
  const handoff = resolveHandoffArtifact(plan, 'decision-index.json', '.vibepro/pr/story/');
  assert.equal(handoff.is_summary, true);
  assert.equal(handoff.path, '.vibepro/pr/story/decision-index.summary.json');
  assert.equal(handoff.full_path, '.vibepro/pr/story/decision-index.json');
});

test('buildArtifactSummaryContent returns null when it cannot fit within 10%', () => {
  // Tiny source that is technically "over budget" for a tiny budget but whose
  // fixed summary skeleton cannot be 10% of a small source.
  const content = `${JSON.stringify({ status: 'pass' }, null, 2)}\n`;
  const bytes = Buffer.byteLength(content, 'utf8');
  const result = buildArtifactSummaryContent({
    filename: 'decision-index.json',
    content,
    bytes,
    budgetBytes: 4
  });
  assert.equal(result, null);
  assert.equal(summaryFilenameFor('decision-index.json'), 'decision-index.summary.json');
});

test('findBudgetSummaryPath reads a persisted artifact_budget report', () => {
  const budget = {
    budget_bytes: 16384,
    over_budget: [
      { artifact: 'decision-index.json', bytes: 40000, summary_path: '.vibepro/pr/s/decision-index.summary.json', summary_status: 'generated' },
      { artifact: 'gate-dag.json', bytes: 50000, summary_path: null, summary_status: 'failed' }
    ]
  };
  assert.equal(findBudgetSummaryPath(budget, 'decision-index.json'), '.vibepro/pr/s/decision-index.summary.json');
  assert.equal(findBudgetSummaryPath(budget, 'gate-dag.json'), null);
  assert.equal(findBudgetSummaryPath(budget, 'evidence-plan.json'), null);
  assert.equal(findBudgetSummaryPath(null, 'decision-index.json'), null);
});

