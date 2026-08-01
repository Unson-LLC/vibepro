import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

import { runCli } from '../src/cli.js';
import {
  diagnoseMergeGateAuthorization,
  resolveMergeGateAuthorizationContext
} from '../src/merge-gate-diagnosis.js';
import { renderPrMergeSummary } from '../src/merge-manager.js';
import { projectPublicPrMergeResult } from '../src/merge-public-projection.js';

const execFileAsync = promisify(execFile);
const HEAD = 'a'.repeat(40);
const OLD_HEAD = 'b'.repeat(40);
const STORY_ID = 'story-merge-gate-diagnosis';

function freshness(kind, artifactHeadSha, currentHeadSha = HEAD) {
  return {
    kind,
    status: artifactHeadSha === currentHeadSha ? 'current' : 'stale',
    artifact_head_sha: artifactHeadSha,
    current_head_sha: currentHeadSha
  };
}

function prPrepareFixture({ headSha = HEAD, gateStatus, gateDag } = {}) {
  return {
    story: { story_id: STORY_ID },
    gate_status: gateStatus,
    pr_context: gateDag === null ? {} : { gate_dag: gateDag },
    git: { base_ref: 'main', head_sha: headSha },
    artifact_freshness: freshness('pr_prepare', headSha)
  };
}

function prCreateFixture({ headSha = HEAD, gateOverride = null, gateDag } = {}) {
  return {
    story: { story_id: STORY_ID },
    ...(gateOverride ? { gate_override: gateOverride } : {}),
    ...(gateDag ? { gate_dag: gateDag } : {}),
    pr_url: 'https://github.example.test/unson/vibepro/pull/1',
    current_head_sha: headSha,
    artifact_freshness: freshness('pr_create', headSha)
  };
}

function notReadyGateDag(gateIds = ['gate:validation_sequencing']) {
  return {
    overall_status: 'needs_verification',
    nodes: gateIds.map((id) => ({ id, required: true, status: 'needs_evidence' }))
  };
}

const NONCRITICAL_WAIVER = {
  allowed: true,
  waiver_policy: 'cli_reason',
  reason: 'noncritical waiver fixture',
  unresolved_gates: [{ id: 'gate:validation_sequencing' }],
  critical_unresolved_gates: []
};

const READY_GATE_STATUS = {
  overall_status: 'needs_verification',
  ready_for_pr_create: false,
  unresolved_gates: [{ id: 'gate:validation_sequencing' }],
  critical_unresolved_gates: []
};

test('MGD-AC-1 unresolved and critical gate evidence keeps the gate_not_ready stop reason', () => {
  const gateDag = notReadyGateDag();
  const unresolved = resolveMergeGateAuthorizationContext({
    storyId: STORY_ID,
    prPrepare: prPrepareFixture({ gateStatus: READY_GATE_STATUS, gateDag }),
    prCreate: prCreateFixture(),
    currentHeadSha: HEAD
  });
  assert.equal(unresolved.gateAuthorization.allowed, false);
  assert.equal(unresolved.diagnosis.cause, 'gates_unresolved');
  assert.equal(unresolved.diagnosis.stop_reason, 'gate_not_ready');

  const critical = resolveMergeGateAuthorizationContext({
    storyId: STORY_ID,
    prPrepare: prPrepareFixture({
      gateStatus: {
        ...READY_GATE_STATUS,
        unresolved_gates: [{ id: 'gate:validation_sequencing' }, { id: 'gate:e2e' }],
        critical_unresolved_gates: [{ id: 'gate:e2e' }]
      },
      gateDag: notReadyGateDag(['gate:validation_sequencing', 'gate:e2e'])
    }),
    prCreate: prCreateFixture({ gateOverride: NONCRITICAL_WAIVER }),
    currentHeadSha: HEAD
  });
  assert.equal(critical.diagnosis.cause, 'critical_gates_unresolved');
  assert.equal(critical.diagnosis.stop_reason, 'gate_not_ready');
  assert.deepEqual(
    critical.diagnosis.blocking_gates.map((gate) => `${gate.id}:${gate.severity}`),
    ['gate:e2e:critical', 'gate:validation_sequencing:unknown']
  );
});

test('MGD-AC-2 a pr-create artifact that is missing or unbound to HEAD names itself, not the gates', () => {
  const gateDag = notReadyGateDag();
  const stale = resolveMergeGateAuthorizationContext({
    storyId: STORY_ID,
    prPrepare: prPrepareFixture({ gateStatus: READY_GATE_STATUS, gateDag }),
    prCreate: prCreateFixture({ headSha: OLD_HEAD, gateOverride: NONCRITICAL_WAIVER }),
    currentHeadSha: HEAD
  });
  assert.equal(stale.gateAuthorization.reason, 'gate_override_not_allowed');
  assert.equal(stale.diagnosis.cause, 'pr_create_artifact_stale');
  assert.equal(stale.diagnosis.stop_reason, 'pr_create_artifact_stale');
  assert.equal(
    stale.diagnosis.artifact_bindings.find((binding) => binding.artifact === 'pr_create').status,
    'stale'
  );
  assert.equal(
    stale.diagnosis.artifact_bindings.find((binding) => binding.artifact === 'pr_create').artifact_head_sha,
    OLD_HEAD
  );
  assert.match(stale.diagnosis.explanation, /Gates were not evaluated as blocked/);
  assert.ok(stale.diagnosis.next_actions.some((action) => action.includes('vibepro pr create')));

  // The artifact-missing cause is the narrow fallback: it applies when the gate
  // status enumerates nothing to fix, so the absent artifact really is the only
  // thing standing between this state and an authority verdict. When the gate
  // status does enumerate unresolved gates, MGD-AC-9 pins that those win.
  const missing = resolveMergeGateAuthorizationContext({
    storyId: STORY_ID,
    prPrepare: prPrepareFixture({
      gateStatus: { ...READY_GATE_STATUS, unresolved_gates: [], critical_unresolved_gates: [] },
      gateDag: { overall_status: 'needs_verification', nodes: [] }
    }),
    prCreate: null,
    currentHeadSha: HEAD
  });
  assert.equal(missing.diagnosis.cause, 'pr_create_artifact_missing');
  assert.equal(missing.diagnosis.stop_reason, 'pr_create_artifact_missing');
  assert.equal(
    missing.diagnosis.artifact_bindings.find((binding) => binding.artifact === 'pr_create').status,
    'missing'
  );
});

test('MGD-AC-3 unresolvable gate status distinguishes stale pr-prepare from a routed surface mismatch', () => {
  const gateDag = notReadyGateDag();
  const stalePrepare = resolveMergeGateAuthorizationContext({
    storyId: STORY_ID,
    prPrepare: prPrepareFixture({ headSha: OLD_HEAD, gateStatus: READY_GATE_STATUS, gateDag }),
    prCreate: prCreateFixture({ gateOverride: NONCRITICAL_WAIVER }),
    currentHeadSha: HEAD
  });
  assert.equal(stalePrepare.gateAuthorization.reason, 'current_gate_status_unknown');
  assert.equal(stalePrepare.diagnosis.cause, 'pr_prepare_artifact_stale');
  assert.equal(stalePrepare.diagnosis.stop_reason, 'pr_prepare_artifact_stale');

  const missingPrepare = resolveMergeGateAuthorizationContext({
    storyId: STORY_ID,
    prPrepare: null,
    prCreate: prCreateFixture({ gateOverride: NONCRITICAL_WAIVER, gateDag }),
    currentHeadSha: HEAD
  });
  assert.equal(missingPrepare.diagnosis.cause, 'pr_prepare_artifact_missing');
  assert.equal(missingPrepare.diagnosis.stop_reason, 'pr_prepare_artifact_missing');

  const routedMismatch = resolveMergeGateAuthorizationContext({
    storyId: STORY_ID,
    prPrepare: prPrepareFixture({ gateStatus: READY_GATE_STATUS, gateDag }),
    prCreate: prCreateFixture({ gateOverride: NONCRITICAL_WAIVER }),
    gateDagArtifact: {
      overall_status: 'needs_verification',
      nodes: [{ id: 'gate:e2e', required: true, critical: true, status: 'needs_evidence' }]
    },
    currentHeadSha: HEAD
  });
  assert.equal(routedMismatch.gateAuthorization.reason, 'current_gate_status_unknown');
  assert.equal(routedMismatch.diagnosis.cause, 'gate_dag_surface_mismatch');
  assert.equal(routedMismatch.diagnosis.stop_reason, 'gate_status_unresolved');
});

test('MGD-AC-4 waiver defects are reported as waiver defects', () => {
  const gateDag = notReadyGateDag();
  const incomplete = resolveMergeGateAuthorizationContext({
    storyId: STORY_ID,
    prPrepare: prPrepareFixture({ gateStatus: READY_GATE_STATUS, gateDag }),
    prCreate: prCreateFixture({
      gateOverride: { allowed: true, waiver_policy: 'cli_reason', reason: 'targets omitted', critical_unresolved_gates: [] }
    }),
    currentHeadSha: HEAD
  });
  assert.equal(incomplete.gateAuthorization.reason, 'gate_override_targets_missing');
  assert.equal(incomplete.diagnosis.stop_reason, 'gate_waiver_incomplete');

  const stale = resolveMergeGateAuthorizationContext({
    storyId: STORY_ID,
    prPrepare: prPrepareFixture({
      gateStatus: {
        ...READY_GATE_STATUS,
        unresolved_gates: [{ id: 'gate:requirement' }]
      },
      gateDag: notReadyGateDag(['gate:requirement'])
    }),
    prCreate: prCreateFixture({ gateOverride: NONCRITICAL_WAIVER }),
    currentHeadSha: HEAD
  });
  assert.equal(stale.gateAuthorization.reason, 'gate_override_targets_mismatch');
  assert.equal(stale.diagnosis.stop_reason, 'gate_waiver_stale');
});

test('MGD-AC-9 a lapsed pr-create with no waiver over unresolved gates reports the gates, not the artifact', () => {
  // Realistic path: the PR was created while gates were ready, a follow-up
  // commit broke a gate, and pr prepare was re-run. Naming the stale artifact
  // here would point at `pr create`, which cannot authorize anything that was
  // never waived -- the gate evidence is what blocks.
  const gateDag = notReadyGateDag();
  const context = resolveMergeGateAuthorizationContext({
    storyId: STORY_ID,
    prPrepare: prPrepareFixture({ gateStatus: READY_GATE_STATUS, gateDag }),
    prCreate: prCreateFixture({ headSha: OLD_HEAD }),
    currentHeadSha: HEAD
  });
  assert.equal(context.gateAuthorization.reason, 'gate_override_not_allowed');
  assert.equal(context.diagnosis.cause, 'gates_unresolved');
  assert.equal(context.diagnosis.stop_reason, 'gate_not_ready');
  assert.deepEqual(
    context.diagnosis.blocking_gates.map((gate) => gate.id),
    ['gate:validation_sequencing']
  );
  assert.doesNotMatch(context.diagnosis.explanation, /Gates were not evaluated as blocked/);

  // The same lapsed artifact WITH a waiver still reports the artifact, because
  // there the merge authority really was discarded by the binding.
  const withWaiver = resolveMergeGateAuthorizationContext({
    storyId: STORY_ID,
    prPrepare: prPrepareFixture({ gateStatus: READY_GATE_STATUS, gateDag }),
    prCreate: prCreateFixture({ headSha: OLD_HEAD, gateOverride: NONCRITICAL_WAIVER }),
    currentHeadSha: HEAD
  });
  assert.equal(withWaiver.diagnosis.stop_reason, 'pr_create_artifact_stale');
});

test('MGD-AC-10 an unreadable artifact is reported as unreadable and outranks every other cause', () => {
  const gateDag = notReadyGateDag();
  const diagnosis = diagnoseMergeGateAuthorization({
    storyId: STORY_ID,
    gateAuthorization: { allowed: false, source: 'none', reason: 'gate_override_not_allowed', gate_override: null },
    gateDag,
    currentGateStatus: READY_GATE_STATUS,
    prPrepare: prPrepareFixture({ gateStatus: READY_GATE_STATUS, gateDag }),
    currentPrPrepare: prPrepareFixture({ gateStatus: READY_GATE_STATUS, gateDag }),
    prCreate: null,
    currentPrCreate: null,
    currentHeadSha: HEAD,
    unreadableArtifacts: { pr_create: true }
  });
  assert.equal(diagnosis.cause, 'artifact_unreadable');
  assert.equal(diagnosis.stop_reason, 'artifact_unreadable');
  assert.equal(
    diagnosis.artifact_bindings.find((binding) => binding.artifact === 'pr_create').status,
    'unreadable'
  );
  assert.match(diagnosis.explanation, /pr_create could not be parsed as JSON/);
});

test('MGD-AC-12 gate_not_ready is never reported without naming a gate', () => {
  // The reservation in INV-001 is an "only" claim, so it needs the negative
  // cases pinned, not just positive ones. Each state below denies authority
  // while no unresolved gate can be named; reporting gate_not_ready here would
  // assert a gate failure that was never evaluated.
  const notReady = notReadyGateDag();
  const readyDag = { overall_status: 'ready_for_review', nodes: [] };

  // (a) no pr-prepare at all, but a current pr-create with no waiver.
  const noPrepare = resolveMergeGateAuthorizationContext({
    storyId: STORY_ID,
    prPrepare: null,
    prCreate: prCreateFixture(),
    gateDagArtifact: notReady,
    currentHeadSha: HEAD
  });
  assert.equal(noPrepare.diagnosis.stop_reason, 'pr_prepare_artifact_missing');

  // (b) a stale pr-prepare that was itself ready, with a current waiver-less
  // pr-create. A head-bound pr-prepare would have authorized the merge.
  const stalePrepare = resolveMergeGateAuthorizationContext({
    storyId: STORY_ID,
    prPrepare: prPrepareFixture({
      headSha: OLD_HEAD,
      gateStatus: {
        overall_status: 'ready_for_review',
        ready_for_pr_create: true,
        unresolved_gates: [],
        critical_unresolved_gates: []
      },
      gateDag: readyDag
    }),
    prCreate: prCreateFixture(),
    currentHeadSha: HEAD
  });
  assert.equal(stalePrepare.diagnosis.stop_reason, 'pr_prepare_artifact_stale');

  // (c) a routed gate DAG disagreeing with a head-bound prepared DAG that names
  // nothing: no gate can be named, so the surface is the reason.
  const emptySurfaceMismatch = resolveMergeGateAuthorizationContext({
    storyId: STORY_ID,
    prPrepare: prPrepareFixture({
      gateStatus: { ...READY_GATE_STATUS, unresolved_gates: [], critical_unresolved_gates: [] },
      gateDag: { overall_status: 'needs_verification', nodes: [] }
    }),
    prCreate: prCreateFixture(),
    gateDagArtifact: readyDag,
    currentHeadSha: HEAD
  });
  assert.equal(emptySurfaceMismatch.diagnosis.cause, 'gate_dag_surface_mismatch');
  assert.equal(emptySurfaceMismatch.diagnosis.stop_reason, 'gate_status_unresolved');

  // (d) the same disagreement, but the head-bound prepared DAG does name an
  // unresolved required gate. That is current blocked evidence: name the gate.
  const namedSurfaceMismatch = resolveMergeGateAuthorizationContext({
    storyId: STORY_ID,
    prPrepare: prPrepareFixture({
      gateStatus: { ...READY_GATE_STATUS, unresolved_gates: [], critical_unresolved_gates: [] },
      gateDag: { overall_status: 'blocked', nodes: [{ id: 'gate:verification', status: 'needs_evidence' }] }
    }),
    prCreate: prCreateFixture(),
    gateDagArtifact: readyDag,
    currentHeadSha: HEAD
  });
  assert.equal(namedSurfaceMismatch.diagnosis.stop_reason, 'gate_not_ready');
  assert.deepEqual(
    namedSurfaceMismatch.diagnosis.blocking_gates.map((gate) => gate.id),
    ['gate:verification']
  );

  // Every blocked diagnosis that claims gate evidence must name at least one.
  for (const context of [noPrepare, stalePrepare, emptySurfaceMismatch, namedSurfaceMismatch]) {
    if (context.diagnosis.stop_reason === 'gate_not_ready') {
      assert.notEqual(context.diagnosis.blocking_gates.length, 0);
    }
  }
});

test('MGD-AC-13 a waiver naming a since-resolved critical gate is stale, not a current critical failure', () => {
  // validateMergeGateOverride reads the waiver document alone. Re-running
  // pr prepare after closing a critical gate does not move HEAD, so both
  // artifacts stay head-bound while the waiver document goes stale. Claiming
  // "critical gate evidence is unresolved" there is factually false.
  const gateDag = notReadyGateDag();
  const context = resolveMergeGateAuthorizationContext({
    storyId: STORY_ID,
    prPrepare: prPrepareFixture({ gateStatus: READY_GATE_STATUS, gateDag }),
    prCreate: prCreateFixture({
      gateOverride: { ...NONCRITICAL_WAIVER, critical_unresolved_gates: [{ id: 'gate:e2e' }] }
    }),
    currentHeadSha: HEAD
  });
  assert.equal(context.gateAuthorization.reason, 'gate_override_contains_critical_gates');
  assert.equal(context.diagnosis.cause, 'gate_waiver_stale');
  assert.equal(context.diagnosis.stop_reason, 'gate_waiver_stale');
  assert.doesNotMatch(context.diagnosis.explanation, /Critical gate evidence is unresolved/);

  // When the current status really does list a critical gate, it stays critical.
  const reallyCritical = resolveMergeGateAuthorizationContext({
    storyId: STORY_ID,
    prPrepare: prPrepareFixture({
      gateStatus: {
        ...READY_GATE_STATUS,
        unresolved_gates: [{ id: 'gate:validation_sequencing' }, { id: 'gate:e2e' }],
        critical_unresolved_gates: [{ id: 'gate:e2e' }]
      },
      gateDag: notReadyGateDag(['gate:validation_sequencing', 'gate:e2e'])
    }),
    prCreate: prCreateFixture({
      gateOverride: { ...NONCRITICAL_WAIVER, critical_unresolved_gates: [{ id: 'gate:e2e' }] }
    }),
    currentHeadSha: HEAD
  });
  assert.equal(reallyCritical.diagnosis.cause, 'critical_gates_unresolved');
  assert.equal(reallyCritical.diagnosis.stop_reason, 'gate_not_ready');
});

test('MGD-AC-11 an unreadable artifact outranks a valid waiver instead of reporting authorized', () => {
  // buildMergeGateAuthorization treats an unparseable artifact as absent, so a
  // valid waiver can make authorization "allowed" over input nobody could read.
  // executeMerge throws on that state, so the diagnosis must not call it
  // authorized or --explain would contradict the command it explains.
  const gateDag = notReadyGateDag();
  const diagnosis = diagnoseMergeGateAuthorization({
    storyId: STORY_ID,
    gateAuthorization: {
      allowed: true,
      source: 'pr_create_gate_override',
      reason: 'auditable_noncritical_gate_override',
      gate_override: NONCRITICAL_WAIVER
    },
    gateDag,
    currentGateStatus: READY_GATE_STATUS,
    prPrepare: prPrepareFixture({ gateStatus: READY_GATE_STATUS, gateDag }),
    currentPrPrepare: prPrepareFixture({ gateStatus: READY_GATE_STATUS, gateDag }),
    prCreate: prCreateFixture({ gateOverride: NONCRITICAL_WAIVER }),
    currentPrCreate: prCreateFixture({ gateOverride: NONCRITICAL_WAIVER }),
    currentHeadSha: HEAD,
    unreadableArtifacts: { gate_dag: true }
  });
  assert.equal(diagnosis.status, 'blocked');
  assert.equal(diagnosis.cause, 'artifact_unreadable');
  assert.equal(diagnosis.stop_reason, 'artifact_unreadable');
  assert.equal(
    diagnosis.artifact_bindings.find((binding) => binding.artifact === 'gate_dag').status,
    'unreadable'
  );
});

test('MGD-AC-5 an authorized merge records an authorized diagnosis with no stop reason', () => {
  const gateDag = { overall_status: 'ready_for_review', nodes: [] };
  const authorized = resolveMergeGateAuthorizationContext({
    storyId: STORY_ID,
    prPrepare: prPrepareFixture({
      gateStatus: {
        overall_status: 'ready_for_review',
        ready_for_pr_create: true,
        unresolved_gates: [],
        critical_unresolved_gates: []
      },
      gateDag
    }),
    prCreate: prCreateFixture(),
    currentHeadSha: HEAD
  });
  assert.equal(authorized.gateAuthorization.allowed, true);
  assert.equal(authorized.diagnosis.status, 'authorized');
  assert.equal(authorized.diagnosis.stop_reason, null);
  assert.deepEqual(authorized.diagnosis.blocking_gates, []);
});

test('MGD-AC-6 an unrecognised authorization reason degrades without claiming a gate failure', () => {
  const diagnosis = diagnoseMergeGateAuthorization({
    storyId: STORY_ID,
    gateAuthorization: { allowed: false, source: 'none', reason: 'brand_new_reason', gate_override: null },
    currentHeadSha: HEAD
  });
  assert.equal(diagnosis.cause, 'gate_authorization_denied');
  assert.equal(diagnosis.stop_reason, 'gate_authorization_denied');
  assert.equal(diagnosis.authorization_reason, 'brand_new_reason');
});

test('MGD-AC-7 the public projection and human summary keep the diagnosis readable', () => {
  const merge = {
    created_at: '2026-08-01T00:00:00.000Z',
    story: { story_id: STORY_ID },
    status: 'blocked',
    strategy: 'merge',
    base: 'main',
    dry_run: false,
    delete_branch: false,
    stop_reason: 'pr_create_artifact_stale',
    delivery: { status: 'unknown' },
    reconciliation: { status: 'reconciliation_required', reasons: ['pr_create_artifact_stale'] },
    pr: { url: 'https://example.test/pr/1', checks: [] },
    preconditions: {
      gate_ready: false,
      clean_worktree: true,
      base_freshness: { status: 'passed' },
      remote_head_match: { status: 'passed' },
      checks_ready: { status: 'passed' },
      review_policy: { status: 'passed' },
      open_pull_request: { status: 'passed' }
    },
    gate_authorization: { allowed: false, source: 'none', reason: 'gate_override_not_allowed', gate_override: null },
    gate_authorization_diagnosis: {
      schema_version: '0.1.0',
      status: 'blocked',
      cause: 'pr_create_artifact_stale',
      stop_reason: 'pr_create_artifact_stale',
      authorization_reason: 'gate_override_not_allowed',
      authorization_source: 'none',
      gate_dag_overall_status: 'needs_verification',
      artifact_bindings: [
        { artifact: 'pr_prepare', status: 'current', artifact_head_sha: HEAD, current_head_sha: HEAD },
        { artifact: 'pr_create', status: 'stale', artifact_head_sha: OLD_HEAD, current_head_sha: HEAD }
      ],
      blocking_gates: [{ id: 'gate:validation_sequencing', severity: 'unknown', status: 'needs_evidence', source: 'gate_dag' }],
      explanation: 'Gates were not evaluated as blocked. pr-create.json is bound to an older commit.',
      next_actions: [`vibepro pr prepare . --story-id ${STORY_ID}`],
      internal_command: 'gh pr merge --token abc'
    },
    artifact_freshness: null,
    commands: [],
    results: [],
    warnings: []
  };

  const projected = projectPublicPrMergeResult(merge);
  assert.equal(projected.stop_reason, 'pr_create_artifact_stale');
  assert.deepEqual(projected.reconciliation.reasons, ['pr_create_artifact_stale']);
  assert.equal(projected.gate_authorization_diagnosis.cause, 'pr_create_artifact_stale');
  assert.equal(
    Object.hasOwn(projected.gate_authorization_diagnosis, 'internal_command'),
    false
  );

  const summary = renderPrMergeSummary(merge);
  assert.match(summary, /gate_diagnosis_cause: pr_create_artifact_stale/);
  assert.match(summary, /gate_diagnosis_stop_reason: pr_create_artifact_stale/);
  assert.match(summary, /gate_diagnosis_artifact_bindings: .*pr_create=stale/);
  assert.match(summary, /gate_diagnosis_blocking_gates: gate:validation_sequencing=needs_evidence/);
});

test('MGD-AC-8 execute merge --explain diagnoses a blocked merge without running gh or writing artifacts', async () => {
  const repo = await mkdtemp(path.join(os.tmpdir(), 'vibepro-merge-explain-'));
  await execFileAsync('git', ['init', '-b', 'main'], { cwd: repo });
  await execFileAsync('git', ['config', 'user.email', 'vibepro@example.com'], { cwd: repo });
  await execFileAsync('git', ['config', 'user.name', 'VibePro Test'], { cwd: repo });
  await writeFile(path.join(repo, 'README.md'), '# fixture\n');
  await execFileAsync('git', ['add', '.'], { cwd: repo });
  await execFileAsync('git', ['commit', '-m', 'chore: fixture'], { cwd: repo });
  const headSha = (await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: repo })).stdout.trim();

  const prDir = path.join(repo, '.vibepro', 'pr', STORY_ID);
  await mkdir(prDir, { recursive: true });
  await writeFile(path.join(prDir, 'pr-prepare.json'), `${JSON.stringify({
    story: { story_id: STORY_ID },
    gate_status: READY_GATE_STATUS,
    pr_context: { gate_dag: notReadyGateDag() },
    git: { base_ref: 'main', head_sha: headSha },
    artifact_freshness: freshness('pr_prepare', headSha, headSha)
  }, null, 2)}\n`);
  await writeFile(path.join(prDir, 'pr-create.json'), `${JSON.stringify({
    story: { story_id: STORY_ID },
    gate_override: NONCRITICAL_WAIVER,
    pr_url: 'https://github.example.test/unson/vibepro/pull/1',
    current_head_sha: OLD_HEAD,
    artifact_freshness: freshness('pr_create', OLD_HEAD, headSha)
  }, null, 2)}\n`);

  const binDir = await mkdtemp(path.join(os.tmpdir(), 'vibepro-merge-explain-bin-'));
  const ghCallLog = path.join(binDir, 'gh-called.log');
  await writeFile(path.join(binDir, 'gh'), `#!/usr/bin/env node
require('node:fs').writeFileSync(${JSON.stringify(ghCallLog)}, process.argv.slice(2).join(' '));
process.exit(0);
`);
  await execFileAsync('chmod', ['0755', path.join(binDir, 'gh')]);

  let stdout = '';
  const result = await runCli(
    ['execute', 'merge', repo, '--story-id', STORY_ID, '--explain', '--json'],
    {
      stdout: { write(chunk) { stdout += chunk; } },
      stderr: { write() {} },
      env: { ...process.env, PATH: `${binDir}${path.delimiter}${process.env.PATH}` }
    }
  );

  assert.equal(result.exitCode, 2);
  const explain = JSON.parse(stdout);
  assert.equal(explain.mode, 'execute_merge_explain');
  assert.equal(explain.gate_ready, false);
  assert.equal(explain.current_head_sha, headSha);
  assert.equal(explain.gate_authorization_diagnosis.cause, 'pr_create_artifact_stale');
  assert.equal(explain.gate_authorization_diagnosis.stop_reason, 'pr_create_artifact_stale');
  assert.equal(explain.sources.pr_create, `.vibepro/pr/${STORY_ID}/pr-create.json`);

  await assert.rejects(() => readFile(ghCallLog, 'utf8'), { code: 'ENOENT' });
  await assert.rejects(() => readFile(path.join(prDir, 'pr-merge.json'), 'utf8'), { code: 'ENOENT' });
  const status = await execFileAsync('git', ['status', '--porcelain'], { cwd: repo });
  assert.equal(status.stdout.includes('pr-merge'), false);
});
