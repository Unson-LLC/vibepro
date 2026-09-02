// pr-manager.js — minimal-core rebuild (Slice 6a).
//
// This module used to carry a Gate DAG, readiness evaluation, risk/route
// classification, remediation-command generation, and canonical-audit/merge
// wiring (~15.7k lines). Per docs/management/REBUILD.md ("最小コアのスコープ"),
// all of that is removed. What remains is exactly two things:
//
//   - preparePullRequest: collect Story info, Spec presence, recorded
//     verification evidence, and recorded review status; write
//     `.vibepro/pr/<story>/pr-prepare.json` and a PR body markdown file.
//   - createPullRequest: turn a prepare result into an actual PR (push +
//     `gh pr create`, or refresh an existing open PR's body).
//
// Bug Stories and the configured lightweight review pass add narrow,
// fail-closed readiness checks. The former general-purpose Gate DAG and route
// classification remain removed.

import { execFile } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

import { getWorkspaceDir, normalizeActiveStories, readManifest, toWorkspaceRelative, writeManifest } from './workspace.js';
import { localizedText, resolveHumanOutputLanguage } from './language.js';
import { readDrift, readInferredSpec } from './spec-store.js';
import { resolvePrArtifactFile } from './artifact-routing.js';
import { getAgentReviewStatus } from './agent-review.js';
import { bindStoryTraceability, buildAcceptedSpecClauseMap, buildTraceabilityClauseMap, summarizeTraceabilityClauseMap } from './traceability.js';
import { findStorySource } from './requirement-consistency.js';
import { assertRuntimeIntegrity, evaluateRuntimeIntegrity, RuntimeIntegrityError } from './runtime-info.js';
import { assertSelectedTaskAccepted, assertSelectedTaskScope, readTaskAuthorities } from './task-authority.js';
import { evaluateContentBinding } from './content-binding.js';
import { assessMultiTenantArchitecture, multiTenantReviewLenses } from './multi-tenant-architecture.js';
import { readLatestBugDiagnosis } from './bug-diagnosis-dag.js';
import { buildExecutionDag } from './managed-worktree.js';
import { readOperationalJudgmentProjection } from './judgment-operations.js';
import { readNarrative } from './report-store.js';
import { buildReportFingerprint } from './report-fingerprint.js';
import { validateReportNarrative } from './report-validator.js';

const execFileAsync = promisify(execFile);
const SCHEMA_VERSION = '0.2.0';

// ---------------------------------------------------------------------------
// preparePullRequest
// ---------------------------------------------------------------------------

export async function preparePullRequest(repoRoot, options = {}) {
  const root = path.resolve(repoRoot);
  const storyId = requireStoryId(options.storyId, 'pr prepare');
  const runtimeIdentity = await assertRuntimeIntegrity({ purpose: 'pr_judgment', env: options.env });
  const language = await resolveHumanOutputLanguage(root, options);

  const [story, git, spec, drift, verification, review, developmentJudgment] = await Promise.all([
    readStory(root, storyId),
    collectGitState(root, options),
    readInferredSpec(root, storyId).catch(() => null),
    readDrift(root, storyId).catch(() => null),
    readVerificationSummary(root, storyId),
    readReviewSummary(root, storyId),
    readOperationalJudgmentProjection(root, storyId)
  ]);
  assertRecordedRuntimeIdentities(verification);

  const jsonPath = await resolvePrArtifactFile(root, storyId, 'pr-prepare.json');
  const bodyPath = await resolvePrArtifactFile(root, storyId, 'pr-body.md');

  const storySource = await findStorySource(root, story).catch(() => null);
  const bugDiagnosis = await readLatestBugDiagnosis(root, story);
  const readiness = resolvePrReadiness({ bugDiagnosis, review });
  const agentReviewInstruction = projectAgentReviewInstruction(review);
  const executionDag = buildExecutionDag({
    managedWorktree: { mode: 'disabled' },
    agentReviewApplicable: review.configured,
    completedPhases: [
      verification.recorded ? 'verify' : null,
      review.complete ? 'agent_review' : null,
      readiness.status === 'ready' ? 'ready_for_pr_create' : null
    ].filter(Boolean),
    completionStatus: 'not_prepared',
    expectedHeadSha: git.head_sha,
    bugDiagnosis
  });
  const verificationTrustStatus = await evaluateVerificationEvidenceTrust(root, verification, git.head_sha);
  const clauseMap = await buildClauseMapForPrepare(root, {
    storyId,
    storySource,
    git,
    verification,
    verificationTrustStatus
  });
  const taskAuthorities = await readTaskAuthorities(root, storyId, storySource);
  const selectedTaskAuthority = await assertSelectedTaskAccepted(root, storyId, options.taskId);
  const selectedTaskScope = await assertSelectedTaskScope(root, selectedTaskAuthority?.selected, git);
  const multiTenantArchitecture = assessMultiTenantArchitecture({
    storyText: storySource?.content ?? '',
    contract: spec?.multi_tenancy ?? null,
    applicabilityEvidence: options.multiTenantApplicabilityEvidence,
    expectedHeadCommit: git.head_sha,
    mode: 'final'
  });

  const preparation = {
    schema_version: SCHEMA_VERSION,
    created_at: new Date().toISOString(),
    runtime_identity: runtimeIdentity,
    story,
    task_context: options.taskId || options.groupId ? {
      task_id: options.taskId ?? null,
      group_id: options.groupId ?? null,
      accepted_task: selectedTaskAuthority?.selected ?? null,
      accepted_scope: selectedTaskScope
    } : null,
    task_authorities: taskAuthorities,
    output: { language },
    git,
    spec: spec ? { present: true, story_id: spec.story_id ?? storyId, clause_count: (spec.clauses ?? []).length } : { present: false },
    spec_drift: drift ? { status: drift.status ?? null, item_count: (drift.items ?? []).length } : null,
    verification,
    review,
    development_judgment: developmentJudgment,
    multi_tenant_architecture: {
      ...multiTenantArchitecture,
      review_lenses: multiTenantReviewLenses(multiTenantArchitecture)
    },
    bug_diagnosis: bugDiagnosis,
    execution_dag: executionDag,
    gate_status: readiness.status,
    agent_review_instruction: agentReviewInstruction,
    blocking_reasons: readiness.reasons,
    story_source: summarizeStorySource(storySource),
    // Informational only — never blocks `pr prepare`. Unmapped AC ids are
    // surfaced in pr-body.md as "unaddressed"; see renderPrBody().
    traceability: summarizeClauseMapForPrepare(clauseMap)
  };

  await mkdir(path.dirname(jsonPath), { recursive: true });
  await writeFile(jsonPath, `${JSON.stringify(preparation, null, 2)}\n`, 'utf8');
  const narrative = await readNarrative(root, storyId, 'pr-body');
  const narrativeProjection = await assessNarrativeProjection(root, storyId, narrative);
  const body = renderPrBody(preparation, narrativeProjection);
  await writeFile(bodyPath, body, 'utf8');

  await recordManifestPrPrepare(root, storyId, { jsonPath, bodyPath }).catch(() => null);
  // Canonical traceability is part of the same projection contract as
  // pr-prepare.json and pr-body.md.  If it cannot be refreshed, `pr prepare`
  // must fail instead of reporting success with contradictory artifacts.
  await recordTraceabilityForPrepare(root, storyId, { bodyPath, verification, storySource, clauseMap });

  return {
    story,
    preparation,
    artifacts: {
      json: jsonPath,
      pr_body: bodyPath
    }
  };
}

function requireStoryId(storyId, commandName) {
  if (!storyId) throw new Error(`${commandName} requires --story-id <id>`);
  return storyId;
}

async function readStory(repoRoot, storyId) {
  let config = null;
  try {
    config = JSON.parse(await readFile(path.join(getWorkspaceDir(repoRoot), 'config.json'), 'utf8'));
  } catch {
    config = null;
  }
  const stories = normalizeActiveStories(config?.brainbase?.stories);
  const found = stories.find((item) => item.story_id === storyId);
  if (found) return found;
  return {
    story_id: storyId,
    title: storyId,
    ssot: null,
    status: 'unknown',
    horizon: null,
    view: null,
    period: null,
    started_at: null,
    due_at: null
  };
}

async function readVerificationSummary(repoRoot, storyId) {
  const evidencePath = await resolvePrArtifactFile(repoRoot, storyId, 'verification-evidence.json').catch(() => null);
  if (!evidencePath) return { recorded: false, commands: [] };
  let evidence = null;
  try {
    evidence = JSON.parse(await readFile(evidencePath, 'utf8'));
  } catch {
    return { recorded: false, commands: [] };
  }
  const commands = (evidence.commands ?? []).map((command) => ({
    kind: command.kind,
    status: command.status,
    command: command.command ?? null,
    summary: command.summary ?? null,
    summary_authority: command.summary ? 'agent_provided_non_authoritative' : null,
    evidence_source: command.evidence_source ?? null,
    observation: command.observation ?? null,
    computed_observation: command.computed_observation ?? null,
    computed_counts: extractComputedVerificationCounts(command),
    artifact_check: command.artifact_check ?? null,
    observation_check: command.observation_check ?? null,
    git_context: command.git_context ?? null,
    content_binding: command.content_binding ?? null,
    warnings: command.warnings ?? [],
    runtime_identity: command.runtime_identity ?? null,
    executed_at: command.executed_at ?? null
  }));
  return {
    recorded: commands.length > 0,
    updated_at: evidence.updated_at ?? null,
    artifact: toWorkspaceRelative(repoRoot, evidencePath),
    commands
  };
}

export async function evaluateVerificationEvidenceTrust(repoRoot, verification, headSha) {
  if (!verification?.recorded) return 'untrusted';
  let hasTrustedCommand = false;
  for (const command of verification.commands ?? []) {
    const values = command?.computed_observation?.values ?? {};
    const binding = await evaluateContentBinding(repoRoot, command.content_binding, { head_sha: headSha });
    const recordedAtExactHead = Boolean(headSha)
      && command.git_context?.head_sha === headSha
      && command.content_binding?.recorded_head_sha === headSha;
    const runnerAtExactHead = recordedAtExactHead
      && values.head_sha === headSha
      && values.head_sha_before === headSha
      && values.head_sha_after === headSha;
    const runnerComplete = String(values.exit_code) === '0'
      && String(values.timed_out) === 'false'
      && String(values.log_truncated) === 'false'
      && String(values.output_limit_exceeded) === 'false'
      && String(values.tree_mutated_during_run) === 'false'
      && String(values.head_moved_during_run) === 'false'
      && String(values.worktree_changed_during_run) === 'false';
    const runnerBindingCurrent = command.content_binding?.mode === 'strict_head'
      ? runnerAtExactHead
      : binding?.status === 'current' && runnerAtExactHead;
    const runnerTrusted = command.evidence_source === 'runner_direct'
      && runnerBindingCurrent
      && runnerComplete;
    const ciTrusted = command.evidence_source === 'ci_import'
      && recordedAtExactHead
      && values.head_sha === headSha
      && String(values.conclusion).toUpperCase() === 'SUCCESS';
    command.trust_status = (runnerTrusted || ciTrusted)
      && command.artifact_check?.status === 'verified'
      && command.observation_check?.status === 'recorded'
      ? 'trusted'
      : 'untrusted';
    if (command.trust_status === 'trusted') hasTrustedCommand = true;
  }
  return hasTrustedCommand ? 'trusted' : 'untrusted';
}

function extractComputedVerificationCounts(command) {
  const values = command?.computed_observation?.values;
  if (!values || typeof values !== 'object') return null;
  const counts = {};
  for (const key of ['tests', 'pass', 'fail']) {
    const value = Number(values[key]);
    if (Number.isFinite(value)) counts[key] = value;
  }
  return Object.keys(counts).length > 0 ? counts : null;
}

function assertRecordedRuntimeIdentities(verification) {
  for (const command of verification.commands ?? []) {
    const identity = command.runtime_identity;
    if (!identity) {
      const verdict = {
        status: 'blocked',
        code: 'runtime_mismatch',
        purpose: 'pr_judgment',
        reasons: [`verification ${command.kind ?? 'unknown'} is missing runtime_identity`]
      };
      throw new RuntimeIntegrityError(verdict, null);
    }
    const verdict = evaluateRuntimeIntegrity(identity, { purpose: 'pr_judgment' });
    if (verdict.status !== 'trusted') throw new RuntimeIntegrityError(verdict, identity);
  }
}

async function readReviewSummary(repoRoot, storyId) {
  try {
    const status = await getAgentReviewStatus(repoRoot, { storyId });
    const configured = (status.summary?.stage_count ?? 0) > 0;
    const recorded = (status.stages ?? []).some((stage) =>
      (stage.roles ?? []).some((role) => Boolean(role.artifact))
    );
    return {
      configured,
      recorded,
      complete: configured && status.status === 'pass',
      status: status.status ?? null,
      error: null,
      summary: status.summary ?? null,
      convergence: status.convergence ?? null,
      blocking_summary: status.blocking_summary ?? null,
      stages: (status.stages ?? []).map((stage) => ({
        stage: stage.stage,
        status: stage.status,
        roles: (stage.roles ?? []).map((role) => role.role ?? role.name ?? role).filter(Boolean),
        role_details: (stage.roles ?? []).map((role) => ({
          role: role.role ?? role.name ?? null,
          effective_status: role.effective_status ?? null,
          binding_status: role.binding_status ?? null,
          stale_reason: role.stale_reason ?? null,
          causal_invalidation: role.causal_invalidation ?? null,
          delta_closure: role.delta_closure ?? null,
          runtime_failure: role.runtime_failure ?? null
        }))
      }))
    };
  } catch (error) {
    return {
      configured: true,
      recorded: false,
      complete: false,
      status: 'error',
      error: { message: String(error?.message ?? error) },
      summary: null,
      convergence: null,
      blocking_summary: null,
      stages: []
    };
  }
}

export function projectAgentReviewInstruction(review) {
  if (!review.configured || review.error || review.complete || review.status !== 'needs_review') return null;
  const blockingItems = Array.isArray(review.blocking_summary?.items)
    ? review.blocking_summary.items
    : [];
  const nextCommands = Array.isArray(review.blocking_summary?.next_commands)
    ? review.blocking_summary.next_commands
    : [];
  const currentStage = blockingItems[0]?.stage ?? null;
  const currentItems = blockingItems.filter((item) => item.stage === currentStage);
  const roles = [...new Set(currentItems.map((item) => item.role).filter(Boolean))];
  const allowedCommands = new Set(currentItems.flatMap((item) => [item.prepare_command, item.record_command]).filter(Boolean));
  const selectedCommands = nextCommands.filter((command) => (
    allowedCommands.has(command) || String(command).startsWith('vibepro pr prepare ')
  ));
  const safeIdentifiers = [currentStage, ...roles].every(isSafeReviewInstructionIdentifier);
  const safeCommands = selectedCommands.every(isSafeReviewInstructionCommand);
  const selectedReviewCommands = selectedCommands.filter((command) => allowedCommands.has(command));
  const canonicalReviewCommands = selectedReviewCommands.every((command) => (
    isCanonicalCurrentStageReviewCommand(command, currentStage, roles)
  ));
  if (!currentStage || roles.length === 0 || selectedReviewCommands.length === 0 || !canonicalReviewCommands || !safeIdentifiers || !safeCommands) {
    return {
      status: 'unavailable',
      reason: 'unsafe_or_incomplete_review_status',
      current_stage: null,
      roles: [],
      next_commands: []
    };
  }
  return {
    status: 'dispatch_required',
    current_stage: currentStage,
    roles,
    next_commands: selectedCommands
  };
}

function isSafeReviewInstructionIdentifier(value) {
  return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value);
}

function isSafeReviewInstructionCommand(value) {
  if (typeof value !== 'string' || !value.trim()) return false;
  if (/[\u0000-\u0008\u000a-\u001f\u007f]/.test(value)) return false;
  if (/(?:`|\$\(|\$\{)/.test(value)) return false;
  let quote = null;
  for (const character of value) {
    if (quote) {
      if (character === quote) quote = null;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if ('|><&;'.includes(character)) return false;
  }
  return quote === null;
}

function isCanonicalCurrentStageReviewCommand(command, currentStage, roles) {
  if (!isSafeReviewInstructionCommand(command)) return false;
  const prepare = command.match(/^vibepro review prepare \. --id ([A-Za-z0-9][A-Za-z0-9._-]*) --stage ([A-Za-z0-9][A-Za-z0-9._-]*)(?<roles>(?: --role [A-Za-z0-9][A-Za-z0-9._-]*)+)$/);
  if (prepare) {
    const commandRoles = [...prepare.groups.roles.matchAll(/ --role ([A-Za-z0-9][A-Za-z0-9._-]*)/g)].map((match) => match[1]);
    return prepare[2] === currentStage && commandRoles.every((role) => roles.includes(role));
  }
  const record = command.match(/^vibepro review record \. --id ([A-Za-z0-9][A-Za-z0-9._-]*) --stage ([A-Za-z0-9][A-Za-z0-9._-]*) --role ([A-Za-z0-9][A-Za-z0-9._-]*)(?: |$)/);
  return Boolean(record && record[2] === currentStage && roles.includes(record[3]));
}

export function renderAgentReviewInstructionLines(instruction) {
  if (!instruction) return [];
  return [
    `- agent review instruction: ${instruction.status}`,
    `- current review stage: ${instruction.current_stage ?? 'none'}`,
    `- current review roles: ${instruction.roles.join(', ') || 'none'}`,
    ...(instruction.reason ? [`- agent review instruction reason: ${instruction.reason}`] : []),
    ...instruction.next_commands.map((command) => `    ${command}`)
  ];
}

function resolvePrReadiness({ bugDiagnosis, review }) {
  const blockedReasons = [];
  if (bugDiagnosis?.status === 'blocked') {
    blockedReasons.push(...bugDiagnosis.failures.map((failure) => `bug_diagnosis:${failure.id}`));
  }
  if (review.error) {
    blockedReasons.push('agent_review:status_unavailable');
  } else if (review.configured && review.status === 'block') {
    blockedReasons.push('agent_review:block');
  }
  if (blockedReasons.length > 0) {
    return { status: 'blocked', reasons: blockedReasons };
  }
  if (review.configured && !review.complete) {
    return {
      status: 'needs_review',
      reasons: [`agent_review:${review.status ?? 'needs_review'}`]
    };
  }
  return { status: 'ready', reasons: [] };
}

async function recordTraceabilityForPrepare(repoRoot, storyId, { bodyPath, verification, storySource, clauseMap }) {
  const evidence = buildPrArtifactEvidence(repoRoot, { bodyPath, verification });
  await bindStoryTraceability(repoRoot, {
    storyId,
    storyDocPath: storySource?.path ?? null,
    source: 'pr_prepare',
    lifecycle: 'in_progress',
    evidence,
    acceptanceCriteria: clauseMap.acceptance_criteria,
    scenarioClauses: clauseMap.scenario_clauses,
    scenarioLineage: clauseMap.scenario_lineage,
    acceptedSpecLineage: clauseMap.accepted_spec_lineage ?? null
  });
}

function buildPrArtifactEvidence(repoRoot, { bodyPath, verification }) {
  const evidence = [{ type: 'pr_artifact', ref: toWorkspaceRelative(repoRoot, bodyPath) }];
  if (verification?.recorded && verification.artifact) {
    evidence.push({ type: 'pr_artifact', ref: verification.artifact });
  }
  return evidence;
}

// ---------------------------------------------------------------------------
// Story source discovery + AC/scenario -> code/test traceability
//
// Both are informational only: `pr prepare` never blocks on missing story
// docs or unmapped acceptance criteria. Unmapped clauses are surfaced in
// pr-body.md as "unaddressed" so a human reviewer sees the gap.
// ---------------------------------------------------------------------------

function summarizeStorySource(storySource) {
  if (!storySource || !storySource.path) {
    return { path: null, title: storySource?.title ?? null, found: false, acceptance_criteria_count: 0 };
  }
  return {
    // findStorySource() already returns a repo-relative path (see
    // parseStoryLikeDocument in requirement-consistency.js) — do not run it
    // through toWorkspaceRelative() again, which expects an absolute input.
    path: storySource.path,
    title: storySource.title ?? null,
    found: true,
    acceptance_criteria_count: (storySource.acceptance_criteria ?? []).length
  };
}

async function buildClauseMapForPrepare(repoRoot, {
  storyId,
  storySource,
  git,
  verification,
  verificationTrustStatus
}) {
  const acceptedSpecMap = await buildAcceptedSpecClauseMap(repoRoot, {
    storyId,
    storyDocPath: storySource?.path ?? null,
    verification,
    verificationTrustStatus,
    headRef: git.head_ref ?? 'HEAD'
  });
  if (acceptedSpecMap) return acceptedSpecMap;
  const changedFiles = git.changed_files ?? [];
  const testFiles = changedFiles.filter((file) => /(^|[\\/])(test|tests|spec)([\\/]|$)|\.(test|spec)\.[jt]sx?$/i.test(file.path ?? ''));
  // No evidence array here on purpose: passing the always-present pr_artifact
  // (pr-body.md) ref would trip buildTraceabilityClauseMap's "broad evidence"
  // fallback and mark every clause at least weakly_mapped, hiding genuinely
  // unaddressed clauses. This summary reflects only changed-file/test matches.
  const acceptanceCriteria = storySource?.acceptance_criteria_details?.length
    ? storySource.acceptance_criteria_details
    : storySource?.acceptance_criteria?.length
      ? storySource.acceptance_criteria
      : null;
  return buildTraceabilityClauseMap({
    storyId,
    storyText: storySource?.content ?? '',
    acceptanceCriteria,
    changedFiles,
    tests: testFiles,
    evidence: [],
    scenarioClauses: []
  });
}

function summarizeClauseMapForPrepare(clauseMap) {
  return {
    acceptance_criteria: clauseMap.acceptance_criteria,
    scenario_clauses: clauseMap.scenario_clauses,
    scenario_lineage: clauseMap.scenario_lineage,
    accepted_spec_lineage: clauseMap.accepted_spec_lineage ?? null,
    summary: summarizeTraceabilityClauseMap(clauseMap)
  };
}

async function recordManifestPrPrepare(repoRoot, storyId, artifacts) {
  const manifest = await readManifest(repoRoot);
  manifest.pr_prepares = {
    ...(manifest.pr_prepares ?? {}),
    [storyId]: {
      latest_json: toWorkspaceRelative(repoRoot, artifacts.jsonPath),
      latest_body: toWorkspaceRelative(repoRoot, artifacts.bodyPath),
      latest_prepared_at: new Date().toISOString()
    }
  };
  await writeManifest(repoRoot, manifest);
}

// ---------------------------------------------------------------------------
// Git state (minimal: branch, head, base, changed files, dirty files)
// ---------------------------------------------------------------------------

async function collectGitState(repoRoot, options) {
  const currentBranch = await gitOptional(repoRoot, ['rev-parse', '--abbrev-ref', 'HEAD']);
  const headSha = await gitOptional(repoRoot, ['rev-parse', 'HEAD']);
  const baseRef = await resolveBaseRef(repoRoot, options.baseRef);
  const headRef = options.headRef ?? 'HEAD';
  const changedFiles = await getChangedFiles(repoRoot, baseRef, headRef);
  const dirtyFiles = await getDirtyFiles(repoRoot);
  const commitCount = await gitOptional(repoRoot, ['rev-list', '--count', `${baseRef}..${headRef}`]);
  return {
    current_branch: currentBranch || null,
    head_sha: headSha || null,
    base_ref: baseRef,
    head_ref: headRef,
    changed_files: changedFiles,
    dirty_files: dirtyFiles,
    commit_count: commitCount ? Number.parseInt(commitCount, 10) || 0 : 0
  };
}

async function resolveBaseRef(repoRoot, explicit) {
  if (explicit) return explicit;
  const symbolic = await gitOptional(repoRoot, ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD']);
  if (symbolic) return symbolic;
  if (await gitRefExists(repoRoot, 'origin/main')) return 'origin/main';
  if (await gitRefExists(repoRoot, 'origin/master')) return 'origin/master';
  return 'main';
}

async function gitRefExists(repoRoot, ref) {
  try {
    await execFileAsync('git', ['rev-parse', '--verify', ref], { cwd: repoRoot, encoding: 'utf8' });
    return true;
  } catch {
    return false;
  }
}

async function getChangedFiles(repoRoot, baseRef, headRef) {
  const output = await gitOptional(repoRoot, ['diff', '--name-status', `${baseRef}...${headRef}`]);
  if (!output) return [];
  return output.split('\n').filter(Boolean).map((line) => {
    const [status, ...rest] = line.split('\t');
    return { status, path: rest[rest.length - 1] };
  });
}

async function getDirtyFiles(repoRoot) {
  const output = await gitOptional(repoRoot, ['status', '--porcelain']);
  if (!output) return [];
  return output.split('\n').filter(Boolean).map((line) => ({
    status: line.slice(0, 2).trim(),
    path: line.slice(3)
  }));
}

async function gitOptional(repoRoot, args) {
  try {
    const { stdout } = await execFileAsync('git', args, { cwd: repoRoot, encoding: 'utf8' });
    return stdout.trim();
  } catch {
    return '';
  }
}

// ---------------------------------------------------------------------------
// PR body rendering
// ---------------------------------------------------------------------------

async function assessNarrativeProjection(repoRoot, storyId, narrative) {
  if (!narrative) return { narrative: null, narrativeStatus: 'missing' };
  const fingerprint = await buildReportFingerprint(repoRoot, { kind: 'pr-body', storyId });
  const validation = await validateReportNarrative(repoRoot, narrative, fingerprint, { expectedStoryId: storyId });
  if (!validation.ok) {
    return { narrative: null, narrativeStatus: 'invalid' };
  }
  if (!sameInputsDigest(narrative.inputs_digest, fingerprint.inputs_digest)) {
    return { narrative: null, narrativeStatus: 'stale' };
  }
  return { narrative, narrativeStatus: 'current' };
}

function sameInputsDigest(saved, current) {
  if (!saved || !current) return false;
  return JSON.stringify(saved) === JSON.stringify(current);
}

function renderPrNarrative(narrative, status = 'missing') {
  if (status === 'stale' || status === 'invalid') {
    const reason = status === 'stale'
      ? '保存済み説明は現在の証拠と一致しないため表示していません。`vibepro report write` で再生成してください。'
      : '保存済み説明は現在の検証規則を満たさないため表示していません。`vibepro report write` で再生成してください。';
    return `### 保存済みの判断説明\n\n> ⚠️ ${reason}\n\n`;
  }
  if (!Array.isArray(narrative?.narrative_slots) || narrative.narrative_slots.length === 0) return '';

  const grouped = new Map();
  for (const item of narrative.narrative_slots) {
    if (!item || typeof item.slot !== 'string' || typeof item.text !== 'string') continue;
    if (!grouped.has(item.slot)) grouped.set(item.slot, []);
    grouped.get(item.slot).push(item);
  }

  const sections = [];
  const caller = narrative.generated_by?.caller ?? 'unknown';
  const summary = grouped.get('summary')?.[0];
  if (summary) sections.push(`#### 要約 (${summary.id} by ${caller})\n${summary.text.trim()}`);

  const reviewFocus = grouped.get('review_focus') ?? [];
  if (reviewFocus.length > 0) {
    sections.push(`#### レビュー焦点\n${reviewFocus.map((item) => `- (${item.id}) ${item.text.trim()}`).join('\n')}`);
  }

  const risks = grouped.get('risks_synthesis')?.[0];
  if (risks) sections.push(`#### リスク\n- (${risks.id}) ${risks.text.trim()}`);

  const openQuestions = grouped.get('open_questions') ?? [];
  if (openQuestions.length > 0) {
    sections.push(`#### 未確定事項\n${openQuestions.map((item) => `- (${item.id}) ${item.text.trim()}`).join('\n')}`);
  }

  return sections.length > 0 ? `### 保存済みの判断説明\n\n${sections.join('\n\n')}\n\n` : '';
}

function renderPrBody(preparation, { narrative = null, narrativeStatus = 'missing' } = {}) {
  const { story, git, spec, spec_drift: specDrift, verification, review, development_judgment: developmentJudgment, story_source: storySource, traceability, task_authorities: taskAuthorities, multi_tenant_architecture: multiTenantArchitecture } = preparation;
  const lines = [];
  lines.push(`## ${story.title ?? story.story_id}`);
  lines.push('');
  lines.push(`Story: \`${story.story_id}\``);
  if (story.ssot) lines.push(`SSOT: ${story.ssot}`);
  lines.push('');
  const narrativeSection = renderPrNarrative(narrative, narrativeStatus);
  if (narrativeSection) lines.push(narrativeSection.trimEnd(), '');
  lines.push('### VibePro runtime identity');
  lines.push(`- package: \`${preparation.runtime_identity.package.name}@${preparation.runtime_identity.package.exact_version ?? preparation.runtime_identity.package.version}\``);
  lines.push(`- source: \`${preparation.runtime_identity.source_kind}\` at \`${preparation.runtime_identity.package.root}\``);
  lines.push(`- entrypoint: \`${preparation.runtime_identity.cli.entrypoint}\``);
  lines.push(`- source SHA: \`${preparation.runtime_identity.source_git?.commit ?? 'unknown'}\``);
  lines.push(`- identity digest: \`${preparation.runtime_identity.identity_digest}\``);
  lines.push('');
  lines.push('### Story document');
  if (storySource?.found) {
    lines.push(`- ${storySource.path}${storySource.title ? ` — ${storySource.title}` : ''}`);
  } else {
    lines.push('- no story document found (informational only; does not block PR creation)');
  }
  lines.push('');
  lines.push('### Acceptance criteria');
  if (traceability?.accepted_spec_lineage) {
    const lineage = traceability.accepted_spec_lineage;
    lines.push(`- accepted-spec lineage: ${lineage.status} — \`${lineage.spec_path}\` @ \`${lineage.spec_blob_oid ?? 'missing'}\` (HEAD \`${lineage.head_sha ?? 'unknown'}\`)`);
    if (lineage.story_path) {
      lines.push(`  - story: \`${lineage.story_path}\` @ \`${lineage.story_blob_oid ?? 'missing'}\` (HEAD \`${lineage.head_sha ?? 'unknown'}\`)`);
    }
    if (lineage.reason_codes?.length) lines.push(`  - reasons: ${lineage.reason_codes.join(', ')}`);
  }
  const acceptanceCriteria = traceability?.acceptance_criteria ?? [];
  if (acceptanceCriteria.length === 0) {
    lines.push('- no acceptance criteria found in the story document');
  } else {
    for (const clause of acceptanceCriteria) {
      const marker = clause.status === 'unmapped' ? '未対応' : clause.status;
      lines.push(`- [${marker}] ${clause.id}: ${clause.text}`);
      if (clause.spec_clause_ids?.length) lines.push(`  - spec clauses: ${clause.spec_clause_ids.join(', ')}`);
      for (const testRef of clause.mapped_test_provenance ?? []) {
        lines.push(`  - test: \`${testRef.file}\` — \`${testRef.case}\` @ \`${testRef.blob_oid ?? 'missing'}\` (HEAD \`${testRef.head_sha ?? 'unknown'}\`)`);
      }
      if (clause.reason_codes?.length) lines.push(`  - reasons: ${clause.reason_codes.join(', ')}`);
    }
  }
  lines.push('');
  lines.push('### Spec');
  lines.push(spec.present
    ? `- accepted spec present (\`${spec.story_id}\`, ${spec.clause_count} clause(s))`
    : '- no accepted spec found for this story');
  if (specDrift) {
    lines.push(`- drift: ${specDrift.status ?? 'unknown'} (${specDrift.item_count} item(s))`);
  }
  lines.push('');
  lines.push('### Multi-tenant architecture');
  if (!multiTenantArchitecture?.applicable) {
    lines.push('- status: not_applicable');
  } else {
    lines.push(`- status: ${multiTenantArchitecture.status}`);
    lines.push(`- activation: ${(multiTenantArchitecture.activation_reasons ?? []).join(', ') || 'unknown'}`);
    lines.push(`- architecture views: ${Object.keys(multiTenantArchitecture.views ?? {}).join(', ') || 'none'}`);
    lines.push(`- evidence coverage: ${multiTenantArchitecture.coverage?.status ?? 'inconclusive'}`);
    const scannerStates = Object.entries(multiTenantArchitecture.coverage?.scanners ?? {});
    if (scannerStates.length > 0) lines.push(`- scanners: ${scannerStates.map(([name, status]) => `${name}=${status}`).join(', ')}`);
    for (const finding of multiTenantArchitecture.findings ?? []) {
      lines.push(`- [${finding.severity}] ${finding.code}: ${finding.path}`);
    }
    for (const lens of multiTenantArchitecture.review_lenses ?? []) {
      lines.push(`- review/${lens.id} [${lens.status}]: ${lens.question}`);
      lines.push(`  - findings: ${(lens.findings ?? []).map((finding) => `${finding.code}@${finding.path}`).join(', ') || 'none'}`);
      lines.push(`  - unconfirmed: ${(lens.unconfirmed ?? []).map((finding) => `${finding.code}@${finding.path}`).join(', ') || 'none'}`);
    }
  }
  lines.push('');
  lines.push('### Bug diagnosis DAG');
  if (preparation.bug_diagnosis) {
    lines.push(`- gate: ${preparation.bug_diagnosis.status}`);
    lines.push(`- run: \`${preparation.bug_diagnosis.run_id ?? 'missing'}\` @ \`${preparation.bug_diagnosis.target_head_sha ?? 'missing'}\``);
    for (const node of preparation.bug_diagnosis.nodes ?? []) {
      lines.push(`- [${node.status}] ${node.id}${node.head_sha ? ` @ \`${node.head_sha}\`` : ''}`);
    }
    if (preparation.bug_diagnosis.return_to_node) {
      lines.push(`- return_to_node: \`${preparation.bug_diagnosis.return_to_node}\``);
    }
  } else {
    lines.push('- not applicable (Story contract type is not bug_fix/regression_fix)');
  }
  lines.push('');
  lines.push('### Verification evidence');
  if (verification.recorded) {
    for (const command of verification.commands) {
      const counts = command.computed_counts
        ? ` — computed: ${formatComputedCounts(command.computed_counts)}`
        : '';
      lines.push(`- [${command.kind}] ${command.status}${counts}${command.command ? ` — \`${command.command}\`` : ''} (runtime \`${command.runtime_identity?.identity_digest ?? 'missing'}\`)`);
      if (command.summary) lines.push('  - 自由記述summaryは参考情報であり、計算済み件数の権威ではありません');
    }
  } else {
    lines.push('- no verification evidence recorded (`vibepro verify run` / `vibepro verify record`)');
  }
  lines.push('');
  lines.push('### タスク権限');
  lines.push(renderHumanTaskAuthority(taskAuthorities?.human));
  lines.push(renderAcceptedTaskAuthority(taskAuthorities?.accepted));
  lines.push(renderGeneratedTaskAuthority(taskAuthorities?.generated));
  lines.push('');
  lines.push('### Development Judgment');
  lines.push(`- available: ${developmentJudgment?.available ?? false}`);
  lines.push(`- status: ${developmentJudgment?.status ?? 'not_recorded'}`);
  lines.push(`- lifecycle: ${developmentJudgment?.lifecycle ?? 'not_started'}`);
  lines.push(`- applicable: ${developmentJudgment?.applicable === null || developmentJudgment?.applicable === undefined ? 'not_recorded' : developmentJudgment.applicable}`);
  lines.push(`- input adopted: ${developmentJudgment?.input_adopted ?? false}`);
  lines.push(`- actionable: ${developmentJudgment?.actionable ?? false}`);
  lines.push(`- advisory: ${developmentJudgment?.advisory ?? true}`);
  lines.push(`- blocking: ${developmentJudgment?.blocking ?? false}`);
  if (developmentJudgment?.available) {
    lines.push(`- run: ${developmentJudgment.run_id ?? '-'}`);
    lines.push(`- development mode: ${developmentJudgment.development_mode ?? 'not_selected'}`);
    lines.push(`- recommendation: ${developmentJudgment.recommendation ?? 'none'}`);
    lines.push(`- unknowns: ${developmentJudgment.unknown_count ?? 0}`);
    lines.push(`- outcome evaluations: ${developmentJudgment.outcome_count ?? 0}`);
    lines.push(`- latest outcome: ${developmentJudgment.latest_outcome_status ?? developmentJudgment.outcome?.status ?? 'none'}`);
    lines.push(`- artifact: ${developmentJudgment.artifact ?? '-'}`);
  } else if (developmentJudgment?.error) {
    lines.push(`- error: ${developmentJudgment.error}`);
  }
  lines.push(`- plan binding: ${developmentJudgment?.plan_binding?.status ?? 'none'}`);
  lines.push(`- plan effect: ${developmentJudgment?.plan_binding?.effect ?? 'no_effect'}`);
  lines.push(`- disposition: ${developmentJudgment?.disposition?.human_decision ?? 'none'}`);
  lines.push(`- disposition effect: ${developmentJudgment?.disposition?.effect ?? 'none'}`);
  lines.push(`- pending disposition: ${developmentJudgment?.pending_disposition ?? false}`);
  lines.push(`- pending outcome: ${developmentJudgment?.pending_outcome ?? false}`);
  if (developmentJudgment?.outcome) {
    lines.push(`- operational outcome: ${developmentJudgment.outcome.status} — ${developmentJudgment.outcome.summary}`);
  }
  for (const action of developmentJudgment?.next_actions ?? []) {
    lines.push(`- next: ${action}`);
  }
  lines.push('');
  lines.push('### Review');
  lines.push(`- configured: ${review.configured}`);
  lines.push(`- recorded: ${review.recorded}`);
  lines.push(`- complete: ${review.complete}`);
  const reviewCounts = review.summary
    ? ` (pass=${review.summary.pass ?? 0}, needs_review=${review.summary.needs_review ?? 0}, block=${review.summary.block ?? 0})`
    : '';
  lines.push(`- status: ${review.status ?? 'unknown'}${reviewCounts}`);
  lines.push(`- convergence: ${review.convergence?.status ?? 'unavailable'} (wave=${review.convergence?.wave_count ?? 0}, no_progress=${review.convergence?.no_progress_count ?? review.convergence?.repeat_count ?? 0}, head_churn=${review.convergence?.head_churn_count ?? 0}, progress=${review.convergence?.progress_detected ?? false})`);
  lines.push(`- convergence progress reasons: ${(review.convergence?.progress_reasons ?? []).join(', ') || 'none'}`);
  if (review.convergence?.next_action) lines.push(`- convergence next action: ${review.convergence.next_action}`);
  lines.push(`- blocking reasons: ${preparation.blocking_reasons?.join(', ') || 'none'}`);
  lines.push(`- error: ${formatReviewError(review.error)}`);
  lines.push(...renderAgentReviewInstructionLines(preparation.agent_review_instruction));
  if (review.recorded) {
    for (const stage of review.stages) {
      lines.push(`  - ${stage.stage}: ${stage.status}${stage.roles.length ? ` (${stage.roles.join(', ')})` : ''}`);
      for (const role of stage.role_details ?? []) {
        if (role.binding_status === 'causal_reuse' || role.runtime_failure || role.delta_closure?.mode === 'delta_closure') {
          lines.push(`    - ${role.role}: effective=${role.effective_status ?? '-'}, binding=${role.binding_status ?? '-'}, delta=${role.delta_closure?.mode ?? 'full_review'}, runtime_failure=${role.runtime_failure?.kind ?? 'none'}`);
        }
      }
    }
  } else {
    lines.push('- next: no review recorded (`vibepro review prepare` / `vibepro review record`)');
  }
  lines.push('');
  lines.push('### Changed files');
  if (git.changed_files.length > 0) {
    for (const file of git.changed_files.slice(0, 100)) {
      lines.push(`- ${file.status}\t${file.path}`);
    }
    if (git.changed_files.length > 100) lines.push(`- ... and ${git.changed_files.length - 100} more`);
  } else {
    lines.push('- (no diff against base)');
  }
  lines.push('');
  return `${lines.join('\n')}\n`;
}

function formatReviewError(error) {
  if (!error) return 'none';
  const summary = String(error.message ?? error)
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return summary.slice(0, 240) || 'unknown';
}

function formatComputedCounts(counts) {
  return ['tests', 'pass', 'fail']
    .filter((key) => Number.isFinite(counts?.[key]))
    .map((key) => `${key}=${counts[key]}`)
    .join(', ');
}

function formatStatusCounts(counts = {}) {
  return Object.entries(counts).map(([status, count]) => `${status}=${count}`).join(', ');
}

function renderHumanTaskAuthority(authority) {
  if (!authority?.present) return '- 人間作成タスク: 未検出';
  const counts = formatStatusCounts(authority.status_counts);
  return `- 人間作成タスク: ${authority.task_count}件${counts ? ` (${counts})` : ''} — ${authority.path}`;
}

function renderAcceptedTaskAuthority(authority) {
  if (!authority?.present) return '- 受理済みauthority: 未検出';
  const counts = formatStatusCounts(authority.status_counts);
  const provenance = authority.provenance
    ? `; input=${authority.provenance.input_path}@${authority.provenance.input_sha256}`
    : '';
  return `- 受理済みauthority: ${authority.task_count}件${counts ? ` (${counts})` : ''}${provenance} — ${authority.path}`;
}

function renderGeneratedTaskAuthority(authority) {
  if (!authority?.present) return '- 生成proposal: 未検出';
  const counts = formatStatusCounts(authority.status_counts);
  const policies = authority.execution_policies?.join(', ') || '未指定';
  const mutates = authority.mutates_repository?.map((value) => String(value)).join(', ') || '未指定';
  return `- 生成proposal: ${authority.task_count}件${counts ? ` (${counts})` : ''}; execution_policy=${policies}; mutates_repository=${mutates} — ${authority.path}`;
}

// ---------------------------------------------------------------------------
// createPullRequest
// ---------------------------------------------------------------------------

export async function createPullRequest(repoRoot, options = {}) {
  const root = path.resolve(repoRoot);
  const prepareResult = await preparePullRequest(root, options);
  const { preparation } = prepareResult;
  if (preparation.gate_status !== 'ready') {
    throw new Error(
      `PR creation blocked: ${preparation.blocking_reasons.join(', ')}. `
      + (preparation.bug_diagnosis?.next_actions?.[0] ?? 'Complete the required VibePro evidence.')
    );
  }
  const currentBranch = preparation.git.current_branch;
  const headBranch = options.headBranch ?? currentBranch;
  if (!headBranch) {
    throw new Error('Current branch could not be resolved. Specify --head or run on a named branch.');
  }
  const baseBranch = stripRemote(options.prBase ?? preparation.git.base_ref);
  const title = options.title ?? buildPrTitle(preparation);
  const bodyFile = prepareResult.artifacts.pr_body;
  const dryRun = options.dryRun === true;
  const warnings = [];
  if (headBranch === baseBranch) {
    warnings.push(`head branch equals base branch: ${headBranch}`);
    if (!dryRun) {
      throw new Error(`Cannot create PR because head branch equals base branch: ${headBranch}. Switch to a feature branch or specify --head.`);
    }
  }

  const pushCommand = ['git', ['push', '-u', 'origin', headBranch]];
  const ghCreateCommand = ['gh', ['pr', 'create', '--base', baseBranch, '--head', headBranch, '--title', title, '--body-file', bodyFile]];
  const ghExistingPrListCommand = ['gh', [
    'pr', 'list', '--base', baseBranch, '--head', headBranch, '--state', 'open',
    '--json', 'number,url,state,isDraft,headRefName,headRefOid,baseRefName',
    '--limit', '1'
  ]];
  const createdAt = new Date().toISOString();
  const execution = {
    schema_version: SCHEMA_VERSION,
    created_at: createdAt,
    dry_run: dryRun,
    story: preparation.story,
    runtime_identity: preparation.runtime_identity,
    base: baseBranch,
    head: headBranch,
    title,
    body_file: toWorkspaceRelative(root, bodyFile),
    warnings,
    commands: [formatCommand(pushCommand), formatCommand(ghCreateCommand)],
    results: [],
    status: dryRun ? 'dry_run' : 'pending'
  };

  if (!dryRun) {
    const pushResult = await runCommand(root, pushCommand, options);
    execution.results.push(pushResult);
    if (pushResult.exit_code !== 0) {
      execution.status = 'failed';
      execution.error = `Command failed: ${pushResult.command}`;
      await writePrCreateArtifacts(root, prepareResult, execution);
      throw new Error(execution.error);
    }
    const ghResult = await runCommand(root, ghCreateCommand, options);
    execution.results.push(ghResult);
    if (ghResult.exit_code !== 0) {
      if (!isExistingPullRequestCreateError(ghResult)) {
        execution.status = 'failed';
        execution.error = `Command failed: ${ghResult.command}`;
        await writePrCreateArtifacts(root, prepareResult, execution);
        throw new Error(execution.error);
      }
      execution.commands.push(formatCommand(ghExistingPrListCommand));
      const listResult = await runCommand(root, ghExistingPrListCommand, options);
      execution.results.push(listResult);
      const existingPr = parseExistingPullRequestFromList(listResult.stdout);
      if (listResult.exit_code !== 0 || !existingPr) {
        execution.status = 'failed';
        execution.error = 'Existing PR create response was returned, but no open PR matched the requested base/head.';
        await writePrCreateArtifacts(root, prepareResult, execution);
        throw new Error(execution.error);
      }
      const editTarget = existingPr.url ?? (existingPr.number ? String(existingPr.number) : null);
      const ghEditCommand = ['gh', ['pr', 'edit', editTarget, '--title', title, '--body-file', bodyFile]];
      execution.commands.push(formatCommand(ghEditCommand));
      const editResult = await runCommand(root, ghEditCommand, options);
      execution.results.push(editResult);
      if (editResult.exit_code !== 0) {
        execution.status = 'failed';
        execution.error = `Existing PR body refresh failed: ${editResult.command}`;
        await writePrCreateArtifacts(root, prepareResult, execution);
        throw new Error(execution.error);
      }
      execution.status = 'updated_existing_pr';
      execution.pr_url = existingPr.url ?? null;
      execution.warnings.push('Existing open PR detected for the requested base/head; refreshed its body instead of creating a duplicate PR.');
    } else {
      execution.status = 'created';
      execution.pr_url = extractPrUrl(ghResult.stdout);
    }
  }

  const artifacts = await writePrCreateArtifacts(root, prepareResult, execution);
  return {
    story: preparation.story,
    preparation,
    execution,
    artifacts: { ...prepareResult.artifacts, ...artifacts }
  };
}

function buildPrTitle(preparation) {
  return preparation.story?.title ?? preparation.story?.story_id ?? 'VibePro change';
}

function stripRemote(ref) {
  return String(ref ?? '').replace(/^origin\//, '');
}

function formatCommand(command) {
  const [bin, args] = command;
  return [bin, ...args.map(shellQuote)].join(' ');
}

function shellQuote(value) {
  if (/^[a-zA-Z0-9_./:=@+-]+$/.test(value)) return value;
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}

async function runCommand(repoRoot, command, options = {}) {
  const [bin, args] = command;
  const startedAt = new Date().toISOString();
  try {
    const result = await execFileAsync(bin, args, { cwd: repoRoot, encoding: 'utf8', env: options.env });
    return {
      command: formatCommand(command),
      started_at: startedAt,
      finished_at: new Date().toISOString(),
      exit_code: 0,
      stdout: result.stdout.trim(),
      stderr: result.stderr.trim()
    };
  } catch (error) {
    return {
      command: formatCommand(command),
      started_at: startedAt,
      finished_at: new Date().toISOString(),
      exit_code: Number.isInteger(error.code) ? error.code : 1,
      stdout: String(error.stdout ?? '').trim(),
      stderr: String(error.stderr ?? error.message ?? '').trim()
    };
  }
}

function extractPrUrl(stdout) {
  const match = String(stdout ?? '').match(/https?:\/\/\S+/);
  return match?.[0] ?? null;
}

function isExistingPullRequestCreateError(result) {
  const text = `${result?.stdout ?? ''}\n${result?.stderr ?? ''}`;
  return /pull request/i.test(text) && /(already|exist)/i.test(text);
}

function parseExistingPullRequestFromList(stdout) {
  const trimmed = String(stdout ?? '').trim();
  if (!trimmed) return null;
  try {
    const parsed = JSON.parse(trimmed);
    const pr = Array.isArray(parsed) ? parsed[0] ?? null : (parsed && typeof parsed === 'object' ? parsed : null);
    if (!pr) return null;
    return {
      number: Number.isInteger(pr.number) ? pr.number : null,
      url: typeof pr.url === 'string' && pr.url ? pr.url : null
    };
  } catch {
    return null;
  }
}

async function writePrCreateArtifacts(repoRoot, prepareResult, execution) {
  const storyId = execution.story.story_id;
  const jsonPath = await resolvePrArtifactFile(repoRoot, storyId, 'pr-create.json');
  await mkdir(path.dirname(jsonPath), { recursive: true });
  await writeFile(jsonPath, `${JSON.stringify(execution, null, 2)}\n`, 'utf8');
  try {
    const manifest = await readManifest(repoRoot);
    manifest.pr_creations = {
      ...(manifest.pr_creations ?? {}),
      [storyId]: {
        latest_create: toWorkspaceRelative(repoRoot, jsonPath),
        latest_pr_url: execution.pr_url ?? null,
        latest_created_at: execution.created_at,
        latest_dry_run: execution.dry_run
      }
    };
    await writeManifest(repoRoot, manifest);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  return { pr_create_json: jsonPath };
}

// ---------------------------------------------------------------------------
// CLI rendering
// ---------------------------------------------------------------------------

export function renderPrPrepareSummary(result) {
  const { preparation } = result;
  const lines = [
    localizedText(preparation.output?.language, { ja: '# PR Prepare', en: '# PR Prepare' }),
    '',
    `- story: ${preparation.story.story_id}`,
    `- base: ${preparation.git.base_ref}`,
    `- head: ${preparation.git.head_ref} (${preparation.git.head_sha ?? '-'})`,
    `- changed files: ${preparation.git.changed_files.length}`,
    `- spec: ${preparation.spec.present ? 'present' : 'missing'}`,
    `- verification: ${preparation.verification.recorded ? `${preparation.verification.commands.length} command(s) recorded` : 'not recorded'}`,
    `- review: ${preparation.review.recorded ? (preparation.review.status ?? 'recorded') : 'not recorded'}`,
    `- gate: ${preparation.gate_status}`,
    ...renderAgentReviewInstructionLines(preparation.agent_review_instruction),
    ...(preparation.bug_diagnosis ? [`- bug diagnosis return: ${preparation.bug_diagnosis.return_to_node ?? '-'}`] : []),
    `- artifacts: ${result.artifacts.json}, ${result.artifacts.pr_body}`,
    ''
  ];
  return `${lines.join('\n')}\n`;
}

export function renderPrCreateSummary(result) {
  const { execution } = result;
  const lines = [
    '# PR Create',
    '',
    `- story: ${execution.story.story_id}`,
    `- status: ${execution.status}`,
    `- base: ${execution.base}`,
    `- head: ${execution.head}`,
    `- pr_url: ${execution.pr_url ?? '-'}`,
    ...(execution.warnings.length > 0 ? ['- warnings:', ...execution.warnings.map((w) => `  - ${w}`)] : []),
    ''
  ];
  return `${lines.join('\n')}\n`;
}
