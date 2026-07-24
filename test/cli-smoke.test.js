import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { renderOutcomeCommandError, renderOutcomeCommandResult, runCli, serializeOutcomeCommandError, TOP_LEVEL_COMMANDS } from '../src/cli.js';
import { projectPublicPrMergeResult } from '../src/merge-manager.js';
import { OutcomeCommandError } from '../src/outcome-manager.js';

const execFileAsync = promisify(execFile);

async function git(repo, args) {
  return execFileAsync('git', args, { cwd: repo, encoding: 'utf8' });
}

// A git repo with a VibePro workspace, a feature branch, and one source change —
// the minimal state most commands need to run their real (exit 0) path.
async function makeStoryRepo() {
  const repo = await mkdtemp(path.join(tmpdir(), 'vibepro-smoke-'));
  await git(repo, ['init', '-b', 'main']);
  await git(repo, ['config', 'user.email', 't@e.com']);
  await git(repo, ['config', 'user.name', 'T']);
  await runCli(['init', repo, '--story-id', 'story-x', '--title', 'T', '--view', 'dev', '--period', '2026-W18']);
  await writeFile(path.join(repo, 'package.json'), JSON.stringify({ dependencies: { next: '14' } }));
  await git(repo, ['add', '-A']);
  await git(repo, ['commit', '-m', 'chore: init']);
  await git(repo, ['switch', '-c', 'feature/x']);
  await mkdir(path.join(repo, 'src'), { recursive: true });
  await writeFile(path.join(repo, 'src', 'a.js'), 'export const a = 1;\n');
  await git(repo, ['add', '-A']);
  await git(repo, ['commit', '-m', 'feat: a']);
  return repo;
}

async function makeBareGitRepo() {
  const repo = await mkdtemp(path.join(tmpdir(), 'vibepro-smoke-bare-'));
  await git(repo, ['init', '-b', 'main']);
  await git(repo, ['config', 'user.email', 't@e.com']);
  await git(repo, ['config', 'user.name', 'T']);
  return repo;
}

// One smoke entry per top-level command. `args(repo)` returns the argv for a
// real success path; `setup` decides what repo the command needs.
// This layer exists to catch handler-import wiring breaks (e.g. a command whose
// module import is missing/broken) BEFORE merge — exactly the class of bug that
// `env graph` and the deploy gate shipped with, which module-only unit tests
// could not see because no test invoked the command end-to-end.
const SMOKE = {
  version: { setup: 'none', args: () => ['version'] },
  help: { setup: 'none', args: () => ['help'] },
  init: { setup: 'bare', args: (r) => ['init', r, '--story-id', 'story-i', '--title', 'T', '--view', 'dev', '--period', '2026-W18'] },
  config: { setup: 'story', args: (r) => ['config', 'language', r, '--language', 'en'] },
  doctor: { setup: 'story', args: (r) => ['doctor', r] },
  status: { setup: 'story', args: (r) => ['status', r] },
  usage: { setup: 'story', args: (r) => ['usage', 'report', r, '--json'] },
  graph: { setup: 'story', args: (r) => ['graph', r] },
  env: { setup: 'story', args: (r) => ['env', 'graph', r] },
  harness: { setup: 'story', args: (r) => ['harness', 'status', r] },
  skills: { setup: 'story', args: (r) => ['skills', 'list', r] },
  codex: { setup: 'story', args: (r) => ['codex', 'verify', r] },
  brainbase: { setup: 'none', args: () => ['brainbase'] },
  pr: { setup: 'story', args: (r) => ['pr', 'prepare', r, '--base', 'main'] },
  story: { setup: 'story', args: (r) => ['story', 'add', r, '--id', 'story-y', '--title', 'Y', '--view', 'dev', '--period', '2026-W18'] },
  playbook: { setup: 'story', args: (r) => ['playbook', 'export', r, '--id', 'story-x'] },
  journey: { setup: 'story', args: (r) => ['journey', 'status', r] },
  execute: { setup: 'story', args: (r) => ['execute', 'status', r, '--story-id', 'story-x', '--json'] },
  task: { setup: 'story', args: (r) => ['task', r] },
  decision: { setup: 'story', args: (r) => ['decision', 'status', r, '--id', 'story-x'] },
  outcome: { setup: 'none', args: () => ['outcome', '--help'] },
  verify: { setup: 'story', args: (r) => ['verify', r] },
  review: { setup: 'story', args: (r) => ['review', 'status', r, '--id', 'story-x'] },
  guard: { setup: 'story', args: (r) => ['guard', 'status', r] },
  adjudicate: { setup: 'story', args: (r) => ['adjudicate', 'prepare', r, '--id', 'story-x'] },
  checkpoint: { setup: 'story', args: (r) => ['checkpoint', r] },
  gate: { setup: 'story', args: (r) => ['gate', 'check', r, '--story-id', 'story-x'] },
  spec: { setup: 'story', args: (r) => ['spec', r] },
  report: { setup: 'story', args: (r) => ['report', r] },
  audit: { setup: 'story', args: (r) => ['audit', 'replay', r, '--story-id', 'story-x', '--json'] },
  'design-modernize': { setup: 'story', args: (r) => ['design-modernize', r] },
  'design-system': { setup: 'story', args: (r) => ['design-system', r] },
  'design-ssot': { setup: 'story', args: (r) => ['design-ssot', 'status', r] },
  uiux: { setup: 'story', args: (r) => ['uiux', 'intake', 'template', r, '--id', 'story-x'] },
  explore: { setup: 'story', args: (r) => ['explore', r] },
  performance: { setup: 'story', args: (r) => ['performance', r] },
  workspace: { setup: 'story', args: (r) => ['workspace', 'status', r, '--json'] }
};

async function repoFor(setup) {
  if (setup === 'story') return makeStoryRepo();
  if (setup === 'bare') return makeBareGitRepo();
  return null;
}

// The contract this layer enforces is "every command's handler is wired and
// reachable": runCli must not THROW (a missing/broken import throws at dispatch),
// and must return a result with a numeric exitCode. It deliberately does NOT
// require exit 0 — several commands legitimately exit non-zero on a minimal repo
// (e.g. unresolved gates). Throwing is the #117/#118 failure mode; a clean
// non-zero exit is normal. This catches the wiring-break class without coupling
// to each command's success preconditions.
test('CLI smoke: every top-level command is wired and runs without throwing', async () => {
  for (const [name, spec] of Object.entries(SMOKE)) {
    const repo = await repoFor(spec.setup);
    const argv = spec.args(repo);
    let result;
    try {
      result = await runCli(argv);
    } catch (err) {
      assert.fail(`command "${name}" threw during runCli (likely a broken/missing handler import): ${err.message}`);
    }
    assert.equal(typeof result, 'object', `command "${name}" should return a result object`);
    assert.equal(typeof result.exitCode, 'number', `command "${name}" should return a numeric exitCode`);
  }
});

test('CLI smoke coverage: every TOP_LEVEL_COMMANDS entry has a smoke test', () => {
  const smoked = new Set(Object.keys(SMOKE));
  const missing = TOP_LEVEL_COMMANDS.filter((c) => !smoked.has(c));
  assert.deepEqual(missing, [], `these commands lack a CLI smoke test: ${missing.join(', ')}`);
  // And no stale smoke entries for removed commands.
  const known = new Set(TOP_LEVEL_COMMANDS);
  const stale = [...smoked].filter((c) => !known.has(c));
  assert.deepEqual(stale, [], `these smoke entries are not real commands: ${stale.join(', ')}`);
});

test('outcome promotion text exposes bounded recovery diagnostics without raw command output', () => {
  const error = new OutcomeCommandError(
    'outcome_promotion_failed',
    'canonical outcome revision could not be persisted',
    {
      persistence: {
        status: 'failed',
        reason: 'canonical_audit_push_indeterminate; cleanup_failed',
        pushed: false,
        worktree_path: '/tmp/vibepro-canonical-audit-story-x-1',
        primary: {
          status: 'failed',
          reason: 'canonical_audit_push_indeterminate',
          failure: {
            stage: 'canonical.push',
            status: 'timed_out',
            failure_kind: 'timeout',
            stderr: 'SECRET_SHOULD_NOT_RENDER'
          }
        },
        push_postcondition: { status: 'indeterminate', remote_sha: null },
        cleanup: { attempted: true, removed: false, status: 'failed' }
      }
    }
  );

  const rendered = renderOutcomeCommandError(error);
  assert.match(rendered, /persistence: status=failed reason=canonical_audit_push_indeterminate; cleanup_failed pushed=false/);
  assert.match(rendered, /push postcondition: status=indeterminate remote-sha=unknown/);
  assert.match(rendered, /cleanup: status=failed attempted=true removed=false/);
  assert.match(rendered, /recovery: verify the remote branch before retrying; inspect and remove the temporary worktree if it remains/);
  assert.doesNotMatch(rendered, /SECRET_SHOULD_NOT_RENDER/);
  assert.doesNotMatch(rendered, /vibepro-canonical-audit-story-x-1|primary failure/);

  const json = JSON.stringify(serializeOutcomeCommandError(error));
  assert.match(json, /outcome_promotion_failed/);
  assert.match(json, /canonical_audit_push_indeterminate/);
  assert.doesNotMatch(json, /SECRET_SHOULD_NOT_RENDER/);
  assert.doesNotMatch(json, /worktree_path|primary|commands|results/);
});

test('execute merge JSON projects bounded persistence diagnostics without internal command output', () => {
  const projected = projectPublicPrMergeResult({
    merge: {
      status: 'failed',
      strategy: 'merge',
      canonical_audit: {
        status: 'failed',
        persistence: {
          status: 'failed',
          reason: 'canonical_audit_push_indeterminate',
          pushed: false,
          worktree_path: '/tmp/vibepro-canonical-audit-story-x-1',
          commands: ['git push https://token@example.invalid/repo.git'],
          results: [{ stdout: 'SECRET_SHOULD_NOT_RENDER', stderr: 'raw failure' }],
          push_postcondition: { status: 'indeterminate', remote_sha: null },
          cleanup: { attempted: true, removed: false, status: 'failed' },
          recovery: 'verify remote state before retrying'
        }
      },
      execution_state_sync: {
        status: 'failed',
        reason: 'primary sync failure',
        recovery_command: 'vibepro execute reconcile . --story-id story-x --base main'
      },
      reconciliation_action: {
        status: 'required',
        reason: 'execution_state_sync_failed',
        commands: ['vibepro execute reconcile . --story-id story-x --base main']
      }
    }
  });

  assert.equal(projected.canonical_audit.persistence.status, 'failed');
  assert.equal(projected.canonical_audit.persistence.reason, 'canonical_audit_push_indeterminate');
  assert.deepEqual(projected.canonical_audit.persistence.push_postcondition, {
    status: 'indeterminate',
    remote_sha: null
  });
  assert.deepEqual(projected.canonical_audit.persistence.cleanup, {
    attempted: true,
    removed: false,
    status: 'failed'
  });
  assert.equal(projected.canonical_audit.persistence.recovery, 'verify remote state before retrying');
  assert.equal(projected.execution_state_sync.reason, 'primary sync failure');
  assert.deepEqual(projected.reconciliation_action.commands, [
    'vibepro execute reconcile . --story-id story-x --base main'
  ]);
  const json = JSON.stringify(projected);
  assert.doesNotMatch(json, /SECRET_SHOULD_NOT_RENDER|raw failure|worktree_path|git push|results|token@example/);
});

test('outcome finalization text exposes local reconciliation state and recovery artifact', () => {
  const error = new OutcomeCommandError(
    'outcome_local_finalization_failed',
    'canonical outcome revision was persisted but the local ledger finalization requires reconciliation',
    {
      ledger_postcondition: {
        status: 'not_applied',
        expected_digest: 'digest-expected',
        observed_digest: 'digest-observed'
      },
      reconciliation: {
        status: 'required',
        artifact_status: 'recorded',
        artifact_path: '.vibepro/pr/story-x/outcome-refresh-reconciliation.json'
      },
      recovery: 'Verify the canonical revision, then retry outcome refresh.'
    }
  );

  const rendered = renderOutcomeCommandError(error);
  assert.match(rendered, /ledger postcondition: status=not_applied expected-digest=digest-expected observed-digest=digest-observed/);
  assert.match(rendered, /reconciliation: status=required artifact-status=recorded artifact=.vibepro\/pr\/story-x\/outcome-refresh-reconciliation.json/);
  assert.match(rendered, /recovery: Verify the canonical revision, then retry outcome refresh/);
});

test('outcome restore failure diagnostics redact credential-like values in text and JSON', () => {
  const error = new OutcomeCommandError(
    'outcome_canonical_restore_failed',
    'canonical rollback failed after Authorization: Bearer super-secret-token',
    {
      original_error: {
        code: 'outcome_promotion_failed',
        message: 'token=super-secret-token',
        persistence: {
          status: 'push_failed',
          reason: 'canonical_audit_push_indeterminate',
          pushed: false,
          worktree_path: '/tmp/vibepro-canonical-recovery',
          primary: {
            status: 'failed',
            reason: 'canonical_audit_push_indeterminate',
            failure: { stage: 'canonical.push', status: 'timed_out', failure_kind: 'timeout' }
          },
          push_postcondition: { status: 'indeterminate', remote_sha: null },
          cleanup: { attempted: true, removed: false, status: 'failed' }
        },
        ledger_postcondition: {
          status: 'not_applied',
          expected_digest: 'expected',
          observed_digest: 'observed'
        }
      },
      recovery_snapshot: '/tmp/recovery/canonical',
      recovery: 'restore password=super-secret-token before retrying'
    }
  );

  const rendered = renderOutcomeCommandError(error);
  const json = JSON.stringify(serializeOutcomeCommandError(error));
  assert.doesNotMatch(rendered, /super-secret-token/);
  assert.doesNotMatch(json, /super-secret-token/);
  assert.match(rendered, /\[REDACTED\]/);
  assert.match(json, /\[REDACTED\]/);
  assert.match(rendered, /original push postcondition: status=indeterminate remote-sha=unknown/);
  assert.match(rendered, /original cleanup: status=failed attempted=true removed=false/);
  assert.match(rendered, /original ledger postcondition: status=not_applied expected-digest=expected observed-digest=observed/);
  assert.doesNotMatch(rendered, /vibepro-canonical-recovery|primary failure/);
  assert.doesNotMatch(json, /worktree_path|primary|commands|results/);
});

test('outcome success text exposes the bounded record contract while JSON preserves the public result', () => {
  const result = {
    status: 'recorded',
    story_id: 'story-x',
    artifact_path: '.vibepro/observations/story-x/obs_123.json',
    artifact_digest: 'digest-observation',
    resolved_selector: { decision_trace_id: 'trace-123' },
    parent_revision_fingerprint: 'revision-123',
    producer: 'operator:test',
    resolved_source: { ref: 'verification:command-1', kind: 'verification_evidence', digest: 'digest-source' }
  };

  const rendered = renderOutcomeCommandResult(result, { subcommand: 'record' });
  assert.match(rendered, /^outcome record: recorded/m);
  assert.match(rendered, /story: story-x/);
  assert.match(rendered, /trace: trace-123/);
  assert.match(rendered, /parent revision: revision-123/);
  assert.match(rendered, /observation: .* digest=digest-observation/);
  assert.match(rendered, /source: verification:command-1 kind=verification_evidence digest=digest-source/);
  assert.deepEqual(JSON.parse(JSON.stringify(result)), result);
});

test('outcome success text exposes the refresh persistence contract', () => {
  const rendered = renderOutcomeCommandResult({
    status: 'promoted',
    story_id: 'story-x',
    ledger_path: '.vibepro/pr/story-x/decision-outcome-ledger.json',
    ledger_digest: 'digest-ledger',
    observation_count: 2,
    canonical_bundle: 'docs/management/audit-artifacts/story-x/audit-bundle.json',
    persistence: { status: 'pushed', commit_sha: 'commit-123' }
  }, { subcommand: 'refresh' });

  assert.match(rendered, /^outcome refresh: promoted/m);
  assert.match(rendered, /ledger: .* digest=digest-ledger/);
  assert.match(rendered, /observations: 2/);
  assert.match(rendered, /canonical bundle: docs\/management\/audit-artifacts\/story-x\/audit-bundle.json/);
  assert.match(rendered, /persistence: status=pushed commit=commit-123/);
});

test('outcome help is scoped to the selected subcommand', async () => {
  for (const [argv, expected, excluded] of [
    [['outcome', '--help'], /VibePro Outcome/, /vibepro design-system/],
    [['outcome', 'record', '--help'], /outcome record/, /outcome refresh \[repo\]/],
    [['outcome', 'refresh', '--help'], /outcome refresh/, /--value-json/]
  ]) {
    let output = '';
    const result = await runCli(argv, { stdout: { write: (chunk) => { output += chunk; } } });
    assert.equal(result.exitCode, 0);
    assert.match(output, expected);
    assert.doesNotMatch(output, excluded);
  }
});
