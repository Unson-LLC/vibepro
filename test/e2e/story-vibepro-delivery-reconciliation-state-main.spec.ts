import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

import { runCli as coreRunCli } from '../../src/cli.js';
import { executeMerge } from '../../src/merge-manager.js';

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(import.meta.dirname, '..', '..');

async function git(repo: string, args: string[]) {
  return execFileAsync('git', args, { cwd: repo, encoding: 'utf8' });
}

async function readJson(filePath: string) {
  return JSON.parse(await readFile(filePath, 'utf8'));
}

async function writeJson(filePath: string, value: unknown) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

async function makeAlreadyMergedProvider(state: Record<string, unknown>) {
  const binDir = await mkdtemp(path.join(os.tmpdir(), 'vibepro-delivery-public-gh-'));
  const ghPath = path.join(binDir, 'gh');
  await writeFile(ghPath, `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
const state = ${JSON.stringify(state)};
if (args[0] !== 'pr' || args[1] !== 'view') {
  process.stderr.write('unexpected gh command: ' + args.join(' '));
  process.exit(1);
}
const fields = args[args.indexOf('--json') + 1] || '';
if (fields.includes('mergedAt')) {
  if (state.syncFailurePath) fs.mkdirSync(state.syncFailurePath, { recursive: true });
  console.log(JSON.stringify({
    url: state.url,
    state: 'MERGED',
    mergedAt: state.mergedAt,
    mergeCommit: { oid: state.mergeCommit }
  }));
  process.exit(0);
}
console.log(JSON.stringify({
  url: state.url,
  state: 'MERGED',
  isDraft: false,
  mergeStateStatus: 'UNKNOWN',
  reviewDecision: '',
  headRefName: state.headRefName,
  headRefOid: state.headRefOid,
  baseRefName: state.baseRefName,
  statusCheckRollup: [{ name: 'test', status: 'COMPLETED', conclusion: 'SUCCESS', workflowName: 'CI' }]
}));
`);
  await chmod(ghPath, 0o755);
  return binDir;
}

async function setupPublicDeliveryFixture() {
  const storyId = 'story-public-delivery-reconciliation';
  const root = await mkdtemp(path.join(os.tmpdir(), 'vibepro-delivery-public-repo-'));
  await writeFile(path.join(root, 'index.html'), '<!doctype html><title>Delivery</title>');
  await git(root, ['init', '-b', 'main']);
  await git(root, ['config', 'user.email', 'vibepro@example.com']);
  await git(root, ['config', 'user.name', 'VibePro Test']);
  await coreRunCli(['init', root, '--story-id', storyId, '--title', 'Public delivery reconciliation']);
  const configPath = path.join(root, '.vibepro', 'config.json');
  const config = await readJson(configPath);
  config.artifact_routing = {
    artifacts: {
      pr: { canonical: 'docs/features/{story_id}/pr-prepare.json' }
    }
  };
  await writeJson(configPath, config);
  await mkdir(path.join(root, 'docs', 'management', 'stories', 'active'), { recursive: true });
  await writeFile(path.join(root, 'docs', 'management', 'stories', 'active', `${storyId}.md`), `---
story_id: ${storyId}
title: Public delivery reconciliation
---

# Story

Observed delivery must survive execution-state synchronization failure.
`);
  await git(root, ['add', '.']);
  await git(root, ['commit', '-m', 'init']);
  await git(root, ['switch', '-c', 'feature/public-delivery']);
  await writeFile(path.join(root, 'README.md'), '# Public delivery\n');
  await git(root, ['add', 'README.md']);
  await git(root, ['commit', '-m', 'feat: public delivery']);
  const headSha = (await git(root, ['rev-parse', 'HEAD'])).stdout.trim();

  const remote = await mkdtemp(path.join(os.tmpdir(), 'vibepro-delivery-public-remote-'));
  await git(remote, ['init', '--bare']);
  await git(root, ['remote', 'add', 'origin', remote]);
  await git(root, ['push', '-u', 'origin', 'main']);
  await git(root, ['push', '-u', 'origin', 'feature/public-delivery']);
  await git(root, ['switch', 'main']);
  await git(root, ['merge', '--squash', 'feature/public-delivery']);
  await git(root, ['commit', '-m', `${storyId} - merged externally`]);
  const mergeCommitSha = (await git(root, ['rev-parse', 'HEAD'])).stdout.trim();
  await git(root, ['push', 'origin', 'main']);
  await git(root, ['switch', 'feature/public-delivery']);

  const prDir = path.join(root, 'docs', 'features', storyId);
  await mkdir(prDir, { recursive: true });
  await writeJson(path.join(prDir, 'pr-prepare.json'), {
    story: { story_id: storyId, title: 'Public delivery reconciliation' },
    gate_status: { overall_status: 'ready_for_review', ready_for_pr_create: true },
    pr_context: { gate_dag: { overall_status: 'ready_for_review', nodes: [], summary: { needs_evidence_count: 0 } } },
    git: { base_ref: 'main', head_sha: headSha },
    toolchain: { source_git: { commit: headSha } }
  });
  const prUrl = 'https://github.example.test/unson/vibepro/pull/999';
  await writeJson(path.join(prDir, 'pr-create.json'), {
    schema_version: '0.1.0',
    created_at: '2026-07-19T00:00:00.000Z',
    mode: 'pr_create',
    dry_run: false,
    workspace_initialized: true,
    story: { story_id: storyId, title: 'Public delivery reconciliation' },
    output: { language: 'en' },
    gate_dag: { overall_status: 'ready_for_review', nodes: [], summary: { needs_evidence_count: 0 } },
    execution_gate: { status: 'ready', pr_create_allowed: true, blocking_gates: [] },
    base: 'main',
    head: 'feature/public-delivery',
    pr_url: prUrl,
    current_head_sha: headSha,
    artifact_freshness: { kind: 'pr_create', status: 'current', artifact_head_sha: headSha, current_head_sha: headSha },
    toolchain: { source_git: { commit: headSha } },
    results: []
  });
  const statePath = path.join(root, '.vibepro', 'executions', storyId, 'state.json');
  const ghBinDir = await makeAlreadyMergedProvider({
    url: prUrl,
    headRefName: 'feature/public-delivery',
    headRefOid: headSha,
    baseRefName: 'main',
    mergedAt: '2026-07-19T00:01:00Z',
    mergeCommit: mergeCommitSha,
    syncFailurePath: statePath
  });
  return { root, storyId, prUrl, mergeCommitSha, ghBinDir, prDir, statePath };
}

async function runFocused(files: string[], pattern?: string) {
  const args = ['--test'];
  if (pattern) args.push(`--test-name-pattern=${pattern}`);
  args.push(...files);
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  const result = await execFileAsync(process.execPath, args, {
    cwd: repoRoot,
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024,
    env
  });
  return `${result.stdout}\n${result.stderr}`;
}

test('delivery reconciliation workflow replays managed and external merge authority', async () => {
  const external = await runFocused(['test/cli-status-honesty.test.js']);

  // DRS-SCENARIO-004 / DRS-STORY-S-001 / S-003 / S-007: a managed merge is delivered only after post-merge base ancestry confirms it.
  const managed = await runFocused(
    ['test/vibepro-cli.test.js'],
    'CAA-VERIFY-001 execute merge completes merge artifacts'
  );
  assert.match(
    managed,
    /CAA-VERIFY-001 execute merge completes merge artifacts/,
    'DRS-SCENARIO-004 DRS-STORY-S-001 story-vibepro-delivery-reconciliation-state S-003 S-007 AC-6 managed workflow delivery'
  );

  // DRS-SCENARIO-001 / DRS-STORY-S-002: a clean external merge keeps immutable merged_externally delivery.
  assert.match(
    external,
    /DRS-STORY-S-002 story-vibepro-delivery-reconciliation-state:S-004 DRS-SCENARIO-001 .*already-merged PR as merged_externally/,
    'DRS-SCENARIO-001 DRS-STORY-S-002 story-vibepro-delivery-reconciliation-state:S-004 AC-2 AC-4 clean external delivery keeps expected topology reconciled'
  );

  // DRS-STORY-S-003: current gate drift preserves delivery and requires reconciliation.
  assert.match(
    external,
    /DRS-STORY-S-003 story-vibepro-delivery-reconciliation-state:S-005 DRS-SCENARIO-002 .*preserves verified delivery while failing closed on current gate drift/,
    'DRS-STORY-S-003 story-vibepro-delivery-reconciliation-state:S-005 DRS-SCENARIO-002 AC-1 AC-3 gate drift reconciliation'
  );

  // DRS-STORY-UNVERIFIED-004: a merge commit absent from origin/base remains unverified and blocked.
  assert.match(
    external,
    /DRS-STORY-UNVERIFIED-004 story-vibepro-delivery-reconciliation-state:S-006 DRS-SCENARIO-003 .*merged PR commit is not on origin\/base/,
    'DRS-STORY-UNVERIFIED-004 story-vibepro-delivery-reconciliation-state:S-006 DRS-SCENARIO-003 unverified delivery is blocked'
  );
});

test('delivery reconciliation workflow keeps recovery state and current evidence authority', async () => {
  const execution = await runFocused(['test/execution-state.test.js']);
  const transactionLock = await runFocused(
    ['test/story-transaction-lock.test.js'],
    'DRS-CONTRACT-008 LOCK-TOCTOU-001 paused initializer cannot overwrite a successor owner after resuming'
  );

  const providerFailure = await runFocused(
    ['test/vibepro-cli.test.js'],
    'DRS-SCENARIO-007 provider command and JSON failures persist blocked delivery evidence'
  );
  assert.match(
    providerFailure,
    /provider command and JSON failures persist blocked delivery evidence/,
    'DRS-STORY-S-006 story-vibepro-delivery-reconciliation-state S-010 AC-7 parse_failure provider_failure pr_lifecycle_regression'
  );

  // DRS-S-5 / DRS-CONTRACT-007: external delivery stays actionable without
  // manufacturing historical merge readiness.
  assert.match(
    execution,
    /preserves external delivery without inventing historical merge readiness/,
    'story-vibepro-delivery-reconciliation-state DRS-S-5 DRS-CONTRACT-007 external delivery remains actionable'
  );

  assert.match(
    execution,
    /prefers same-head pr-prepare over standalone ready Gate DAG/,
    'story-vibepro-delivery-reconciliation-state AC-4 expected topology does not override current evidence'
  );

  // DRS-STORY-S-005 / S-008: canonical persistence failure cannot erase observed delivery.
  assert.match(
    execution,
    /preserves delivered fact when canonical persistence fails/,
    'DRS-STORY-S-005 story-vibepro-delivery-reconciliation-state S-008 persistence recovery retains delivery'
  );

  // S-009: execution-state synchronization failure returns delivery plus a retry selector.
  const sync = await runFocused(
    ['test/vibepro-cli.test.js'],
    'DRS-CONTRACT-007 execute merge preserves observed delivery across execution-state synchronization failure'
  );
  assert.match(
    sync,
    /preserves observed delivery across execution-state synchronization failure/,
    'DRS-STORY-S-005 story-vibepro-delivery-reconciliation-state AC-7 S-009 retry_or_async_failure synchronization recovery retains delivery'
  );

  assert.match(
    execution,
    /prefers same-head pr-prepare over standalone ready Gate DAG/,
    'story-vibepro-delivery-reconciliation-state AC-7 evidence_lifecycle_regression VIBE-CORE-EV-001'
  );

  // AC-8 / DRS-CONTRACT-008: transaction fencing and owned rollback protect newer operator state.
  assert.match(
    transactionLock,
    /DRS-CONTRACT-008 LOCK-TOCTOU-001 paused initializer cannot overwrite a successor owner after resuming/,
    'story-vibepro-delivery-reconciliation-state AC-8 DRS-STORY-TXN-007 DRS-CONTRACT-008 generation fencing'
  );
  assert.match(
    execution,
    /DRS-CONTRACT-008 merge follow-up rollback restores only proven transaction-owned files/,
    'story-vibepro-delivery-reconciliation-state AC-8 DRS-STORY-TXN-007 DRS-CONTRACT-008 transaction-owned rollback'
  );

  // AC-9 / DRS-CONTRACT-009: configured and linked authorities converge without consuming legacy routes.
  assert.match(
    execution,
    /DRS-CONTRACT-009 linked artifact sync and rollback honor the configured PR route without consuming legacy authority/,
    'story-vibepro-delivery-reconciliation-state AC-9 DRS-STORY-ROUTE-008 DRS-CONTRACT-009 routed authority isolation'
  );
  assert.match(
    execution,
    /DRS-CONTRACT-009 linked-only observed authority is a valid compare-and-swap baseline/,
    'story-vibepro-delivery-reconciliation-state AC-9 DRS-STORY-ROUTE-008 DRS-CONTRACT-009 linked authority baseline'
  );
});

test('delivery reconciliation workflow projects both axes into operator handoff surfaces', async () => {
  const projections = await runFocused([
    'test/delivery-reconciliation-state.test.js',
    'test/traceability-usage-report.test.js',
    'test/canonical-audit-self-contained.test.js'
  ]);

  assert.match(
    projections,
    /human merge summary exposes immutable delivery and mutable reconciliation/,
    'story-vibepro-delivery-reconciliation-state AC-5 projection keeps immutable delivery and reconciliation follow-up separate'
  );
  assert.match(
    projections,
    /latest_reconciliation_status|canonical audit/i,
    'story-vibepro-delivery-reconciliation-state AC-5 traceability and canonical audit preserve reconciliation follow-up'
  );
});

test('shipped VibePro binary executes the public merge JSON contract', async () => {
  const fixtureRoot = await mkdtemp(path.join(os.tmpdir(), 'vibepro-delivery-binary-'));
  let failure: Error & { code?: number; stdout?: string; stderr?: string } | null = null;
  try {
    await execFileAsync(process.execPath, [
      path.join(repoRoot, 'bin', 'vibepro.js'),
      'execute',
      'merge',
      fixtureRoot,
      '--story-id',
      'story-vibepro-delivery-reconciliation-state',
      '--base',
      'main',
      '--json'
    ], {
      cwd: repoRoot,
      encoding: 'utf8',
      maxBuffer: 8 * 1024 * 1024
    });
  } catch (error) {
    failure = error as Error & { code?: number; stdout?: string; stderr?: string };
  }

  assert.equal(failure?.code, 2);
  const output = JSON.parse(failure?.stdout ?? '{}');
  assert.equal(output.mode, 'execute_merge');
  assert.equal(output.story.story_id, 'story-vibepro-delivery-reconciliation-state');
  assert.equal(output.delivery.status, 'unknown');
  assert.equal(output.status, 'blocked');
  assert.equal(output.stop_reason, 'pr_selector_missing');
});

test('execute merge early return carries its lock-bound persisted CAS baseline', async () => {
  const fixtureRoot = await mkdtemp(path.join(os.tmpdir(), 'vibepro-delivery-baseline-'));
  const result = await executeMerge(fixtureRoot, {
    storyId: 'story-vibepro-delivery-reconciliation-state',
    baseRef: 'main'
  });

  assert.equal(result.merge.stop_reason, 'pr_selector_missing');
  assert.deepEqual(result.execution_state_sync_baseline, await readJson(result.artifacts.pr_merge_json));
  assert.notStrictEqual(result.execution_state_sync_baseline, result.merge);
});

test('every execute merge exit shares the lock-bound persisted CAS baseline finalizer', async () => {
  const source = await readFile(path.join(repoRoot, 'src', 'merge-manager.js'), 'utf8');
  const lockedStart = source.indexOf('async function executeMergeLocked');
  const lockedEnd = source.indexOf('async function attachExecutionStateSyncBaseline');
  assert.notEqual(lockedStart, -1);
  assert.notEqual(lockedEnd, -1);

  const lockedBody = source.slice(lockedStart, lockedEnd);
  const baselineFinalizers = lockedBody.match(
    /return attachExecutionStateSyncBaseline\(merge, artifacts\);/g
  ) ?? [];

  assert.equal(baselineFinalizers.length, 12);
  assert.doesNotMatch(lockedBody, /return\s+\{\s*merge\s*,\s*artifacts\s*\}/);
});

test('S-011 S-012 S-013 AC-10 shipped VibePro binary preserves observed delivery and reconciles exact identity after execution-state synchronization fails', async () => {
  const { root, storyId, prUrl, mergeCommitSha, ghBinDir, prDir, statePath } = await setupPublicDeliveryFixture();

  let failure: Error & { code?: number; stdout?: string; stderr?: string } | null = null;
  try {
    await execFileAsync(process.execPath, [
      path.join(repoRoot, 'bin', 'vibepro.js'),
      'execute',
      'merge',
      root,
      '--story-id',
      storyId,
      '--base',
      'main',
      '--json'
    ], {
      cwd: repoRoot,
      encoding: 'utf8',
      maxBuffer: 8 * 1024 * 1024,
      env: { ...process.env, PATH: `${ghBinDir}${path.delimiter}${process.env.PATH}` }
    });
  } catch (error) {
    failure = error as Error & { code?: number; stdout?: string; stderr?: string };
  }

  assert.equal(failure?.code, 1, failure?.stderr);
  assert.ok(failure?.stdout, failure?.stderr);
  const output = JSON.parse(failure?.stdout ?? '{}');
  assert.equal(output.delivery.status, 'merged_externally');
  assert.equal(output.delivery.merge_commit_sha, mergeCommitSha);
  assert.equal(output.delivery.pr_url, prUrl);
  assert.equal(output.stop_reason, 'execution_state_sync_failed');
  assert.equal(output.reconciliation.status, 'reconciliation_required');
  assert.deepEqual(output.reconciliation.reasons, ['execution_state_sync_failed']);
  assert.deepEqual(output.reconciliation_action.commands, [
    `vibepro execute reconcile . --story-id ${storyId} --base main --pr ${prUrl}`
  ], 'S-011 exposes one ordered execute reconcile action without mixing PR preparation');
  assert.equal(
    output.execution_state_sync.followup_persistence,
    'persisted',
    JSON.stringify(output.execution_state_sync, null, 2)
  );
  assert.match(failure?.stderr ?? '', /Execution-state synchronization failed after merge processing/);

  const artifact = await readJson(path.join(prDir, 'pr-merge.json'));
  assert.equal(artifact.delivery.status, 'merged_externally');
  assert.equal(artifact.delivery.merge_commit_sha, mergeCommitSha);
  assert.equal(artifact.stop_reason, 'execution_state_sync_failed');
  assert.deepEqual(artifact.reconciliation_action.commands, output.reconciliation_action.commands);
  await readFile(path.join(prDir, 'pr-merge.html'), 'utf8');
  await assert.rejects(readFile(path.join(root, '.vibepro', 'pr', storyId, 'pr-merge.json'), 'utf8'));

  await rm(statePath, { recursive: true, force: true });
  const reconciled = await execFileAsync(process.execPath, [
    path.join(repoRoot, 'bin', 'vibepro.js'),
    'execute',
    'reconcile',
    root,
    '--story-id',
    storyId,
    '--base',
    'main',
    '--pr',
    prUrl,
    '--json'
  ], {
    cwd: repoRoot,
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024,
    env: { ...process.env, PATH: `${ghBinDir}${path.delimiter}${process.env.PATH}` }
  });
  const reconciledState = JSON.parse(reconciled.stdout);
  assert.equal(reconciledState.completion_status, 'merged');
  assert.equal(reconciledState.delivery.status, 'merged_externally');
  assert.equal(
    reconciledState.reconciliation.status,
    'reconciled',
    'S-012 S-013 AC-10 DRS-STORY-RECOVERY-009 exact stored base and PR identity consumes only the synchronization failure'
  );

  const recoveredLocal = await readJson(path.join(prDir, 'pr-merge.json'));
  const recoveredCanonical = await readJson(path.join(
    root,
    'docs',
    'management',
    'audit-artifacts',
    storyId,
    'pr',
    'pr-merge.json'
  ));
  for (const recovered of [recoveredLocal, recoveredCanonical]) {
    assert.equal(recovered.delivery.status, 'merged_externally');
    assert.equal(recovered.execution_state_sync.status, 'reconciled');
    assert.equal(recovered.reconciliation.status, 'reconciled');
    assert.deepEqual(recovered.reconciliation.reasons, []);
  }
});

test('S-011 shipped VibePro binary persists local recovery when canonical follow-up persistence fails', async () => {
  const { root, storyId, prUrl, mergeCommitSha, ghBinDir, prDir, statePath } = await setupPublicDeliveryFixture();

  let failure: Error & { code?: number; stdout?: string; stderr?: string } | null = null;
  try {
    await execFileAsync(process.execPath, [
      path.join(repoRoot, 'bin', 'vibepro.js'),
      'execute',
      'merge',
      root,
      '--story-id',
      storyId,
      '--base',
      'main',
      '--json'
    ], {
      cwd: repoRoot,
      encoding: 'utf8',
      maxBuffer: 8 * 1024 * 1024,
      env: {
        ...process.env,
        NODE_ENV: 'test',
        VIBEPRO_TEST_FORCE_MERGE_FOLLOWUP_FAILURE: '1',
        PATH: `${ghBinDir}${path.delimiter}${process.env.PATH}`
      }
    });
  } catch (error) {
    failure = error as Error & { code?: number; stdout?: string; stderr?: string };
  }

  assert.equal(failure?.code, 1, failure?.stderr);
  assert.ok(failure?.stdout, failure?.stderr);
  const output = JSON.parse(failure?.stdout ?? '{}');
  assert.equal(output.delivery.status, 'merged_externally');
  assert.equal(output.delivery.merge_commit_sha, mergeCommitSha);
  assert.equal(output.stop_reason, 'execution_state_sync_failed');
  assert.equal(output.execution_state_sync.followup_persistence, 'failed');
  assert.equal(output.execution_state_sync.recovery_persistence, 'persisted_local');
  assert.deepEqual(output.reconciliation_action.commands, [
    `vibepro execute reconcile . --story-id ${storyId} --base main --pr ${prUrl}`
  ]);

  const localRecovery = await readJson(path.join(prDir, 'pr-merge.json'));
  assert.equal(localRecovery.delivery.merge_commit_sha, mergeCommitSha);
  assert.equal(localRecovery.execution_state_sync.recovery_persistence, 'persisted_local');
  assert.deepEqual(localRecovery.reconciliation_action.commands, output.reconciliation_action.commands);

  await rm(statePath, { recursive: true, force: true });
  const reconciled = await execFileAsync(process.execPath, [
    path.join(repoRoot, 'bin', 'vibepro.js'),
    'execute',
    'reconcile',
    root,
    '--story-id',
    storyId,
    '--base',
    'main',
    '--pr',
    prUrl,
    '--json'
  ], {
    cwd: repoRoot,
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024,
    env: { ...process.env, PATH: `${ghBinDir}${path.delimiter}${process.env.PATH}` }
  });
  const recovered = JSON.parse(reconciled.stdout);
  assert.equal(recovered.completion_status, 'merged');
  assert.equal(recovered.reconciliation.status, 'reconciled');

  const status = await execFileAsync(process.execPath, [
    path.join(repoRoot, 'bin', 'vibepro.js'),
    'execute',
    'status',
    root,
    '--story-id',
    storyId,
    '--base',
    'main',
    '--json'
  ], { cwd: repoRoot, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
  const observed = JSON.parse(status.stdout);
  assert.equal(observed.delivery.status, 'merged_externally');
  assert.equal(observed.reconciliation.status, 'reconciled');
});

test('public execute dispatcher keeps rollback damage separate from the delivery handoff', async () => {
  let stdout = '';
  let stderr = '';
  const result = await coreRunCli([
    'execute',
    'merge',
    repoRoot,
    '--story-id',
    'story-vibepro-delivery-reconciliation-state',
    '--base',
    'main',
    '--json'
  ], {
    stdout: { write: (value: string) => { stdout += value; } },
    stderr: { write: (value: string) => { stderr += value; } },
    executeMerge: async () => ({
      merge: {
        story: { story_id: 'story-vibepro-delivery-reconciliation-state' },
        status: 'merged',
        base: 'main',
        dry_run: false,
        delivery: {
          status: 'merged',
          merge_commit_sha: 'e2e-observed-merge',
          pr_url: 'https://github.com/Unson-LLC/vibepro/pull/999'
        },
        reconciliation: { status: 'reconciled', reasons: [] },
        pr: { url: 'https://github.com/Unson-LLC/vibepro/pull/999' }
      }
    }),
    updateExecutionStateFromPrMerge: async () => {
      const error = new Error('e2e execution-state persistence failed');
      (error as Error & { code: string }).code = 'execution_state_write_failed';
      throw error;
    },
    persistMergeFollowupState: async (_root: string, { expectedMerge }: { expectedMerge: Record<string, unknown> }) => {
      assert.equal(expectedMerge.execution_state_sync, undefined);
      const primary = new Error('e2e follow-up persistence failed');
      const rollback = new Error('e2e follow-up rollback incomplete', { cause: primary });
      const structured = rollback as Error & {
        code: string;
        restore_errors: Array<{ artifact_path: string; message: string }>;
      };
      structured.code = 'merge_followup_transaction_restore_failed';
      structured.restore_errors = [{
        artifact_path: '/tmp/e2e-pr-merge.json',
        message: 'newer operator guidance preserved'
      }];
      throw structured;
    },
    persistMergeRecoveryState: async (_root: string, { merge, expectedMerge }: {
      merge: Record<string, any>;
      expectedMerge: Record<string, any>;
    }) => {
      assert.equal(expectedMerge.execution_state_sync, undefined);
      assert.equal(merge.execution_state_sync.status, 'failed');
    }
  });

  assert.equal(result.exitCode, 1);
  const output = JSON.parse(stdout);
  assert.equal(output.delivery.status, 'merged');
  assert.equal(output.reconciliation.status, 'reconciliation_required');
  assert.deepEqual(output.reconciliation_action.commands, [
    'vibepro execute reconcile . --story-id story-vibepro-delivery-reconciliation-state --base main --pr https://github.com/Unson-LLC/vibepro/pull/999'
  ]);
  assert.equal(output.execution_state_sync.error.code, 'execution_state_write_failed');
  assert.equal(output.execution_state_sync.recovery_persistence, 'persisted_local');
  assert.equal(
    output.execution_state_sync.persistence_error_details.cause_details.message,
    'e2e follow-up persistence failed'
  );
  assert.deepEqual(output.execution_state_sync.persistence_error_details.restore_errors, [{
    artifact_path: '/tmp/e2e-pr-merge.json',
    message: 'newer operator guidance preserved'
  }]);
  assert.match(stderr, /execution-state persistence failed/);
  assert.match(stderr, /follow-up persistence failed/);
});

test('public execute dispatcher preserves operator state on recovery CAS conflict', async () => {
  let stdout = '';
  const baseline = {
    story: { story_id: 'story-vibepro-delivery-reconciliation-state' },
    status: 'merged',
    base: 'main',
    delivery: { status: 'merged', merge_commit_sha: 'cas-baseline' },
    reconciliation: { status: 'reconciled', reasons: [] }
  };
  const returnedMerge = structuredClone(baseline);
  returnedMerge.delivery.merge_commit_sha = 'post-lock-result-must-not-be-cas-baseline';
  const result = await coreRunCli([
    'execute', 'merge', repoRoot,
    '--story-id', 'story-vibepro-delivery-reconciliation-state',
    '--base', 'main', '--json'
  ], {
    stdout: { write: (value: string) => { stdout += value; } },
    stderr: { write: () => {} },
    executeMerge: async () => ({
      merge: structuredClone(returnedMerge),
      execution_state_sync_baseline: structuredClone(baseline)
    }),
    updateExecutionStateFromPrMerge: async () => { throw new Error('sync failed'); },
    persistMergeFollowupState: async () => { throw new Error('follow-up failed'); },
    persistMergeRecoveryState: async (_root: string, { expectedMerge }: { expectedMerge: Record<string, any> }) => {
      assert.deepEqual(expectedMerge, baseline);
      const conflict = new Error('newer operator guidance preserved');
      (conflict as Error & { code: string }).code = 'merge_recovery_state_conflict';
      throw conflict;
    }
  });

  assert.equal(result.exitCode, 1);
  const output = JSON.parse(stdout);
  assert.equal(output.execution_state_sync.recovery_persistence, 'failed');
  assert.equal(output.execution_state_sync.recovery_persistence_error_details.code, 'merge_recovery_state_conflict');
  assert.equal(output.delivery.merge_commit_sha, 'post-lock-result-must-not-be-cas-baseline');
});
