import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

import { runCli } from '../src/cli.js';
import { buildTraceabilityClauseMap } from '../src/traceability.js';

const execFileAsync = promisify(execFile);

async function git(repo, args) {
  return execFileAsync('git', args, { cwd: repo, encoding: 'utf8' });
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'));
}

async function writeJson(filePath, value) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

const STORY_DOC = '---\nstory_id: story-test-promo\ntitle: Promotion story\n---\n\n# Story\n\n## Background\nTest.\n\n## Acceptance Criteria\n- Touch README only.\n';

async function setupPrepareRepo() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vibepro-trace-promo-'));
  await writeFile(path.join(root, 'index.html'), '<!doctype html><title>Test</title>');
  await git(root, ['init', '-b', 'main']);
  await git(root, ['config', 'user.email', 'vibepro@example.com']);
  await git(root, ['config', 'user.name', 'VibePro Test']);
  await runCli(['init', root, '--story-id', 'story-test-promo', '--title', 'Promotion story']);
  await mkdir(path.join(root, 'docs', 'management', 'stories', 'active'), { recursive: true });
  await writeFile(path.join(root, 'docs', 'management', 'stories', 'active', 'story-test-promo.md'), STORY_DOC);
  await git(root, ['add', '.']);
  await git(root, ['commit', '-m', 'init']);
  await git(root, ['switch', '-c', 'feature/promo']);
  await writeFile(path.join(root, 'README.md'), '# Hello\n');
  await git(root, ['add', 'README.md']);
  await git(root, ['commit', '-m', 'feat: add README']);
  return root;
}

function traceabilityPath(root, storyId) {
  return path.join(root, '.vibepro', 'pr', storyId, 'traceability.json');
}

function evidenceRefs(traceability, type) {
  return traceability.evidence.filter((item) => item.type === type).map((item) => item.ref);
}

test('pr prepare sets story_doc_path and connects artifact evidence', async () => {
  const root = await setupPrepareRepo();
  await runCli([
    'pr',
    'prepare',
    root,
    '--story-id',
    'story-test-promo',
    '--base',
    'main',
    '--evidence-depth',
    'full',
    '--evidence-depth-reason',
    'traceability promotion test asserts standalone gate dag artifact',
    '--evidence-depth-consumer',
    'traceability-promotion-test',
    '--json'
  ]);
  const traceability = await readJson(traceabilityPath(root, 'story-test-promo'));
  const gateDag = await readJson(path.join(root, '.vibepro', 'pr', 'story-test-promo', 'gate-dag.json'));
  const prBody = await readFile(path.join(root, '.vibepro', 'pr', 'story-test-promo', 'pr-body.md'), 'utf8');
  assert.equal(traceability.story_doc_path, 'docs/management/stories/active/story-test-promo.md');
  assert.equal(traceability.lifecycle, 'in_progress');
  const refs = evidenceRefs(traceability, 'pr_artifact');
  assert.ok(refs.some((ref) => ref.endsWith('pr-body.md')), 'pr-body.md must be linked');
  assert.ok(refs.some((ref) => ref.endsWith('gate-dag.json')), 'gate-dag.json must be linked');
  assert.ok(!refs.some((ref) => ref.endsWith('verification-evidence.json')), 'absent verification evidence must not be linked');
  assert.equal(traceability.acceptance_criteria.length, 1);
  assert.equal(traceability.acceptance_criteria[0].id, 'AC-1');
  assert.equal(traceability.acceptance_criteria[0].status, 'weakly_mapped');
  assert.equal(traceability.coverage_summary.weakly_mapped_count, 1);
  assert.equal(traceability.coverage_summary.mapped_count, 0);
  assert.equal(gateDag.summary.traceability_clause_coverage.weakly_mapped_count, 1);
  assert.equal(gateDag.nodes.find((node) => node.id === 'gate:traceability_clause_coverage').status, 'needs_evidence');
  assert.match(prBody, /weakly_mapped: 1/);
});

test('pr prepare links verification evidence when present and stays idempotent on rerun', async () => {
  const root = await setupPrepareRepo();
  await runCli([
    'verify', 'record', root, '--id', 'story-test-promo', '--kind', 'unit', '--status', 'pass',
    '--command', 'node --test test/readme.test.js', '--target', 'README.md', '--observed', 'exit_code=0'
  ]);
  await runCli(['pr', 'prepare', root, '--story-id', 'story-test-promo', '--base', 'main', '--json']);
  const first = await readJson(traceabilityPath(root, 'story-test-promo'));
  assert.ok(
    evidenceRefs(first, 'pr_artifact').some((ref) => ref.endsWith('verification-evidence.json')),
    'existing verification evidence must be linked'
  );
  assert.equal(first.acceptance_criteria[0].status, 'mapped');
  assert.equal(first.acceptance_criteria[0].mapped_evidence.length, 1);
  assert.equal(first.coverage_summary.mapped_count, 1);
  assert.equal(first.coverage_summary.weakly_mapped_count, 0);
  await runCli(['pr', 'prepare', root, '--story-id', 'story-test-promo', '--base', 'main', '--json']);
  const second = await readJson(traceabilityPath(root, 'story-test-promo'));
  assert.equal(second.evidence.length, first.evidence.length, 'rerun must not duplicate evidence');
  assert.equal(second.created_at, first.created_at, 'created_at must be preserved');
});

test('clause map keeps unmapped AC and scenario clauses visible', () => {
  const storyText = [
    '# Story',
    '',
    '## Acceptance Criteria',
    '- AC-backed evidence is present.',
    '- Missing clause-specific evidence remains visible.'
  ].join('\n');
  const map = buildTraceabilityClauseMap({
    storyText,
    changedFiles: [],
    tests: [],
    evidence: [{
      type: 'verification_evidence',
      ref: 'test/ac-backed.test.js',
      summary: 'AC-backed evidence is present',
      strength: 'supporting',
      binding_status: 'current',
      artifact_quality: 'verified',
      current_head_sha: 'abc123',
      targets: ['AC-1']
    }],
    scenarioClauses: [{
      id: 'S-001',
      statement: 'Scenario clause needs replay coverage.'
    }]
  });
  assert.equal(map.acceptance_criteria[0].status, 'mapped');
  assert.equal(map.acceptance_criteria[0].mapped_evidence[0].binding_status, 'current');
  assert.equal(map.acceptance_criteria[0].mapped_evidence[0].current_head_sha, 'abc123');
  assert.equal(map.acceptance_criteria[1].status, 'unmapped');
  assert.equal(map.scenario_clauses[0].status, 'unmapped');
});

test('broad verification command and artifact paths do not map every AC', () => {
  const storyText = [
    '# Story',
    '',
    '## Acceptance Criteria',
    '- PR body, Gate DAG, and usage report show unmapped counts.',
    '- Generic broad suite must not satisfy this clause.'
  ].join('\n');
  const map = buildTraceabilityClauseMap({
    storyText,
    changedFiles: [],
    tests: [],
    evidence: [{
      type: 'verification_evidence',
      ref: '.vibepro/manual-verification/story/focused.tap',
      summary: 'node --test test/traceability-promotion.test.js test/traceability-usage-report.test.js',
      strength: 'supporting',
      binding_status: 'current',
      artifact_quality: 'unrecognized',
      targets: [
        'node --test test/traceability-promotion.test.js test/traceability-usage-report.test.js',
        '.vibepro/manual-verification/story/focused.tap'
      ]
    }]
  });
  assert.equal(map.acceptance_criteria[0].status, 'unmapped');
  assert.equal(map.acceptance_criteria[1].status, 'unmapped');
});

async function makeFakeGhMerge(state) {
  const binDir = await mkdtemp(path.join(os.tmpdir(), 'vibepro-promo-gh-bin-'));
  const ghPath = path.join(binDir, 'gh');
  const statePath = path.join(binDir, 'state.json');
  await writeJson(statePath, state);
  await writeFile(ghPath, `#!/usr/bin/env node
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
const statePath = ${JSON.stringify(statePath)};
const args = process.argv.slice(2);
const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
if (args[0] !== 'pr') {
  process.stderr.write('unexpected gh command: ' + args.join(' '));
  process.exit(1);
}
if (args[1] === 'view') {
  const merged = state.merged === true;
  const fieldsArg = args[args.indexOf('--json') + 1] || '';
  if (fieldsArg.includes('mergedAt')) {
    console.log(JSON.stringify({
      url: state.url,
      state: merged ? 'MERGED' : 'OPEN',
      mergedAt: merged ? state.mergedAt : null,
      mergeCommit: merged ? { oid: state.mergeCommit } : null
    }));
    process.exit(0);
  }
  console.log(JSON.stringify({
    url: state.url,
    state: merged ? 'MERGED' : 'OPEN',
    isDraft: false,
    mergeStateStatus: merged ? 'UNKNOWN' : state.mergeStateStatus,
    reviewDecision: state.reviewDecision,
    headRefName: state.headRefName,
    headRefOid: state.headRefOid,
    baseRefName: state.baseRefName,
    statusCheckRollup: state.statusCheckRollup
  }));
  process.exit(0);
}
if (args[1] === 'merge') {
  state.merged = true;
  if (state.remotePath) {
    execFileSync('git', [
      '--git-dir',
      state.remotePath,
      'update-ref',
      'refs/heads/' + state.baseRefName,
      state.headRefOid
    ]);
    state.mergeCommit = state.headRefOid;
  }
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2) + '\\n');
  console.log('merged');
  process.exit(0);
}
process.stderr.write('unexpected gh command: ' + args.join(' '));
process.exit(1);
`);
  await chmod(ghPath, 0o755);
  return { binDir };
}

async function setupMergeRepo() {
  const root = await setupPrepareRepo();
  const remote = await mkdtemp(path.join(os.tmpdir(), 'vibepro-promo-remote-'));
  await git(remote, ['init', '--bare']);
  await git(root, ['remote', 'add', 'origin', remote]);
  await git(root, ['push', '-u', 'origin', 'main']);
  await git(root, ['push', '-u', 'origin', 'feature/promo']);
  const headSha = (await git(root, ['rev-parse', 'HEAD'])).stdout.trim();
  const prDir = path.join(root, '.vibepro', 'pr', 'story-test-promo');
  await mkdir(prDir, { recursive: true });
  await writeJson(path.join(prDir, 'pr-prepare.json'), {
    story: { story_id: 'story-test-promo', title: 'Promotion story' },
    gate_status: { overall_status: 'ready_for_review', ready_for_pr_create: true },
    pr_context: { gate_dag: { overall_status: 'ready_for_review', nodes: [], summary: { needs_evidence_count: 0 } } },
    git: { base_ref: 'main' }
  });
  await writeJson(path.join(prDir, 'pr-create.json'), {
    schema_version: '0.1.0',
    created_at: '2026-06-12T00:00:00.000Z',
    mode: 'pr_create',
    dry_run: false,
    workspace_initialized: true,
    story: { story_id: 'story-test-promo', title: 'Promotion story' },
    output: { language: 'ja' },
    gate_dag: { overall_status: 'ready_for_review', nodes: [], summary: { needs_evidence_count: 0 } },
    execution_gate: { status: 'ready', pr_create_allowed: true, blocking_gates: [] },
    base: 'main',
    head: 'feature/promo',
    pr_url: 'https://github.example.test/unson/vibepro/pull/200',
    current_head_sha: headSha,
    artifact_freshness: {
      kind: 'pr_create',
      status: 'current',
      artifact_head_sha: headSha,
      current_head_sha: headSha
    },
    toolchain: { source_git: { commit: headSha } },
    results: []
  });
  await writeJson(traceabilityPath(root, 'story-test-promo'), {
    schema_version: '0.1.0',
    story_id: 'story-test-promo',
    story_doc_path: 'docs/management/stories/active/story-test-promo.md',
    source: 'pr_prepare',
    lifecycle: 'in_progress',
    evidence: [{ type: 'pr_artifact', ref: '.vibepro/pr/story-test-promo/pr-body.md', summary: 'pr prepare artifact' }],
    created_at: '2026-06-12T00:00:00.000Z',
    updated_at: '2026-06-12T00:00:00.000Z'
  });
  await runCli(['execute', 'reconcile', root, '--story-id', 'story-test-promo', '--base', 'main']);
  return { root, headSha, remote };
}

function ghState(headSha, merged = false) {
  return {
    url: 'https://github.example.test/unson/vibepro/pull/200',
    headRefName: 'feature/promo',
    headRefOid: headSha,
    baseRefName: 'main',
    mergeStateStatus: 'CLEAN',
    reviewDecision: '',
    statusCheckRollup: [{ name: 'test', status: 'COMPLETED', conclusion: 'SUCCESS', workflowName: 'CI' }],
    mergeCommit: '59bad39e41e9a158338fa72bb262b4fa64c594ff',
    mergedAt: '2026-06-12T01:00:00Z',
    merged
  };
}

test('execute merge promotes traceability lifecycle to merged with merge evidence', async () => {
  const { root, headSha, remote } = await setupMergeRepo();
  const gh = await makeFakeGhMerge({
    ...ghState(headSha),
    mergeCommit: headSha,
    remotePath: remote
  });
  const result = await runCli(
    ['execute', 'merge', root, '--story-id', 'story-test-promo', '--base', 'main', '--json'],
    { env: { ...process.env, PATH: `${gh.binDir}${path.delimiter}${process.env.PATH}` } }
  );
  assert.equal(result.exitCode, 0);
  assert.equal(result.result.merge.status, 'merged');
  const traceability = await readJson(traceabilityPath(root, 'story-test-promo'));
  assert.equal(traceability.lifecycle, 'merged');
  assert.equal(traceability.source, 'execute_merge');
  assert.equal(traceability.created_at, '2026-06-12T00:00:00.000Z', 'created_at must be preserved');
  assert.ok(
    traceability.evidence.some((item) => item.type === 'pr_artifact' && item.ref.endsWith('pr-body.md')),
    'prior evidence must be preserved'
  );
  const mergeEvidence = traceability.evidence.find((item) => item.type === 'pr_merge');
  assert.ok(mergeEvidence, 'pr_merge evidence must be added');
  assert.ok(mergeEvidence.ref.endsWith('pr-merge.json'));
  assert.match(mergeEvidence.summary, /pull\/200/);
});

test('execute merge dry-run does not touch traceability', async () => {
  const { root, headSha } = await setupMergeRepo();
  const before = await readFile(traceabilityPath(root, 'story-test-promo'), 'utf8');
  const gh = await makeFakeGhMerge(ghState(headSha));
  const result = await runCli(
    ['execute', 'merge', root, '--story-id', 'story-test-promo', '--base', 'main', '--dry-run', '--json'],
    { env: { ...process.env, PATH: `${gh.binDir}${path.delimiter}${process.env.PATH}` } }
  );
  assert.equal(result.exitCode, 0);
  assert.equal(result.result.merge.status, 'dry_run_planned');
  const after = await readFile(traceabilityPath(root, 'story-test-promo'), 'utf8');
  assert.equal(after, before, 'dry-run must not modify traceability.json');
});

test('trace declare rejects merged lifecycle', async () => {
  const root = await setupPrepareRepo();
  const result = await runCli([
    'trace', 'declare', root, '--story-id', 'story-test-promo', '--lifecycle', 'merged', '--json'
  ]);
  assert.notEqual(result.exitCode, 0, 'merged is evidence-backed and must not be manually declarable');
});
