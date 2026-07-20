import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
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

async function writeJson(filePath, value) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

async function runCliWithStdout(args, io = {}) {
  let stdout = '';
  let stderr = '';
  const result = await runCli(args, {
    ...io,
    stdout: { write(chunk) { stdout += chunk; } },
    stderr: { write(chunk) { stderr += chunk; } }
  });
  return { ...result, stdout, stderr };
}

const STORY_DOC = `---
story_id: story-status-honesty
title: Status honesty story
---

# Story

## Background
Status output must match evidence.

## Acceptance Criteria
- execute merge reconciles merged PRs.
`;

// Fake gh that reports an ALREADY MERGED PR (the tool never merged it).
async function makeFakeGhAlreadyMerged(state) {
  const binDir = await mkdtemp(path.join(os.tmpdir(), 'vibepro-honesty-gh-bin-'));
  const ghPath = path.join(binDir, 'gh');
  const statePath = path.join(binDir, 'state.json');
  await writeJson(statePath, state);
  await writeFile(ghPath, `#!/usr/bin/env node
const fs = require('node:fs');
const statePath = ${JSON.stringify(statePath)};
const args = process.argv.slice(2);
const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
if (args[0] !== 'pr') {
  process.stderr.write('unexpected gh command: ' + args.join(' '));
  process.exit(1);
}
if (args[1] === 'view') {
  if (state.viewExitCode) {
    process.stderr.write(state.viewStderr || 'provider unavailable');
    process.exit(state.viewExitCode);
  }
  const fieldsArg = args[args.indexOf('--json') + 1] || '';
  if (fieldsArg.includes('mergedAt')) {
    console.log(JSON.stringify({
      url: state.url,
      state: 'MERGED',
      mergedAt: state.mergedAt,
      mergeCommit: state.mergeCommit ? { oid: state.mergeCommit } : null
    }));
    process.exit(0);
  }
  console.log(JSON.stringify({
    url: state.url,
    state: 'MERGED',
    isDraft: false,
    mergeStateStatus: 'UNKNOWN',
    reviewDecision: state.reviewDecision ?? '',
    headRefName: state.headRefName,
    headRefOid: state.headRefOid,
    baseRefName: state.baseRefName,
    statusCheckRollup: state.statusCheckRollup
  }));
  process.exit(0);
}
if (args[1] === 'merge') {
  process.stderr.write('gh pr merge must NOT run for an already-merged PR');
  process.exit(1);
}
process.stderr.write('unexpected gh command: ' + args.join(' '));
process.exit(1);
`);
  await chmod(ghPath, 0o755);
  return { binDir, statePath };
}

async function setupMergedPrRepo() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vibepro-honesty-'));
  await writeFile(path.join(root, 'index.html'), '<!doctype html><title>Test</title>');
  await git(root, ['init', '-b', 'main']);
  await git(root, ['config', 'user.email', 'vibepro@example.com']);
  await git(root, ['config', 'user.name', 'VibePro Test']);
  await runCli(['init', root, '--story-id', 'story-status-honesty', '--title', 'Status honesty story']);
  await mkdir(path.join(root, 'docs', 'management', 'stories', 'active'), { recursive: true });
  await writeFile(path.join(root, 'docs', 'management', 'stories', 'active', 'story-status-honesty.md'), STORY_DOC);
  await git(root, ['add', '.']);
  await git(root, ['commit', '-m', 'init']);
  await git(root, ['switch', '-c', 'feature/honesty']);
  await writeFile(path.join(root, 'README.md'), '# Hello\n');
  await git(root, ['add', 'README.md']);
  await git(root, ['commit', '-m', 'feat: add README']);
  const headSha = (await git(root, ['rev-parse', 'HEAD'])).stdout.trim();

  const remote = await mkdtemp(path.join(os.tmpdir(), 'vibepro-honesty-remote-'));
  await git(remote, ['init', '--bare']);
  await git(root, ['remote', 'add', 'origin', remote]);
  await git(root, ['push', '-u', 'origin', 'main']);
  await git(root, ['push', '-u', 'origin', 'feature/honesty']);

  // Simulate the external squash merge: create a separate commit on origin/main
  // whose tree includes the feature change but whose sha differs from the branch head.
  await git(root, ['switch', 'main']);
  await git(root, ['merge', '--squash', 'feature/honesty']);
  await git(root, ['commit', '-m', 'story-status-honesty - squashed externally (#999)']);
  const mergeCommitSha = (await git(root, ['rev-parse', 'HEAD'])).stdout.trim();
  await git(root, ['push', 'origin', 'main']);
  await git(root, ['switch', 'feature/honesty']);

  const prDir = path.join(root, '.vibepro', 'pr', 'story-status-honesty');
  await mkdir(prDir, { recursive: true });
  await writeJson(path.join(prDir, 'pr-prepare.json'), {
    story: { story_id: 'story-status-honesty', title: 'Status honesty story' },
    gate_status: {
      overall_status: 'ready_for_review',
      ready_for_pr_create: true,
      unresolved_gates: [],
      critical_unresolved_gates: []
    },
    pr_context: { gate_dag: { overall_status: 'ready_for_review', nodes: [], summary: { needs_evidence_count: 0 } } },
    git: { base_ref: 'main', head_sha: headSha },
    toolchain: { source_git: { commit: headSha } }
  });
  await writeJson(path.join(prDir, 'pr-create.json'), {
    schema_version: '0.1.0',
    created_at: '2026-07-10T00:00:00.000Z',
    mode: 'pr_create',
    dry_run: false,
    workspace_initialized: true,
    story: { story_id: 'story-status-honesty', title: 'Status honesty story' },
    output: { language: 'ja' },
    gate_dag: { overall_status: 'ready_for_review', nodes: [], summary: { needs_evidence_count: 0 } },
    execution_gate: { status: 'ready', pr_create_allowed: true, blocking_gates: [] },
    base: 'main',
    head: 'feature/honesty',
    pr_url: 'https://github.example.test/unson/vibepro/pull/999',
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
  return { root, headSha, mergeCommitSha, remote };
}

test('DRS-CONTRACT-005 execute status quarantines corrupt state and fails instead of reporting a false query success', async () => {
  const { root } = await setupMergedPrRepo();
  const executionDir = path.join(root, '.vibepro', 'executions', 'story-status-honesty');
  const statePath = path.join(executionDir, 'state.json');
  await mkdir(executionDir, { recursive: true });
  await writeFile(statePath, '{ malformed execution state');

  const result = await runCliWithStdout([
    'execute', 'status', root, '--story-id', 'story-status-honesty', '--base', 'main', '--json'
  ]);

  assert.equal(result.exitCode, 1);
  assert.equal(result.stdout, '');
  const envelope = JSON.parse(result.stderr);
  assert.equal(envelope.ok, false);
  assert.equal(envelope.error.code, 'execution_state_corrupt');
  assert.equal(envelope.error.status, 'quarantined');
  assert.equal(envelope.error.story_id, 'story-status-honesty');
  assert.match(envelope.error.message, /execution state JSON is corrupt/);
  assert.match(envelope.error.message, /Moved it to/);
  assert.match(envelope.error.recovery.start_command, /execute start/);
  await assert.rejects(readFile(statePath, 'utf8'), { code: 'ENOENT' });
  const quarantined = (await readdir(executionDir)).filter((name) => name.startsWith('state.json.corrupt-'));
  assert.equal(quarantined.length, 1);
  assert.equal(await readFile(path.join(executionDir, quarantined[0]), 'utf8'), '{ malformed execution state');
});

test('DRS-CONTRACT-005 execute status fails closed when execution state is missing', async () => {
  const { root } = await setupMergedPrRepo();

  const result = await runCliWithStdout([
    'execute', 'status', root, '--story-id', 'story-status-honesty', '--base', 'main', '--json'
  ]);

  assert.equal(result.exitCode, 1);
  assert.equal(result.stdout, '');
  const envelope = JSON.parse(result.stderr);
  assert.equal(envelope.ok, false);
  assert.equal(envelope.error.code, 'execution_state_missing');
  assert.equal(envelope.error.status, 'not_found');
  assert.equal(envelope.error.story_id, 'story-status-honesty');
  assert.match(envelope.error.message, /Execution state is missing/);
  assert.match(envelope.error.recovery.start_command, /execute start/);
  assert.equal('reconcile_command' in envelope.error.recovery, false);
});

test('DRS-CONTRACT-005 execute status preserves valid execution-state bytes', async () => {
  const { root } = await setupMergedPrRepo();
  await runCli([
    'execute', 'start', root, '--story-id', 'story-status-honesty', '--base', 'main'
  ]);
  const statePath = path.join(root, '.vibepro', 'executions', 'story-status-honesty', 'state.json');
  const before = await readFile(statePath, 'utf8');

  const result = await runCliWithStdout([
    'execute', 'status', root, '--story-id', 'story-status-honesty', '--base', 'main', '--json'
  ]);

  assert.equal(result.exitCode, 0);
  assert.doesNotThrow(() => JSON.parse(result.stdout));
  assert.equal(result.stderr, '');
  assert.equal(await readFile(statePath, 'utf8'), before);
});

test('GDO-S-3 execute merge fails closed on a corrupt local gate outcome ledger without losing verified delivery', async (t) => {
  const cases = [
    {
      name: 'malformed JSON',
      contents: '{"schema_version":"0.1.0","model":',
      reason: 'local_gate_outcome_ledger_parse_failed'
    },
    {
      name: 'wrong model',
      contents: JSON.stringify({
        schema_version: '0.1.0',
        model: 'vibepro-gate-outcome-ledger-v999',
        entries: []
      }),
      reason: 'local_gate_outcome_ledger_model_invalid'
    },
    {
      name: 'wrong entries shape',
      contents: JSON.stringify({
        schema_version: '0.1.0',
        model: 'vibepro-gate-outcome-ledger-v3',
        entries: {}
      }),
      reason: 'local_gate_outcome_ledger_shape_invalid'
    }
  ];

  for (const fixture of cases) {
    await t.test(fixture.name, async () => {
      const { root, headSha, mergeCommitSha } = await setupMergedPrRepo();
      const ledgerDir = path.join(root, '.vibepro', 'gate-outcomes');
      await mkdir(ledgerDir, { recursive: true });
      await writeFile(path.join(ledgerDir, 'ledger.json'), fixture.contents);
      const gh = await makeFakeGhAlreadyMerged({
        url: 'https://github.example.test/unson/vibepro/pull/999',
        headRefName: 'feature/honesty',
        headRefOid: headSha,
        baseRefName: 'main',
        mergedAt: '2026-07-10T01:23:45Z',
        mergeCommit: mergeCommitSha,
        statusCheckRollup: [{ name: 'test', status: 'COMPLETED', conclusion: 'SUCCESS', workflowName: 'CI' }]
      });

      const result = await runCli(
        ['execute', 'merge', root, '--story-id', 'story-status-honesty', '--base', 'main', '--json'],
        { env: { ...process.env, PATH: `${gh.binDir}${path.delimiter}${process.env.PATH}` } }
      );

      assert.equal(result.exitCode, 2);
      const merge = result.result.merge;
      assert.equal(merge.status, 'merged_externally');
      assert.equal(merge.delivery.status, 'merged_externally');
      assert.equal(merge.delivery.merge_commit_sha, mergeCommitSha);
      assert.equal(merge.merge_commit_sha, mergeCommitSha);
      assert.equal(merge.decision_outcome_binding.status, 'failed');
      assert.equal(merge.decision_outcome_binding.reason, fixture.reason);
      assert.equal(merge.decision_outcome_binding.expected_entry_count, null);
      assert.equal(merge.decision_outcome_binding.delivery.status, 'merged_externally');
      assert.equal(merge.decision_outcome_binding.delivery.merge_commit_sha, mergeCommitSha);
      assert.equal(merge.roi_ledger_promotion.status, 'failed');
      assert.equal(merge.roi_ledger_promotion.reason, fixture.reason);
      assert.equal(merge.reconciliation.status, 'reconciliation_required');
      assert.equal(merge.reconciliation.reasons.includes('decision_outcome_binding_failed'), true);
      assert.equal(merge.stop_reason, 'decision_outcome_binding_failed');
    });
  }
});

test('DRS-STORY-S-002 story-vibepro-delivery-reconciliation-state:S-004 DRS-SCENARIO-001 DRS-S-4 DRS-S-6 execute merge reconciles an already-merged PR as merged_externally with a full merge record', async () => {
  const { root, headSha, mergeCommitSha } = await setupMergedPrRepo();
  const providerState = {
    url: 'https://github.example.test/unson/vibepro/pull/999',
    headRefName: 'feature/honesty',
    headRefOid: headSha,
    baseRefName: 'main',
    mergedAt: '2026-07-10T01:23:45Z',
    mergeCommit: mergeCommitSha,
    statusCheckRollup: [{ name: 'test', status: 'COMPLETED', conclusion: 'SUCCESS', workflowName: 'CI' }]
  };
  const gh = await makeFakeGhAlreadyMerged(providerState);

  const env = { ...process.env, PATH: `${gh.binDir}${path.delimiter}${process.env.PATH}` };
  const result = await runCli(
    ['execute', 'merge', root, '--story-id', 'story-status-honesty', '--base', 'main', '--json'],
    { env }
  );

  assert.equal(result.exitCode, 0);
  const merge = result.result.merge;
  assert.equal(merge.status, 'merged_externally');
  assert.equal(merge.stop_reason, null);
  assert.equal(merge.merge_commit_sha, mergeCommitSha);
  assert.equal(merge.merged_at, '2026-07-10T01:23:45Z');
  assert.equal(merge.delivery.status, 'merged_externally');
  assert.equal(merge.delivery.merge_commit_sha, mergeCommitSha);
  assert.equal(merge.reconciliation.status, 'reconciled');
  assert.deepEqual(merge.reconciliation.reasons, []);
  assert.equal(merge.warnings.some((w) => /merged externally|already merged/i.test(w)), true);

  const artifact = await readJson(path.join(root, '.vibepro', 'pr', 'story-status-honesty', 'pr-merge.json'));
  assert.equal(artifact.status, 'merged_externally');
  assert.equal(artifact.merge_commit_sha, mergeCommitSha);

  const traceability = await readJson(path.join(root, '.vibepro', 'pr', 'story-status-honesty', 'traceability.json'));
  assert.equal(traceability.lifecycle, 'merged');
  assert.equal(traceability.source, 'execute_merge');

  const replay = await runCli(
    ['execute', 'merge', root, '--story-id', 'story-status-honesty', '--base', 'main', '--json'],
    { env }
  );
  assert.equal(replay.exitCode, 0, JSON.stringify(replay.result.merge));
  assert.equal(replay.result.merge.status, 'merged_externally');
  assert.equal(replay.result.merge.merge_commit_sha, mergeCommitSha);
  assert.equal(replay.result.merge.delivery.status, merge.delivery.status);
  assert.equal(replay.result.merge.delivery.source, merge.delivery.source);
  assert.equal(replay.result.merge.delivery.pr_url, merge.delivery.pr_url);
  assert.equal(replay.result.merge.delivery.merge_commit_sha, merge.delivery.merge_commit_sha);
  assert.equal(replay.result.merge.delivery.merged_at, merge.delivery.merged_at);
  assert.equal(replay.result.merge.reconciliation.status, merge.reconciliation.status);
  assert.deepEqual(replay.result.merge.reconciliation.reasons, merge.reconciliation.reasons);
  assert.equal(replay.result.merge.reconciliation.head_sha, merge.reconciliation.head_sha);

  const replayedArtifact = await readJson(path.join(root, '.vibepro', 'pr', 'story-status-honesty', 'pr-merge.json'));
  assert.equal(replayedArtifact.status, artifact.status);
  assert.equal(replayedArtifact.merge_commit_sha, artifact.merge_commit_sha);
  const replayedTraceability = await readJson(path.join(root, '.vibepro', 'pr', 'story-status-honesty', 'traceability.json'));
  assert.equal(replayedTraceability.lifecycle, 'merged');
  assert.equal(replayedTraceability.source, 'execute_merge');

  await writeJson(gh.statePath, {
    ...providerState,
    viewExitCode: 7,
    viewStderr: 'provider unavailable during retry'
  });
  const failedObservation = await runCli(
    ['execute', 'merge', root, '--story-id', 'story-status-honesty', '--base', 'main', '--json'],
    { env }
  );
  assert.equal(failedObservation.exitCode, 2);
  assert.equal(failedObservation.result.merge.stop_reason, 'pr_view_failed');
  assert.equal(failedObservation.result.merge.delivery.status, 'merged_externally');
  assert.equal(failedObservation.result.merge.delivery.merge_commit_sha, mergeCommitSha);
  assert.equal(failedObservation.result.merge.reconciliation.status, 'reconciliation_required');
  assert.deepEqual(failedObservation.result.merge.reconciliation.reasons, ['provider_command_failed']);

  const failedObservationArtifact = await readJson(path.join(root, '.vibepro', 'pr', 'story-status-honesty', 'pr-merge.json'));
  assert.equal(failedObservationArtifact.delivery.status, 'merged_externally');
  assert.equal(failedObservationArtifact.delivery.merge_commit_sha, mergeCommitSha);
  const { stdout: excludePathText } = await git(root, ['rev-parse', '--git-path', 'info/exclude']);
  const excludePath = path.resolve(root, excludePathText.trim());
  await writeFile(excludePath, '# operator-owned exclude bytes\n');
  const excludeBeforeStatus = await readFile(excludePath, 'utf8');
  const statusAfterFailure = await runCli([
    'execute', 'status', root, '--story-id', 'story-status-honesty', '--base', 'main', '--json'
  ]);
  assert.equal(statusAfterFailure.exitCode, 0);
  assert.equal(statusAfterFailure.result.state.completion_status, 'merged_reconciliation_required');
  assert.equal(statusAfterFailure.result.state.delivery.status, 'merged_externally');
  assert.equal(statusAfterFailure.result.state.reconciliation.status, 'reconciliation_required');
  assert.equal(await readFile(excludePath, 'utf8'), excludeBeforeStatus);
});

test('DRS-STORY-UNVERIFIED-004 story-vibepro-delivery-reconciliation-state:S-006 DRS-SCENARIO-003 DRS-S-2 DRS-S-6 execute merge stays blocked with an explicit reason when the merged PR commit is not on origin/base', async () => {
  const { root, headSha } = await setupMergedPrRepo();
  const gh = await makeFakeGhAlreadyMerged({
    url: 'https://github.example.test/unson/vibepro/pull/999',
    headRefName: 'feature/honesty',
    headRefOid: headSha,
    baseRefName: 'main',
    mergedAt: '2026-07-10T01:23:45Z',
    mergeCommit: '0123456789abcdef0123456789abcdef01234567',
    statusCheckRollup: [{ name: 'test', status: 'COMPLETED', conclusion: 'SUCCESS', workflowName: 'CI' }]
  });

  const result = await runCli(
    ['execute', 'merge', root, '--story-id', 'story-status-honesty', '--base', 'main', '--json'],
    { env: { ...process.env, PATH: `${gh.binDir}${path.delimiter}${process.env.PATH}` } }
  );

  assert.equal(result.exitCode, 2);
  const merge = result.result.merge;
  assert.equal(merge.status, 'blocked');
  assert.equal(merge.stop_reason, 'pr_merged_externally_unverified');
  assert.equal(merge.delivery.status, 'unverified');
  assert.equal(merge.reconciliation.status, 'blocked');
  assert.deepEqual(merge.reconciliation.reasons, ['delivery_not_verified']);
  const manifest = await readJson(path.join(root, '.vibepro', 'vibepro-manifest.json'));
  const manifestMerge = manifest.pr_merges['story-status-honesty'];
  assert.equal(manifestMerge.latest_status, 'blocked');
  assert.equal(manifestMerge.latest_delivery.status, 'unverified');
  assert.equal(manifestMerge.latest_reconciliation.status, 'blocked');
});

test('DRS-STORY-S-003 story-vibepro-delivery-reconciliation-state:S-005 DRS-SCENARIO-002 DRS-S-3 DRS-S-5 DRS-S-6 execute merge preserves verified delivery while failing closed on current gate drift', async () => {
  const { root, headSha, mergeCommitSha } = await setupMergedPrRepo();
  const prDir = path.join(root, '.vibepro', 'pr', 'story-status-honesty');
  const prPreparePath = path.join(prDir, 'pr-prepare.json');
  const prPrepare = await readJson(prPreparePath);
  prPrepare.pr_context.gate_dag = {
    overall_status: 'blocked',
    nodes: [{ id: 'gate:verification', status: 'needs_evidence' }],
    summary: { needs_evidence_count: 1 }
  };
  await writeJson(prPreparePath, prPrepare);
  const gh = await makeFakeGhAlreadyMerged({
    url: 'https://github.example.test/unson/vibepro/pull/999',
    headRefName: 'feature/honesty',
    headRefOid: headSha,
    baseRefName: 'main',
    mergedAt: '2026-07-10T01:23:45Z',
    mergeCommit: mergeCommitSha,
    statusCheckRollup: [{ name: 'test', status: 'COMPLETED', conclusion: 'SUCCESS', workflowName: 'CI' }]
  });

  const result = await runCli(
    ['execute', 'merge', root, '--story-id', 'story-status-honesty', '--base', 'main', '--json'],
    { env: { ...process.env, PATH: `${gh.binDir}${path.delimiter}${process.env.PATH}` } }
  );

  assert.equal(result.exitCode, 2);
  const merge = result.result.merge;
  assert.equal(merge.status, 'merged_externally');
  assert.equal(merge.stop_reason, 'delivery_reconciliation_required');
  assert.equal(merge.delivery.status, 'merged_externally');
  assert.equal(merge.delivery.merge_commit_sha, mergeCommitSha);
  assert.equal(merge.reconciliation.status, 'reconciliation_required');
  assert.deepEqual(merge.reconciliation.reasons, ['gate_not_ready']);

  const traceability = await readJson(path.join(prDir, 'traceability.json'));
  assert.equal(traceability.lifecycle, 'merged');

  const executionState = await readJson(path.join(root, '.vibepro', 'executions', 'story-status-honesty', 'state.json'));
  assert.equal(executionState.completion_status, 'merged_reconciliation_required');
  assert.equal(executionState.current_phase, 'reconcile_delivery');
  assert.equal(executionState.delivery.status, 'merged_externally');
  assert.equal(executionState.reconciliation.status, 'reconciliation_required');
  assert.equal(executionState.blocking_gate.id, 'delivery_reconciliation');

  const statusResult = await runCli([
    'execute', 'status', root, '--story-id', 'story-status-honesty', '--base', 'main', '--json'
  ]);
  assert.equal(statusResult.exitCode, 0);
  assert.equal(statusResult.result.state.completion_status, 'merged_reconciliation_required');
  assert.equal(statusResult.result.state.current_phase, 'reconcile_delivery');
  assert.equal(statusResult.result.state.delivery.status, 'merged_externally');
  assert.equal(statusResult.result.state.reconciliation.status, 'reconciliation_required');
  assert.equal(statusResult.result.state.blocking_gate.id, 'delivery_reconciliation');

  const reconcileResult = await runCli([
    'execute', 'reconcile', root, '--story-id', 'story-status-honesty', '--base', 'main', '--json'
  ]);
  assert.equal(reconcileResult.exitCode, 2);
  assert.equal(reconcileResult.result.state.completion_status, 'merged_reconciliation_required');
  assert.equal(reconcileResult.result.state.current_phase, 'reconcile_delivery');
  assert.equal(reconcileResult.result.state.reconciliation.status, 'reconciliation_required');
});

test('DRS-CONTRACT-003 external delivery reports the complete reconciliation drift matrix', async () => {
  const { root, headSha, mergeCommitSha } = await setupMergedPrRepo();
  const prDir = path.join(root, '.vibepro', 'pr', 'story-status-honesty');
  const prPreparePath = path.join(prDir, 'pr-prepare.json');
  const prPrepare = await readJson(prPreparePath);
  prPrepare.pr_context.gate_dag = {
    overall_status: 'blocked',
    nodes: [{ id: 'gate:verification', status: 'needs_evidence' }],
    summary: { needs_evidence_count: 1 }
  };
  await writeJson(prPreparePath, prPrepare);
  await writeFile(path.join(root, 'dirty.txt'), 'uncommitted reconciliation drift\n');
  const gh = await makeFakeGhAlreadyMerged({
    url: 'https://github.example.test/unson/vibepro/pull/999',
    headRefName: 'feature/honesty',
    headRefOid: 'ffffffffffffffffffffffffffffffffffffffff',
    baseRefName: 'main',
    mergedAt: '2026-07-10T01:23:45Z',
    mergeCommit: mergeCommitSha,
    reviewDecision: 'CHANGES_REQUESTED',
    statusCheckRollup: [{ name: 'test', status: 'COMPLETED', conclusion: 'FAILURE', workflowName: 'CI' }]
  });

  const result = await runCli(
    ['execute', 'merge', root, '--story-id', 'story-status-honesty', '--base', 'main', '--json'],
    { env: { ...process.env, PATH: `${gh.binDir}${path.delimiter}${process.env.PATH}` } }
  );

  assert.equal(result.exitCode, 2);
  assert.equal(result.result.merge.delivery.status, 'merged_externally');
  assert.equal(result.result.merge.reconciliation.status, 'reconciliation_required');
  assert.deepEqual(result.result.merge.reconciliation.reasons, [
    'gate_not_ready',
    'dirty_worktree',
    'remote_head_mismatch',
    'checks_not_ready',
    'review_policy_not_satisfied'
  ]);
  assert.equal(headSha.length, 40);
});

test('DRS-CONTRACT-003 stale ready Gate DAG cannot override current blocked evidence', async () => {
  const { root, headSha, mergeCommitSha } = await setupMergedPrRepo();
  const prDir = path.join(root, '.vibepro', 'pr', 'story-status-honesty');
  const prPreparePath = path.join(prDir, 'pr-prepare.json');
  const prPrepare = await readJson(prPreparePath);
  prPrepare.pr_context.gate_dag = {
    overall_status: 'blocked',
    nodes: [{ id: 'gate:verification', status: 'needs_evidence' }],
    summary: { needs_evidence_count: 1 }
  };
  await writeJson(prPreparePath, prPrepare);
  await writeJson(path.join(prDir, 'gate-dag.json'), {
    overall_status: 'ready_for_review',
    nodes: [],
    summary: { needs_evidence_count: 0 },
    artifact_freshness: {
      status: 'current',
      artifact_head_sha: headSha
    }
  });
  const gh = await makeFakeGhAlreadyMerged({
    url: 'https://github.example.test/unson/vibepro/pull/999',
    headRefName: 'feature/honesty',
    headRefOid: headSha,
    baseRefName: 'main',
    mergedAt: '2026-07-10T01:23:45Z',
    mergeCommit: mergeCommitSha,
    statusCheckRollup: [{ name: 'test', status: 'COMPLETED', conclusion: 'SUCCESS', workflowName: 'CI' }]
  });

  const result = await runCli(
    ['execute', 'merge', root, '--story-id', 'story-status-honesty', '--base', 'main', '--json'],
    { env: { ...process.env, PATH: `${gh.binDir}${path.delimiter}${process.env.PATH}` } }
  );

  assert.equal(result.exitCode, 2);
  assert.equal(result.result.merge.delivery.status, 'merged_externally');
  assert.equal(result.result.merge.reconciliation.status, 'reconciliation_required');
  assert.deepEqual(result.result.merge.reconciliation.reasons, ['gate_not_ready']);
});

test('design-ssot init reports the real registry totals for a multi-root registry', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vibepro-honesty-dssot-'));
  await mkdir(path.join(root, 'docs', 'architecture'), { recursive: true });
  await writeFile(path.join(root, 'docs', 'architecture', 'root-a.md'), '# Root A\n');
  await writeFile(path.join(root, 'docs', 'architecture', 'root-b.md'), '# Root B\n');
  await writeFile(path.join(root, 'docs', 'architecture', 'root-c.md'), '# Root C\n');
  await writeJson(path.join(root, 'design-ssot.json'), {
    schema_version: '0.1.0',
    model: 'vibepro-design-ssot-registry-v1',
    design_roots: [
      {
        id: 'root-a',
        title: 'Root A',
        root_doc: 'docs/architecture/root-a.md',
        children: { spec: [{ kind: 'spec', path: 'docs/specs/root-a.md', required: true, relationship: 'implements' }] }
      },
      {
        id: 'root-b',
        title: 'Root B',
        root_doc: 'docs/architecture/root-b.md'
      }
    ]
  });

  const result = await runCliWithStdout([
    'design-ssot', 'init', root,
    '--id', 'root-c',
    '--root-doc', 'docs/architecture/root-c.md',
    '--title', 'Root C'
  ]);

  assert.equal(result.exitCode, 0, result.stderr);
  assert.match(result.stdout, /design_roots: 3/);
  assert.equal(result.result.registry_summary.design_root_count, 3);
  assert.equal(result.result.registry_summary.child_link_count, 1);

  const registry = await readJson(path.join(root, 'design-ssot.json'));
  assert.equal(registry.design_roots.length, 3);

  // Re-initializing an existing id must not inflate the count.
  const rerun = await runCliWithStdout([
    'design-ssot', 'init', root,
    '--id', 'root-c',
    '--root-doc', 'docs/architecture/root-c.md',
    '--title', 'Root C'
  ]);
  assert.equal(rerun.exitCode, 0, rerun.stderr);
  assert.match(rerun.stdout, /design_roots: 3/);
  assert.equal(rerun.result.registry_summary.design_root_count, 3);
});

test('design-ssot init on a fresh registry reports one root', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vibepro-honesty-dssot-fresh-'));
  await mkdir(path.join(root, 'docs', 'architecture'), { recursive: true });
  await writeFile(path.join(root, 'docs', 'architecture', 'only.md'), '# Only\n');

  const result = await runCliWithStdout([
    'design-ssot', 'init', root,
    '--id', 'only-root',
    '--root-doc', 'docs/architecture/only.md'
  ]);

  assert.equal(result.exitCode, 0, result.stderr);
  assert.match(result.stdout, /design_roots: 1/);
  assert.equal(result.result.registry_summary.design_root_count, 1);
});
