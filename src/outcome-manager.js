import { createHash } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, readdir, rename, rm, stat, unlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  digestDecisionOutcomeBytes,
  getDecisionOutcomeLedgerPath,
  matchesDecisionOutcomeObservation,
  readDecisionOutcomeLedgerIfExists,
  reviseDecisionOutcomeLedger,
  validateDecisionOutcomeObservation
} from './decision-outcome-ledger.js';
import { atomicReplaceFile } from './atomic-file.js';
import { promoteCanonicalAuditArtifacts } from './canonical-audit.js';
import { collectCanonicalDirectoryFiles, persistCanonicalArtifactsToBase } from './canonical-persistence.js';
import { getWorkspaceDir, toWorkspaceRelative } from './workspace.js';
import { evaluateContentBinding } from './content-binding.js';
import { executeManagedCommand, executeManagedOperation } from './managed-command-executor.js';

const OUTCOME_STORY_ID_PATTERN = /^story-[a-z0-9][a-z0-9._-]*$/;

export class OutcomeCommandError extends Error {
  constructor(errorId, message, details = {}) {
    super(message);
    this.name = 'OutcomeCommandError';
    this.error_id = errorId;
    this.details = details;
  }

  toJSON() {
    return { error_id: this.error_id, message: this.message, ...this.details };
  }
}

export async function recordOutcome(repoRoot, options = {}) {
  const root = path.resolve(repoRoot);
  const storyId = requireOutcomeStoryId(options.storyId, 'outcome record requires --id <story-id>');
  const producer = required(options.producer, 'outcome_producer_required', 'outcome record requires --producer <identity>');
  if (!safeOutcomeText(producer, 256)) {
    throw new OutcomeCommandError('outcome_producer_invalid', 'outcome producer must be a bounded printable identity');
  }
  const status = options.status;
  if (!['observed', 'not_applicable'].includes(status)) {
    throw new OutcomeCommandError('outcome_status_invalid', 'outcome status must be observed or not_applicable');
  }
  if (status === 'observed' && options.value === undefined) {
    throw new OutcomeCommandError('outcome_value_required', 'observed outcome requires --value-json <json>');
  }
  if (status === 'observed' && !isJsonSafeOutcomeValue(options.value)) {
    throw new OutcomeCommandError('outcome_value_invalid', 'observed outcome value must be JSON-safe');
  }
  const reason = status === 'not_applicable'
    ? required(options.reason, 'outcome_reason_required', 'not_applicable outcome requires --reason <text>')
    : null;
  if (reason != null && !safeOutcomeText(reason, 4096)) {
    throw new OutcomeCommandError('outcome_reason_invalid', 'outcome reason must be bounded printable text');
  }

  const ledger = await readDecisionOutcomeLedgerIfExists(root, storyId);
  if (!ledger) throw new OutcomeCommandError('outcome_ledger_missing', 'decision outcome ledger is missing');
  const selector = parseSelector(options);
  const candidates = (ledger.traces ?? []).filter((trace) => traceMatches(trace, selector));
  if (candidates.length !== 1) {
    throw boundedError('outcome_trace_not_unique', 'trace selector must resolve exactly one entry', ledger, candidates);
  }
  const trace = candidates[0];
  if (trace.parent_revision_fingerprint !== options.parentRevision) {
    throw boundedError('outcome_parent_stale', 'parent revision does not match the selected trace', ledger, [trace]);
  }
  await assertMerged(root, storyId, options);
  const source = resolveSource(trace, options.source, ledger);
  await verifyManagedSource(root, storyId, source, trace, ledger);

  const observedAt = new Date().toISOString();
  const observationCore = {
    schema_version: '0.1.0',
    story_id: storyId,
    trace_selector: selector,
    parent_revision_fingerprint: options.parentRevision,
    status,
    observed_at: observedAt,
    producer,
    source_ref: source.ref,
    value: status === 'observed' ? options.value : null,
    reason,
    authority: {
      kind: source.kind,
      source_digest: source.digest,
      recorded_by: 'vibepro'
    }
  };
  const observationId = `obs_${canonicalDigest(observationCore)}`;
  const observation = { ...observationCore, observation_id: observationId };
  const validation = validateDecisionOutcomeObservation(observation, {
    storyId,
    selector,
    parentRevision: options.parentRevision
  });
  if (!validation.valid) {
    throw new OutcomeCommandError(
      validation.code === 'observation_untrusted' ? 'outcome_observation_untrusted' : 'outcome_observation_invalid',
      'outcome observation failed validation',
      { validation_code: validation.code }
    );
  }
  const bytes = `${JSON.stringify(observation, null, 2)}\n`;
  const artifactPath = path.join(getWorkspaceDir(root), 'observations', storyId, `${observationId}.json`);
  await mkdir(path.dirname(artifactPath), { recursive: true });
  await registerObservation(root, storyId, observation, artifactPath, bytes);
  return {
    status: 'recorded',
    story_id: storyId,
    artifact_path: toWorkspaceRelative(root, artifactPath),
    artifact_digest: digestDecisionOutcomeBytes(bytes),
    resolved_selector: selector,
    parent_revision_fingerprint: options.parentRevision,
    producer,
    resolved_source: source
  };
}

export async function refreshOutcome(repoRoot, options = {}) {
  const root = path.resolve(repoRoot);
  const storyId = requireOutcomeStoryId(options.storyId, 'outcome refresh requires --id <story-id>');
  const ledger = await readDecisionOutcomeLedgerIfExists(root, storyId);
  if (!ledger) throw new OutcomeCommandError('outcome_ledger_missing', 'decision outcome ledger is missing');
  const merge = await assertMerged(root, storyId, options);
  const authoritativeBase = String(merge.base ?? merge.git?.base_branch ?? '').replace(/^origin\//, '');
  const requestedBase = options.baseRef == null
    ? null
    : String(options.baseRef).replace(/^origin\//, '');
  if (!authoritativeBase) {
    throw new OutcomeCommandError('outcome_base_authority_missing', 'verified merge authority does not identify a canonical base');
  }
  if (requestedBase && requestedBase !== authoritativeBase) {
    throw new OutcomeCommandError(
      'outcome_base_authority_mismatch',
      'requested base does not match the verified live PR base',
      { requested_base: requestedBase, authoritative_base: authoritativeBase }
    );
  }
  const observations = await readObservations(root, storyId, ledger);
  const revised = reviseDecisionOutcomeLedger(ledger, {
    delivery: deliveryFromMerge(storyId, merge),
    observations,
    currentHeadSha: merge.current_head_sha
  });
  const ledgerPath = getDecisionOutcomeLedgerPath(root, storyId);
  const originalLedgerBytes = await readFile(ledgerPath);
  const canonicalDir = path.join(root, 'docs', 'management', 'audit-artifacts', storyId);
  const canonicalSnapshot = await snapshotDirectory(canonicalDir);
  const atomicWrite = options.atomicWrite ?? atomicReplaceFile;
  const revisedBytes = `${JSON.stringify(revised, null, 2)}\n`;
  let canonical;
  let revisedExposed = false;
  try {
    // Canonical promotion currently reads the workspace ledger. Expose the revised
    // bytes only while building the staged canonical bundle, then restore the
    // authoritative local state until persistence has succeeded.
    await atomicWrite(ledgerPath, revisedBytes);
    revisedExposed = true;
    canonical = await promoteCanonicalAuditArtifacts(root, {
      storyId,
      source: 'outcome_refresh',
      merge
    });
  } catch (error) {
    await restoreDirectory(canonicalDir, canonicalSnapshot);
    await rm(canonicalSnapshot.tempRoot, { recursive: true, force: true });
    throw error;
  } finally {
    if (revisedExposed) await atomicWrite(ledgerPath, originalLedgerBytes);
  }
  let persistence;
  try {
    const relativeDir = toWorkspaceRelative(root, canonical.canonical_dir);
    const persist = options.persistenceService ?? persistCanonicalArtifactsToBase;
    persistence = await persist({
      repoRoot: root,
      storyId,
      relativeDir,
      allowedRoots: [relativeDir],
      baseBranch: authoritativeBase,
      mergeCommitSha: merge.merge_commit_sha,
      options,
      commitMessage: `docs: persist decision outcome revision for ${storyId}`,
      prepare: async () => ({
        files: await collectCanonicalDirectoryFiles(canonical.canonical_dir, relativeDir),
        metadata: { ledger_digest: revised.artifact_digest }
      })
    });
    if (!['pushed', 'already_present'].includes(persistence.summary?.status)) {
      throw new OutcomeCommandError('outcome_promotion_failed', 'canonical outcome revision could not be persisted', {
        persistence: persistence.summary
      });
    }
  } catch (error) {
    await restoreDirectory(canonicalDir, canonicalSnapshot);
    throw error;
  } finally {
    await rm(canonicalSnapshot.tempRoot, { recursive: true, force: true });
  }
  const reconciliationPath = path.join(
    getWorkspaceDir(root),
    'pr',
    storyId,
    'outcome-refresh-reconciliation.json'
  );
  try {
    await atomicWrite(ledgerPath, revisedBytes);
  } catch {
    const ledgerPostcondition = await inspectOutcomeLedgerPostcondition(ledgerPath, revisedBytes);
    if (ledgerPostcondition.status !== 'applied') {
      const boundedPersistence = projectOutcomePersistence(persistence.summary);
      const reconciliation = {
        schema_version: '0.1.0',
        model: 'vibepro-outcome-refresh-reconciliation-v1',
        story_id: storyId,
        status: 'reconciliation_required',
        reason: 'outcome_local_finalization_failed',
        recorded_at: new Date().toISOString(),
        ledger_path: toWorkspaceRelative(root, ledgerPath),
        expected_ledger_digest: revised.artifact_digest,
        ledger_postcondition: ledgerPostcondition,
        persistence: boundedPersistence,
        recovery: {
          command: `vibepro outcome refresh . --id ${storyId}`,
          instruction: 'Verify the canonical revision, then retry local outcome refresh finalization.'
        }
      };
      let reconciliationStatus = 'recorded';
      try {
        await mkdir(path.dirname(reconciliationPath), { recursive: true });
        const reconciliationWrite = options.reconciliationWrite ?? atomicReplaceFile;
        await reconciliationWrite(reconciliationPath, `${JSON.stringify(reconciliation, null, 2)}\n`);
      } catch {
        reconciliationStatus = 'unavailable';
      }
      throw new OutcomeCommandError(
        'outcome_local_finalization_failed',
        'canonical outcome revision was persisted but the local ledger finalization requires reconciliation',
        {
          persistence: boundedPersistence,
          ledger_postcondition: ledgerPostcondition,
          reconciliation: {
            status: 'required',
            artifact_status: reconciliationStatus,
            artifact_path: toWorkspaceRelative(root, reconciliationPath)
          },
          recovery: `Verify the canonical revision, then run vibepro outcome refresh . --id ${storyId}`
        }
      );
    }
  }
  try {
    await unlink(reconciliationPath);
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      throw new OutcomeCommandError(
        'outcome_reconciliation_cleanup_failed',
        'the local outcome ledger was finalized but stale reconciliation evidence could not be removed',
        {
          reconciliation: {
            status: 'stale',
            artifact_path: toWorkspaceRelative(root, reconciliationPath)
          },
          recovery: `Remove ${toWorkspaceRelative(root, reconciliationPath)} after verifying the local outcome ledger digest ${revised.artifact_digest}`
        }
      );
    }
  }
  return {
    status: persistence.summary.status === 'already_present' ? 'already_present' : 'promoted',
    story_id: storyId,
    ledger_path: toWorkspaceRelative(root, ledgerPath),
    ledger_digest: revised.artifact_digest,
    observation_count: observations.length,
    canonical_bundle: toWorkspaceRelative(root, canonical.bundle_path),
    persistence: persistence.summary
  };
}

async function inspectOutcomeLedgerPostcondition(ledgerPath, expectedBytes) {
  const expectedDigest = digestDecisionOutcomeBytes(expectedBytes);
  try {
    const observedBytes = await readFile(ledgerPath);
    const observedDigest = digestDecisionOutcomeBytes(observedBytes);
    return {
      status: observedDigest === expectedDigest ? 'applied' : 'not_applied',
      expected_digest: expectedDigest,
      observed_digest: observedDigest
    };
  } catch {
    return {
      status: 'indeterminate',
      expected_digest: expectedDigest,
      observed_digest: null
    };
  }
}

function projectOutcomePersistence(summary = {}) {
  return {
    status: summary.status ?? 'unknown',
    reason: summary.reason ?? null,
    commit_sha: summary.commit_sha ?? null,
    pushed: summary.pushed === true,
    push_postcondition: summary.push_postcondition ?? null,
    cleanup: summary.cleanup ?? null,
    primary: summary.primary ?? null
  };
}

export async function bindDecisionOutcomeDelivery(repoRoot, storyId, delivery, options = {}) {
  const root = path.resolve(repoRoot);
  const safeStoryId = requireOutcomeStoryId(storyId, 'decision outcome delivery binding requires story id');
  const ledger = await readDecisionOutcomeLedgerIfExists(root, safeStoryId);
  if (!ledger) return null;
  const revised = reviseDecisionOutcomeLedger(ledger, { delivery });
  const ledgerPath = getDecisionOutcomeLedgerPath(root, safeStoryId);
  const atomicWrite = options.atomicWrite ?? atomicReplaceFile;
  await atomicWrite(ledgerPath, `${JSON.stringify(revised, null, 2)}\n`);
  return revised;
}

export async function tryBindDecisionOutcomeDelivery(repoRoot, storyId, delivery, options = {}) {
  try {
    const ledger = await bindDecisionOutcomeDelivery(repoRoot, storyId, delivery, options);
    return {
      status: ledger ? 'bound' : 'not_available',
      error: null
    };
  } catch (error) {
    const code = error instanceof OutcomeCommandError && error.error_id === 'outcome_story_invalid'
      ? 'outcome_story_invalid'
      : 'decision_outcome_delivery_binding_failed';
    return {
      status: 'unavailable',
      error: {
        code,
        message: 'Decision outcome delivery binding is unavailable.',
        recovery: 'Repair or regenerate the local decision outcome ledger, then retry the delivery operation.'
      }
    };
  }
}

function required(value, errorId, message) {
  if (value == null || String(value).trim() === '') throw new OutcomeCommandError(errorId, message);
  return String(value).trim();
}

function safeOutcomeText(value, maxLength) {
  return typeof value === 'string'
    && value.trim().length > 0
    && value.length <= maxLength
    && !/[\u0000-\u001f\u007f]/.test(value);
}

function isJsonSafeOutcomeValue(value, ancestors = new WeakSet(), depth = 0) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value !== 'object' || depth > 64 || ancestors.has(value)) return false;
  ancestors.add(value);
  let valid;
  if (Array.isArray(value)) valid = value.every((item) => isJsonSafeOutcomeValue(item, ancestors, depth + 1));
  else if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) valid = false;
  else valid = Object.entries(value).every(([key, item]) => (
    !/[\u0000-\u001f\u007f]/.test(key) && isJsonSafeOutcomeValue(item, ancestors, depth + 1)
  ));
  ancestors.delete(value);
  return valid;
}

export function requireOutcomeStoryId(value, missingMessage = 'outcome requires --id <story-id>') {
  const storyId = required(value, 'outcome_story_required', missingMessage);
  if (!OUTCOME_STORY_ID_PATTERN.test(storyId)
      || storyId.includes('..')
      || /[\\/%]/.test(storyId)
      || decodeSafely(storyId) !== storyId) {
    throw new OutcomeCommandError('outcome_story_invalid', 'outcome requires a valid story id');
  }
  return storyId;
}

function decodeSafely(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return '';
  }
}

function parseSelector(options) {
  const hasTrace = Boolean(options.traceId);
  const hasCollision = Boolean(options.collisionGroup || options.traceSourceRef);
  if (hasTrace === hasCollision || (hasCollision && !(options.collisionGroup && options.traceSourceRef))) {
    throw new OutcomeCommandError('outcome_selector_invalid', 'use exactly one selector: --trace, or --collision-group with --trace-source-ref');
  }
  return hasTrace
    ? { decision_trace_id: options.traceId }
    : { collision_group: options.collisionGroup, trace_source_ref: options.traceSourceRef };
}

function traceMatches(trace, selector) {
  if (selector.decision_trace_id) return trace.decision_trace_id === selector.decision_trace_id;
  return trace.decision_trace_id == null
    && trace.collision_group === selector.collision_group
    && trace.trace_source_ref === selector.trace_source_ref;
}

function resolveSource(trace, requestedRef, ledger) {
  const sourceSet = trace.eligible_outcome_sources ?? { total_count: 0, entries: [] };
  const entries = sourceSet.entries ?? [];
  if (sourceSet.total_count === 0 || entries.length === 0) {
    throw sourceError('outcome_source_missing', 'no eligible outcome source is available', sourceSet, ledger,
      'Record current trace-specific verification evidence or an accepted waiver, rerun pr prepare and usage report, then retry outcome record.');
  }
  if (requestedRef) {
    const matches = entries.filter((entry) => entry.ref === requestedRef);
    if (matches.length === 1) return matches[0];
    throw sourceError('outcome_source_untrusted', 'specified source is not an eligible source', sourceSet, ledger);
  }
  if (sourceSet.total_count !== 1 || entries.length !== 1) {
    throw sourceError('outcome_source_not_unique', 'eligible outcome source must resolve exactly one entry', sourceSet, ledger);
  }
  return entries[0];
}

async function verifyManagedSource(root, storyId, source, trace, ledger) {
  const relative = String(source.ref ?? '').replaceAll('\\', '/');
  const untrusted = (message) => sourceError(
    'outcome_source_untrusted',
    message,
    trace.eligible_outcome_sources ?? { total_count: 0, returned_count: 0, omitted_count: 0, truncated: false, entries: [] },
    ledger,
    'Run vibepro usage report --json, select the current trace parent revision and one eligible source ref, then retry outcome record with --source.'
  );
  const allowed = [
    `.vibepro/pr/${storyId}/verification-evidence.json`,
    `.vibepro/pr/${storyId}/decision-records.json`
  ];
  if (!allowed.includes(relative)) {
    throw untrusted('source is outside the managed outcome authority paths');
  }
  const absolute = path.resolve(root, relative);
  if (!absolute.startsWith(`${root}${path.sep}`)) throw untrusted('source path escaped repository root');
  let bytes;
  try {
    bytes = await readFile(absolute);
  } catch {
    throw untrusted('managed source is unreadable');
  }
  if (digestDecisionOutcomeBytes(bytes) !== source.digest) {
    throw untrusted('managed source digest does not match the ledger candidate');
  }
  let payload;
  try { payload = JSON.parse(bytes.toString('utf8')); } catch { throw untrusted('managed source is malformed'); }
  if (payload.schema_version !== '0.1.0') throw untrusted('managed source schema is unsupported');
  if (payload.story_id !== storyId) throw untrusted('managed source story binding does not match');
  if (source.kind === 'verification_evidence') {
    const currentHeadSha = await gitOutput(root, ['rev-parse', 'HEAD']);
    const commands = [];
    for (const command of payload.commands ?? []) {
      if (command?.observation?.values?.decision_trace_key !== trace.normalized_subject_key
        || command?.observation?.values?.behavior_before == null
        || command?.observation?.values?.behavior_after == null) continue;
      if (await commandBindingIsCurrent(root, command, currentHeadSha)) commands.push(command);
    }
    if (commands.length === 0) {
      throw untrusted('verification source has no current command bound to the selected trace');
    }
  }
  if (source.kind === 'decision_record') {
    const acceptedWaivers = (payload.decisions ?? []).filter((decision) => (
      decision.schema_version === '0.1.0'
      && decision.type === 'waiver'
      && decision.status === 'accepted'
      && decision.story_id === storyId
      && normalizeOutcomeSubjectKey(decision.source) === trace.normalized_subject_key
      && decision.artifact === relative
    ));
    if (acceptedWaivers.length === 0) {
      throw untrusted('decision source has no accepted waiver authority bound to the selected trace');
    }
  }
}

function normalizeOutcomeSubjectKey(value) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return /^(?:finding|gate):[^\s]+$/.test(normalized) ? normalized : null;
}

async function assertMerged(root, storyId, options = {}) {
  let merge;
  try {
    merge = JSON.parse(await readFile(path.join(getWorkspaceDir(root), 'pr', storyId, 'pr-merge.json'), 'utf8'));
  } catch {
    throw new OutcomeCommandError('outcome_not_merged', 'outcome operations require a verified merge artifact');
  }
  if (!['merged', 'merged_externally'].includes(merge.status) || !merge.merge_commit_sha || !merge.pr?.url) {
    throw new OutcomeCommandError('outcome_not_merged', 'merge artifact is not identity-complete');
  }
  if (merge.story?.story_id !== storyId) {
    throw new OutcomeCommandError('outcome_not_merged', 'merge artifact story binding does not match');
  }
  let created;
  try {
    created = JSON.parse(await readFile(path.join(getWorkspaceDir(root), 'pr', storyId, 'pr-create.json'), 'utf8'));
  } catch {
    throw new OutcomeCommandError('outcome_not_merged', 'merge authority requires its bound PR creation artifact');
  }
  if (created.story?.story_id !== storyId && created.story_id !== storyId) {
    throw new OutcomeCommandError('outcome_not_merged', 'PR creation artifact story binding does not match');
  }
  if (created.pr_url !== merge.pr.url && created.pr?.url !== merge.pr.url) {
    throw new OutcomeCommandError('outcome_not_merged', 'merge artifact is not bound to the created PR identity');
  }
  const createdHead = created.current_head_sha ?? created.pr?.head_ref_oid ?? created.pr?.head_sha ?? null;
  const mergedHead = merge.current_head_sha ?? null;
  const prHead = merge.pr?.head_ref_oid ?? merge.pr?.head_sha ?? null;
  if (!createdHead || !mergedHead || !prHead || createdHead !== mergedHead || createdHead !== prHead) {
    throw new OutcomeCommandError('outcome_not_merged', 'merge authority is not bound to one PR head commit');
  }
  const base = String(merge.base ?? merge.git?.base_branch ?? created.base ?? '').replace(/^origin\//, '');
  if (!base) throw new OutcomeCommandError('outcome_not_merged', 'merge artifact base identity is missing');
  const strategy = merge.strategy;
  if (!['merge', 'squash', 'rebase'].includes(strategy)) {
    throw new OutcomeCommandError('outcome_not_merged', 'merge artifact strategy identity is missing');
  }
  try {
    const prNumber = merge.pr?.number ?? parsePullRequestNumber(merge.pr.url);
    if (!prNumber) throw new Error('PR number missing');
    const remoteUrl = await gitOutput(root, ['config', '--get', 'remote.origin.url'], options, 'outcome_authority.remote_url');
    if (!prUrlMatchesRemote(merge.pr.url, remoteUrl)) throw new Error('PR URL does not match origin');
    const remotePullHead = await gitOutput(root, ['ls-remote', 'origin', `refs/pull/${prNumber}/head`], options, 'outcome_authority.remote_pull_head');
    if (remotePullHead?.split(/\s+/)[0] !== createdHead) throw new Error('remote pull head mismatch');
    const livePr = await readAuthoritativePullRequest(root, merge.pr.url, options);
    if (livePr?.state !== 'MERGED'
      || livePr?.url !== merge.pr.url
      || livePr?.headRefOid !== createdHead
      || livePr?.baseRefName !== base
      || livePr?.mergeCommit?.oid !== merge.merge_commit_sha) {
      throw new Error('live PR merge authority mismatch');
    }
    await requireOutcomeCommand(root, ['git', ['cat-file', '-e', `${createdHead}^{commit}`]], 'outcome_authority.local_pr_head', options);
    await requireOutcomeCommand(root, ['git', ['cat-file', '-e', `${merge.merge_commit_sha}^{commit}`]], 'outcome_authority.local_merge_commit', options);
    await requireOutcomeCommand(root, ['git', ['fetch', 'origin', base]], 'outcome_authority.base_fetch', options);
    await requireOutcomeCommand(root, ['git', ['merge-base', '--is-ancestor', merge.merge_commit_sha, `origin/${base}`]], 'outcome_authority.merge_on_base', options);
  } catch (error) {
    if (error instanceof OutcomeCommandError && error.error_id === 'outcome_authority_timeout') throw error;
    throw new OutcomeCommandError('outcome_not_merged', 'merge commit is not verified on the current canonical base', {
      ...classifyMergeAuthorityFailure(error)
    });
  }
  return merge;
}

function classifyMergeAuthorityFailure(error) {
  const message = String(error?.message ?? error);
  if (/\b(?:401|authentication|not logged in|login required|bad credentials)\b/i.test(message)) {
    return {
      verification_failure: 'authentication denied while verifying live PR authority',
      recovery: 'Run gh auth login or refresh credentials, confirm access to the merged PR, then retry.'
    };
  }
  if (/\b(?:403|permission denied|forbidden|insufficient permission)\b/i.test(message)) {
    return {
      verification_failure: 'permission denied while verifying live PR authority',
      recovery: 'Confirm repository and PR read permission for the active GitHub identity, then retry.'
    };
  }
  return {
    verification_failure: 'live PR authority verification failed',
    recovery: 'Verify the remote PR identity and canonical base, then retry.'
  };
}

async function readAuthoritativePullRequest(root, prUrl, options) {
  if (typeof options.githubPrView === 'function') {
    const result = await executeManagedOperation({
      stage: 'outcome_authority.github_pr_view',
      timeoutMs: options.githubPrViewTimeoutMs ?? options.commandTimeoutMs,
      runner: ({ signal, deadlineAt, timeoutMs }) => options.githubPrView({
        repoRoot: root, prUrl, signal, deadlineAt, timeoutMs
      })
    });
    if (result.status === 'timed_out') throw authorityTimeout(result);
    if (result.status === 'failed') throw result.error ?? new Error(result.diagnostic);
    return result.value;
  }
  const result = await requireOutcomeCommand(root, ['gh', [
    'pr', 'view', prUrl, '--json', 'url,state,headRefOid,baseRefName,mergeCommit'
  ]], 'outcome_authority.github_pr_view', options);
  return JSON.parse(result.stdout);
}

function parsePullRequestNumber(prUrl) {
  const match = String(prUrl ?? '').match(/\/pull\/(\d+)(?:\/|$)|\/pr\/(\d+)(?:\/|$)/);
  return match ? Number(match[1] ?? match[2]) : null;
}

export function prUrlMatchesRemote(prUrl, remoteUrl) {
  const remoteIdentity = repositoryIdentity(remoteUrl);
  if (!remoteIdentity) return false;
  try {
    const url = new URL(prUrl);
    const prSlug = url.pathname.replace(/^\//, '').split('/pull/')[0].replace(/\.git$/, '').toLowerCase();
    return url.hostname.toLowerCase() === remoteIdentity.host && prSlug === remoteIdentity.slug;
  } catch {
    return false;
  }
}

function repositoryIdentity(remoteUrl) {
  const value = String(remoteUrl ?? '').trim();
  const scp = value.match(/^(?:[^@/\s]+@)?([^:/\s]+):([^/\s]+\/[^/\s]+?)(?:\.git)?$/);
  if (scp) return { host: scp[1].toLowerCase(), slug: scp[2].toLowerCase() };
  try {
    const url = new URL(value);
    if (!['http:', 'https:', 'ssh:'].includes(url.protocol)) return null;
    const slug = url.pathname.replace(/^\//, '').replace(/\.git$/, '').toLowerCase();
    if (slug.split('/').length !== 2) return null;
    return { host: url.hostname.toLowerCase(), slug };
  } catch {
    return null;
  }
}

async function readObservations(root, storyId, ledger) {
  const dir = path.join(getWorkspaceDir(root), 'observations', storyId);
  let names;
  try { names = await readdir(dir); } catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  const jsonNames = names.filter((item) => item.endsWith('.json') && item !== 'manifest.json').sort();
  let manifest;
  try { manifest = JSON.parse(await readFile(path.join(dir, 'manifest.json'), 'utf8')); } catch {
    throw new OutcomeCommandError('outcome_observation_untrusted', 'managed observation manifest is missing or malformed');
  }
  const entries = Array.isArray(manifest.entries) ? manifest.entries : [];
  if (manifest.story_id !== storyId || !Array.isArray(manifest.entries)) {
    throw new OutcomeCommandError('outcome_observation_untrusted', 'managed observation manifest has an invalid story binding');
  }
  return validateObservationManifestEntries(root, storyId, dir, manifest, jsonNames, ledger);
}

async function validateObservationManifestEntries(root, storyId, dir, manifest, jsonNames, ledger = null) {
  const entries = manifest.entries;
  const jsonNameSet = new Set(jsonNames);
  const managedNames = new Set();
  const managedIds = new Set();
  for (const entry of entries) {
    const name = entry?.artifact_name;
    if (typeof name !== 'string'
      || path.basename(name) !== name
      || !name.endsWith('.json')
      || name === 'manifest.json'
      || managedNames.has(name)
      || typeof entry?.observation_id !== 'string'
      || managedIds.has(entry.observation_id)) {
      throw new OutcomeCommandError('outcome_observation_untrusted', 'managed observation manifest contains an invalid or duplicate entry');
    }
    managedNames.add(name);
    managedIds.add(entry.observation_id);
    if (!jsonNameSet.has(name)) {
      throw new OutcomeCommandError('outcome_observation_malformed', 'managed observation artifact registered by the manifest is missing', {
        artifact_path: toWorkspaceRelative(root, path.join(dir, name))
      });
    }
  }
  const observations = [];
  for (const name of jsonNames) {
    const managed = entries.find((entry) => entry.artifact_name === name);
    if (!managed) throw new OutcomeCommandError('outcome_observation_untrusted', 'observation is not registered in the managed manifest', { artifact_path: toWorkspaceRelative(root, path.join(dir, name)) });
    try {
      const bytes = await readFile(path.join(dir, name));
      if (digestDecisionOutcomeBytes(bytes) !== managed.artifact_digest) throw new Error('digest mismatch');
      const observation = JSON.parse(bytes.toString('utf8'));
      const { observation_id: ignored, ...observationCore } = observation;
      const validation = validateDecisionOutcomeObservation(observation, { storyId });
      if (!validation.valid) throw observationValidationError(validation.code, root, dir, name);
      if (observation.observation_id !== managed.observation_id
        || `${observation.observation_id}.json` !== name
        || observation.observation_id !== `obs_${canonicalDigest(observationCore)}`
        || observation.story_id !== storyId
        || observation.source_ref !== managed.source_ref
        || observation.authority?.source_digest !== managed.source_digest
        || observation.parent_revision_fingerprint !== managed.parent_revision_fingerprint
        || canonicalDigest(observation.trace_selector) !== canonicalDigest(managed.trace_selector)) throw new Error('identity mismatch');
      if (ledger) {
        const traces = (ledger.traces ?? []).filter((trace) => matchesDecisionOutcomeObservation(trace, observation));
        if (traces.length !== 1) {
          throw observationValidationError('observation_binding_mismatch', root, dir, name);
        }
        try {
          await verifyManagedSource(root, storyId, {
            ref: observation.source_ref,
            digest: observation.authority.source_digest,
            kind: observation.authority.kind
          }, traces[0], ledger);
        } catch (error) {
          if (error instanceof OutcomeCommandError && error.error_id === 'outcome_source_untrusted') {
            throw observationValidationError('observation_untrusted', root, dir, name);
          }
          throw error;
        }
      }
      observations.push(observation);
    } catch (error) {
      if (error instanceof OutcomeCommandError) throw error;
      throw new OutcomeCommandError('outcome_observation_malformed', 'managed observation artifact is malformed or its digest does not match', {
        artifact_path: toWorkspaceRelative(root, path.join(dir, name))
      });
    }
  }
  return observations;
}

function observationValidationError(code, root, dir, name) {
  const errorId = code === 'observation_untrusted'
    ? 'outcome_observation_untrusted'
    : code === 'observation_binding_mismatch'
      ? 'outcome_observation_binding_mismatch'
      : 'outcome_observation_malformed';
  return new OutcomeCommandError(errorId, 'managed observation artifact failed validation', {
    artifact_path: toWorkspaceRelative(root, path.join(dir, name))
  });
}

async function registerObservation(root, storyId, observation, artifactPath, bytes) {
  const dir = path.dirname(artifactPath);
  const manifestPath = path.join(dir, 'manifest.json');
  const lockPath = `${manifestPath}.lock`;
  await acquireObservationManifestLock(lockPath);
  let artifactCreated = false;
  try {
    let manifest = { schema_version: '0.1.0', story_id: storyId, entries: [] };
    try { manifest = JSON.parse(await readFile(manifestPath, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (manifest.story_id !== storyId || !Array.isArray(manifest.entries)) {
      throw new OutcomeCommandError('outcome_observation_untrusted', 'managed observation manifest has an invalid story binding');
    }
    const pendingName = path.basename(artifactPath);
    const pendingIsRegistered = manifest.entries.some((item) => item?.artifact_name === pendingName);
    const directoryNames = await readdir(dir);
    const pendingExists = directoryNames.includes(pendingName);
    const existingNames = directoryNames
      .filter((item) => item.endsWith('.json')
        && item !== 'manifest.json'
        && item !== pendingName)
      .sort();
    if (!pendingIsRegistered && pendingExists) {
      throw new OutcomeCommandError('outcome_observation_untrusted', 'observation is not registered in the managed manifest', {
        artifact_path: toWorkspaceRelative(root, artifactPath)
      });
    }
    if (pendingIsRegistered && pendingExists) existingNames.push(pendingName);
    existingNames.sort();
    await validateObservationManifestEntries(root, storyId, dir, manifest, existingNames);
    const entry = {
      observation_id: observation.observation_id,
      artifact_name: pendingName,
      artifact_digest: digestDecisionOutcomeBytes(bytes),
      source_ref: observation.source_ref,
      source_digest: observation.authority.source_digest,
      parent_revision_fingerprint: observation.parent_revision_fingerprint,
      trace_selector: observation.trace_selector
    };
    if (!pendingIsRegistered) {
      await writeFile(artifactPath, bytes, { flag: 'wx' });
      artifactCreated = true;
    }
    if (!manifest.entries.some((item) => item.observation_id === entry.observation_id)) manifest.entries.push(entry);
    manifest.entries.sort((a, b) => a.observation_id.localeCompare(b.observation_id));
    const temp = `${manifestPath}.${process.pid}.${Math.random().toString(16).slice(2)}.tmp`;
    await writeFile(temp, `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx' });
    await rename(temp, manifestPath);
  } catch (error) {
    if (artifactCreated) await unlink(artifactPath).catch(() => {});
    throw error;
  } finally {
    await rm(lockPath, { recursive: true, force: true });
  }
}

async function acquireObservationManifestLock(lockPath) {
  const attempts = 200;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      await mkdir(lockPath);
      return;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      try {
        const lockStat = await stat(lockPath);
        if (Date.now() - lockStat.mtimeMs > 30_000) {
          await rm(lockPath, { recursive: true, force: true });
          continue;
        }
      } catch (statError) {
        if (statError.code !== 'ENOENT') throw statError;
        continue;
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }
  throw new OutcomeCommandError('outcome_observation_lock_timeout', 'timed out waiting for the managed observation manifest lock');
}

async function commandBindingIsCurrent(root, command, currentHeadSha) {
  if (command?.binding?.status === 'stale' || command?.content_binding?.status === 'stale') return false;
  if (command?.content_binding) {
    const evaluated = await evaluateContentBinding(root, command.content_binding, { head_sha: currentHeadSha });
    if (command.content_binding.mode === 'strict_head') {
      return evaluated?.status === 'strict_head'
        && command.content_binding.recorded_head_sha === currentHeadSha
        && command?.git_context?.head_sha === currentHeadSha;
    }
    return evaluated?.status === 'current';
  }
  return command?.binding?.status === 'current' || command?.git_context?.head_sha === currentHeadSha;
}

async function gitOutput(root, args, options = {}, stage = 'outcome.git') {
  const result = await executeOutcomeCommand(root, ['git', args], stage, options);
  if (['timed_out', 'indeterminate'].includes(result.status)) throw authorityTimeout(result);
  return result.exit_code === 0 ? result.stdout.trim() : null;
}

async function requireOutcomeCommand(root, command, stage, options = {}) {
  const result = await executeOutcomeCommand(root, command, stage, options);
  if (['timed_out', 'indeterminate'].includes(result.status)) throw authorityTimeout(result);
  if (result.exit_code !== 0) throw new Error(result.stderr || `${stage} failed`);
  return result;
}

function executeOutcomeCommand(root, command, stage, options) {
  return executeManagedCommand({
    command,
    stage,
    cwd: root,
    env: options.env,
    timeoutMs: options.commandTimeoutMs,
    terminationGraceMs: options.terminationGraceMs,
    closeTimeoutMs: options.closeTimeoutMs,
    maxOutputBytes: options.maxDiagnosticBytes,
    redactValues: options.redactValues,
    runner: typeof options.commandRunner === 'function'
      ? ({ runDefault, signal, deadlineAt, timeoutMs }) => options.commandRunner({
        repoRoot: root, command, stage, runDefault, signal, deadlineAt, timeoutMs
      })
      : null
  });
}

function authorityTimeout(result) {
  return new OutcomeCommandError(
    'outcome_authority_timeout',
    'outcome authority verification exceeded its bounded command deadline',
    {
      stage: result.stage,
      failure_kind: result.failure_kind,
      timeout_ms: result.timeout_ms,
      recovery: 'Retry after confirming Git and GitHub authority services are responsive; no outcome state was changed.'
    }
  );
}

function sourceError(errorId, message, sourceSet, ledger, recovery = 'Run vibepro usage report --json, select one eligible source ref, then retry outcome record with --source.') {
  return new OutcomeCommandError(errorId, message, {
    ledger_path: ledger.artifact_path,
    ledger_digest: ledger.artifact_digest,
    eligible_outcome_sources: sourceSet,
    recovery
  });
}

async function snapshotDirectory(target) {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'vibepro-outcome-snapshot-'));
  const backup = path.join(tempRoot, 'canonical');
  let existed = false;
  try { existed = (await stat(target)).isDirectory(); } catch {}
  if (existed) await cp(target, backup, { recursive: true });
  return { tempRoot, backup, existed };
}

async function restoreDirectory(target, snapshot) {
  await rm(target, { recursive: true, force: true });
  if (snapshot.existed) {
    await mkdir(path.dirname(target), { recursive: true });
    await cp(snapshot.backup, target, { recursive: true });
  }
}

function deliveryFromMerge(storyId, merge) {
  const prNumber = merge.pr.number ?? parsePullRequestNumber(merge.pr.url);
  return {
    story_id: storyId,
    status: 'merged',
    pr: {
      ...(prNumber == null ? {} : { number: prNumber }),
      url: merge.pr.url,
      state: merge.pr.state ?? 'MERGED'
    },
    merge: {
      sha: merge.merge_commit_sha,
      status: merge.status,
      ...(merge.merged_at == null ? {} : { merged_at: merge.merged_at })
    },
    source_ref: `.vibepro/pr/${storyId}/pr-merge.json`
  };
}

function boundedError(errorId, message, ledger, candidates) {
  const recovery = errorId === 'outcome_parent_stale'
    ? 'Run vibepro usage report --json, use the selected trace current parent_revision_fingerprint, then retry outcome record.'
    : 'Run vibepro usage report --json, choose exactly one returned trace or collision selector, then retry outcome record.';
  return new OutcomeCommandError(errorId, message, {
    ledger_path: ledger.artifact_path,
    ledger_digest: ledger.artifact_digest,
    candidate_count: candidates.length,
    candidates: candidates.slice(0, 5).map((trace) => ({
      decision_trace_id: trace.decision_trace_id,
      collision_group: trace.collision_group,
      trace_source_ref: trace.trace_source_ref,
      parent_revision_fingerprint: trace.parent_revision_fingerprint
    })),
    omitted_count: Math.max(0, candidates.length - 5),
    truncated: candidates.length > 5,
    recovery
  });
}

function canonicalDigest(value) {
  return createHash('sha256').update(JSON.stringify(sortObject(value))).digest('hex');
}

function sortObject(value) {
  if (Array.isArray(value)) return value.map(sortObject);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortObject(value[key])]));
}
