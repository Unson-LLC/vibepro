import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { resolveGitIdentity } from './git-identity.js';
import { getWorkspaceDir } from './workspace.js';

export const RUN_CONTEXT_CAPSULE_SCHEMA_VERSION = '0.1.0';
export const RUN_CONTEXT_CAPSULE_MAX_BYTES = 32 * 1024;

const STORY_ID_PATTERN = /^story-[a-z0-9][a-z0-9._-]*$/;
const RUN_ID_PATTERN = /^run-\d{8}T\d{6}Z-[0-9a-f]{8}$/;
const ACTIVE_RUN_STATUSES = new Set(['running', 'waiting_for_human', 'waiting_for_runtime', 'blocked', 'failed']);
const DEPENDENCY_KEYS = new Set(['now', 'resolveHead', 'artifactIo']);
const ARTIFACT_IO_KEYS = new Set(['readFile', 'writeFile', 'rename', 'mkdir', 'readdir', 'rm']);
const defaultArtifactIo = { readFile, writeFile, rename, mkdir, readdir, rm };

export class RunContextCapsuleError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'RunContextCapsuleError';
    this.code = code;
    this.details = details;
  }
}

export function createRunContextCapsule(dependencies = {}) {
  assertClosedKeys(dependencies, DEPENDENCY_KEYS, 'Run Context Capsule dependency');
  assertClosedKeys(dependencies.artifactIo ?? {}, ARTIFACT_IO_KEYS, 'Run Context Capsule artifact I/O dependency');
  const deps = {
    now: dependencies.now ?? (() => new Date()),
    resolveHead: dependencies.resolveHead ?? (async (root) => (await resolveGitIdentity(root)).head_sha),
    artifactIo: { ...defaultArtifactIo, ...(dependencies.artifactIo ?? {}) }
  };
  return {
    refresh: (repoRoot, options = {}) => refreshCapsule(deps, repoRoot, options),
    read: (repoRoot, options = {}) => readCapsule(deps, repoRoot, options),
    recover: (repoRoot, options = {}) => recoverCapsule(deps, repoRoot, options)
  };
}

export async function refreshRunContextCapsule(repoRoot, options = {}) {
  return createRunContextCapsule().refresh(repoRoot, options);
}

export async function readRunContextCapsule(repoRoot, options = {}) {
  return createRunContextCapsule().read(repoRoot, options);
}

export async function recoverRunContext(repoRoot, options = {}) {
  return createRunContextCapsule().recover(repoRoot, options);
}

export async function refreshContextCapsuleForRun(options = {}) {
  try {
    const state = options.state;
    if (!state?.execution_context?.root_realpath) {
      throw capsuleError('invalid_capsule', 'Run state does not identify an authoritative execution root.');
    }
    return await refreshRunContextCapsule(state.execution_context.root_realpath, {
      storyId: state.story_id,
      runId: state.run_id,
      state,
      authorityFile: options.authorityFile,
      mirrorFile: options.mirrorFile,
      reason: options.reason ?? 'run_state_persisted'
    });
  } catch (error) {
    return {
      status: 'projection_failed',
      code: error.code ?? 'context_capsule_projection_failed',
      message: error.message
    };
  }
}

export async function refreshActiveRunContextCapsule(repoRoot, options = {}) {
  try {
    const storyId = requireStoryId(options.storyId);
    const localRoot = path.resolve(repoRoot);
    const runsRoot = getRunsRoot(localRoot, storyId);
    const entries = await readDirectoryOrEmpty(defaultArtifactIo, runsRoot);
    const candidates = [];
    for (const entry of entries) {
      if (!entry.isDirectory?.() || !RUN_ID_PATTERN.test(entry.name)) continue;
      const localStateFile = path.join(runsRoot, entry.name, 'state.json');
      const raw = await readOptional(defaultArtifactIo, localStateFile);
      if (raw === null) continue;
      const state = parseJson(raw, localStateFile);
      if (state.story_id === storyId && state.run_id === entry.name && ACTIVE_RUN_STATUSES.has(state.status)) {
        candidates.push({ state, localStateFile });
      }
    }
    if (candidates.length === 0) return { status: 'no_active_run', regenerated: false };
    if (candidates.length > 1) {
      return {
        status: 'ambiguous_active_run',
        regenerated: false,
        run_ids: candidates.map(({ state }) => state.run_id).sort()
      };
    }
    const [{ state, localStateFile }] = candidates;
    const authorityRoot = path.resolve(state.execution_context?.root_realpath ?? localRoot);
    const authorityFile = getRunStatePath(authorityRoot, storyId, state.run_id);
    const configuredMirrorFile = getConfiguredManagedMirrorFile(state, storyId, state.run_id);
    const mirrorCandidate = configuredMirrorFile ?? localStateFile;
    const mirrorFile = normalizeMirrorFile(mirrorCandidate, authorityFile);
    return await refreshRunContextCapsule(authorityRoot, {
      storyId,
      runId: state.run_id,
      state,
      authorityFile,
      mirrorFile,
      reason: options.reason ?? 'authoritative_artifact_recorded'
    });
  } catch (error) {
    return {
      status: 'projection_failed',
      regenerated: false,
      code: error.code ?? 'context_capsule_projection_failed',
      message: error.message
    };
  }
}

async function refreshCapsule(deps, repoRoot, options, behavior = {}) {
  const context = await loadRunContext(deps, repoRoot, options);
  await assertCurrentHead(deps, context);
  const sources = await collectSources(deps, context);
  const fingerprints = fingerprintSources(sources);
  const eventFingerprint = digest(JSON.stringify({
    story_id: context.state.story_id,
    run_id: context.state.run_id,
    head_sha: context.state.current_head_sha,
    run_status: context.state.status,
    source_fingerprints: fingerprints
  }));
  const capsuleFile = getCapsulePathFromStatePath(context.authorityFile);
  const existingRaw = behavior.replaceExisting ? null : await readOptional(deps.artifactIo, capsuleFile);
  if (existingRaw !== null) {
    const existing = parseCapsule(existingRaw, capsuleFile);
    if (existing.event_fingerprint === eventFingerprint
        && existing.story_id === context.state.story_id
        && existing.run_id === context.state.run_id
        && existing.head_sha === context.state.current_head_sha) {
      return { regenerated: false, capsule: existing, artifact: toRootRelative(context.authorityRoot, capsuleFile) };
    }
  }

  const sourceByKind = new Map(sources.map((source) => [source.kind, source]));
  const storyRaw = sourceByKind.get('story').raw;
  const prPrepare = parseOptionalSource(sourceByKind.get('pr_prepare'));
  const verification = parseOptionalSource(sourceByKind.get('verification'));
  const decisions = parseOptionalSource(sourceByKind.get('decisions'));
  const reviewSources = sources.filter((source) => source.kind.startsWith('review_'));
  const capsule = fitCapsule({
    schema_version: RUN_CONTEXT_CAPSULE_SCHEMA_VERSION,
    story_id: context.state.story_id,
    run_id: context.state.run_id,
    head_sha: context.state.current_head_sha,
    run_status: context.state.status,
    objective: extractObjective(storyRaw),
    invariants: extractInvariants(storyRaw),
    bottleneck: extractBottleneck(context.state, prPrepare),
    evidence_refs: buildEvidenceRefs({ sources, verification, reviewSources }),
    open_decisions: extractOpenDecisions(context.state, decisions, sourceByKind.get('decisions')),
    budget_state: {
      attempt: context.state.attempt,
      iteration: context.state.iteration,
      max_attempts: context.state.budget?.max_attempts ?? null,
      max_iterations: context.state.budget?.max_iterations ?? null,
      deadline: context.state.deadline ?? null
    },
    last_progress: extractLastProgress(context.state),
    generation_reason: normalizeReason(options.reason),
    generated_at: toIso(deps.now()),
    event_fingerprint: eventFingerprint,
    source_fingerprints: fingerprints,
    truncated_sections: [],
    size_bytes: 0
  });
  const raw = serializeCapsule(capsule);
  await writeRawAtomic(deps.artifactIo, capsuleFile, raw);
  if (context.mirrorFile) {
    const mirrorCapsule = getCapsulePathFromStatePath(context.mirrorFile);
    try {
      await writeRawAtomic(deps.artifactIo, mirrorCapsule, raw);
    } catch (error) {
      throw capsuleError('capsule_mirror_sync_failed', 'Context Capsule authority committed but mirror synchronization failed.', {
        authority_artifact: capsuleFile,
        mirror_artifact: mirrorCapsule,
        cause: error.message
      });
    }
  }
  return { regenerated: true, capsule, artifact: toRootRelative(context.authorityRoot, capsuleFile) };
}

async function readCapsule(deps, repoRoot, options) {
  const context = await loadRunContext(deps, repoRoot, options);
  await assertCurrentHead(deps, context);
  const capsuleFile = getCapsulePathFromStatePath(context.authorityFile);
  const raw = await readRequired(deps.artifactIo, capsuleFile, 'capsule_not_found', 'Run Context Capsule was not found.');
  if (Buffer.byteLength(raw) > RUN_CONTEXT_CAPSULE_MAX_BYTES) {
    throw capsuleError('capsule_size_exceeded', 'Run Context Capsule exceeds the 32 KiB read budget.', {
      artifact: capsuleFile,
      size_bytes: Buffer.byteLength(raw)
    });
  }
  const capsule = parseCapsule(raw, capsuleFile);
  validateCapsuleBinding(capsule, context.state);
  for (const source of capsule.source_fingerprints) {
    const sourcePath = resolveSourcePath(context.authorityRoot, source.source_ref);
    const sourceRaw = await readRequired(deps.artifactIo, sourcePath, 'missing_source', 'A Context Capsule source artifact is missing.', {
      source_ref: source.source_ref
    });
    if (digest(sourceRaw) !== source.digest) {
      throw capsuleError('stale_binding', 'A Context Capsule source fingerprint is stale.', {
        source_ref: source.source_ref
      });
    }
  }
  const currentFingerprints = fingerprintSources(await collectSources(deps, context));
  const recordedSourceSet = JSON.stringify(capsule.source_fingerprints);
  const currentSourceSet = JSON.stringify(currentFingerprints);
  if (recordedSourceSet !== currentSourceSet) {
    const recordedRefs = new Set(capsule.source_fingerprints.map((source) => source.source_ref));
    const currentRefs = new Set(currentFingerprints.map((source) => source.source_ref));
    throw capsuleError('stale_binding', 'The Run Context Capsule source set is stale.', {
      added_source_refs: [...currentRefs].filter((sourceRef) => !recordedRefs.has(sourceRef)).sort(),
      removed_source_refs: [...recordedRefs].filter((sourceRef) => !currentRefs.has(sourceRef)).sort()
    });
  }
  return capsule;
}

async function recoverCapsule(deps, repoRoot, options) {
  let capsule;
  try {
    capsule = await readCapsule(deps, repoRoot, options);
  } catch (error) {
    if (!options.rebuildOnStale || !(error instanceof RunContextCapsuleError)) throw error;
    await refreshCapsule(
      deps,
      repoRoot,
      { ...options, reason: 'explicit_rebuild' },
      { replaceExisting: true }
    );
    capsule = await readCapsule(deps, repoRoot, options);
  }
  return {
    binding: {
      story_id: capsule.story_id,
      run_id: capsule.run_id,
      head_sha: capsule.head_sha
    },
    status: capsule.run_status,
    objective: capsule.objective,
    invariants: capsule.invariants,
    bottleneck: capsule.bottleneck,
    open_decisions: capsule.open_decisions,
    evidence_refs: capsule.evidence_refs,
    budget_state: capsule.budget_state,
    last_progress: capsule.last_progress,
    truncated_sections: capsule.truncated_sections
  };
}

async function loadRunContext(deps, repoRoot, options) {
  const storyId = requireStoryId(options.storyId);
  const runId = requireRunId(options.runId);
  const requestedRoot = path.resolve(repoRoot);
  let authorityFile = options.authorityFile
    ? path.resolve(options.authorityFile)
    : getRunStatePath(requestedRoot, storyId, runId);
  let stateRaw = await readRequired(deps.artifactIo, authorityFile, 'missing_source', 'The authoritative guarded Run state is missing.', {
    source_ref: authorityFile
  });
  let state = parseJson(stateRaw, authorityFile);
  assertRunStateIdentity(state, storyId, runId);
  const authorityRoot = path.resolve(state.execution_context?.root_realpath ?? requestedRoot);
  const canonicalAuthorityFile = getRunStatePath(authorityRoot, storyId, runId);
  if (!options.authorityFile || path.resolve(authorityFile) !== path.resolve(canonicalAuthorityFile)) {
    authorityFile = canonicalAuthorityFile;
    stateRaw = await readRequired(deps.artifactIo, authorityFile, 'missing_source', 'The authoritative guarded Run state is missing.', {
      source_ref: authorityFile
    });
    state = parseJson(stateRaw, authorityFile);
    assertRunStateIdentity(state, storyId, runId);
  }
  const configuredMirrorFile = getConfiguredManagedMirrorFile(state, storyId, runId);
  const mirrorCandidate = options.mirrorFile ? path.resolve(options.mirrorFile) : configuredMirrorFile;
  return {
    requestedRoot,
    authorityRoot,
    authorityFile,
    mirrorFile: normalizeMirrorFile(mirrorCandidate, authorityFile),
    state,
    stateRaw
  };
}

function assertRunStateIdentity(state, storyId, runId) {
  if (state.story_id !== storyId || state.run_id !== runId) {
    throw capsuleError('stale_binding', 'Run state identity does not match the requested capsule binding.', {
      expected_story_id: storyId,
      expected_run_id: runId,
      actual_story_id: state.story_id ?? null,
      actual_run_id: state.run_id ?? null
    });
  }
}

function getConfiguredManagedMirrorFile(state, storyId, runId) {
  const sourceRepo = state.execution_context?.authority_kind === 'managed'
    && typeof state.managed_worktree?.source_repo === 'string'
    && state.managed_worktree.source_repo.trim().length > 0
    ? path.resolve(state.managed_worktree.source_repo)
    : null;
  return sourceRepo ? getRunStatePath(sourceRepo, storyId, runId) : null;
}

function normalizeMirrorFile(candidate, authorityFile) {
  if (!candidate) return null;
  const resolvedCandidate = path.resolve(candidate);
  return resolvedCandidate === path.resolve(authorityFile) ? null : resolvedCandidate;
}

async function assertCurrentHead(deps, context) {
  const actualHead = await deps.resolveHead(context.authorityRoot);
  if (typeof actualHead !== 'string' || actualHead !== context.state.current_head_sha) {
    throw capsuleError('stale_binding', 'Run Context Capsule HEAD binding is stale.', {
      expected_head_sha: context.state.current_head_sha,
      actual_head_sha: actualHead ?? null
    });
  }
}

async function collectSources(deps, context) {
  const storyPath = await findStoryPath(deps.artifactIo, context.authorityRoot, context.state.story_id);
  const required = [
    await loadSource(deps.artifactIo, context.authorityRoot, 'run_state', context.authorityFile, true),
    await loadSource(deps.artifactIo, context.authorityRoot, 'story', storyPath, true)
  ];
  const workspace = getWorkspaceDir(context.authorityRoot);
  const storyId = context.state.story_id;
  const optionalPaths = [
    ['pr_prepare', path.join(workspace, 'pr', storyId, 'pr-prepare.json')],
    ['verification', path.join(workspace, 'pr', storyId, 'verification-evidence.json')],
    ['decisions', path.join(workspace, 'pr', storyId, 'decision-records.json')],
    ['review_test_plan', path.join(workspace, 'reviews', storyId, 'test_plan', 'review-summary.json')],
    ['review_gate', path.join(workspace, 'reviews', storyId, 'gate', 'review-summary.json')]
  ];
  const optional = [];
  for (const [kind, sourcePath] of optionalPaths) {
    const raw = await readOptional(deps.artifactIo, sourcePath);
    if (raw !== null) optional.push(buildSource(context.authorityRoot, kind, sourcePath, raw, false));
  }
  return [...required, ...optional];
}

function fingerprintSources(sources) {
  return sources.map((source) => ({
    kind: source.kind,
    source_ref: source.sourceRef,
    digest: digest(source.raw),
    required: source.required
  })).sort((left, right) => left.source_ref.localeCompare(right.source_ref));
}

async function findStoryPath(io, root, storyId) {
  const roots = [
    path.join(root, 'docs', 'management', 'stories', 'active'),
    path.join(root, 'docs', 'management', 'stories', 'completed'),
    path.join(root, 'docs', 'management', 'stories', 'done')
  ];
  for (const storyRoot of roots) {
    const direct = path.join(storyRoot, `${storyId}.md`);
    const raw = await readOptional(io, direct);
    if (raw === null) continue;
    const declaredStoryId = raw.match(/^story_id:\s*([^\s]+)\s*$/m)?.[1] ?? null;
    if (declaredStoryId !== storyId) {
      throw capsuleError('stale_binding', 'Story document identity does not match the Run Context Capsule binding.', {
        expected_story_id: storyId,
        actual_story_id: declaredStoryId,
        source_ref: toRootRelative(root, direct)
      });
    }
    return direct;
  }
  throw capsuleError('missing_source', 'The registered Story document required by the Context Capsule is missing.', {
    story_id: storyId
  });
}

async function loadSource(io, root, kind, sourcePath, required) {
  const raw = await readRequired(io, sourcePath, 'missing_source', 'A required Context Capsule source is missing.', {
    source_ref: toRootRelative(root, sourcePath)
  });
  return buildSource(root, kind, sourcePath, raw, required);
}

function buildSource(root, kind, sourcePath, raw, required) {
  return { kind, path: sourcePath, sourceRef: toRootRelative(root, sourcePath), raw, required };
}

function buildEvidenceRefs({ sources, verification, reviewSources }) {
  const refs = [];
  const prSource = sources.find((source) => source.kind === 'pr_prepare');
  if (prSource) refs.push(reference(prSource, summarizePrPrepare(parseOptionalSource(prSource))));
  const verificationSource = sources.find((source) => source.kind === 'verification');
  if (verificationSource) refs.push(reference(verificationSource, summarizeVerification(verification)));
  for (const source of reviewSources) refs.push(reference(source, summarizeReview(parseOptionalSource(source))));
  return refs;
}

function reference(source, summary) {
  return {
    kind: source.kind,
    source_ref: source.sourceRef,
    digest: digest(source.raw),
    summary
  };
}

function summarizePrPrepare(value) {
  const gate = value?.gate_status;
  return compactText(`overall=${gate?.overall_status ?? 'unknown'} ready=${gate?.ready_for_pr_create === true}`, 256);
}

function summarizeVerification(value) {
  const commands = Array.isArray(value?.commands) ? value.commands : [];
  return compactText(commands.map((item) => `${item.kind ?? 'unknown'}:${item.status ?? 'unknown'}`).join(', ') || 'no commands', 512);
}

function summarizeReview(value) {
  const status = value?.status ?? value?.overall_status ?? value?.summary?.status ?? 'unknown';
  return compactText(`status=${status}`, 256);
}

function extractBottleneck(state, prPrepare) {
  const blocking = prPrepare?.gate_status?.execution_gate?.blocking_gates;
  if (Array.isArray(blocking) && blocking.length > 0) {
    const first = blocking[0];
    return {
      kind: 'gate',
      id: compactText(first.id ?? 'unknown_gate', 160),
      status: compactText(first.status ?? 'unknown', 80),
      label: compactText(first.label ?? first.id ?? 'Blocking gate', 240),
      reason: compactText(first.reason ?? 'Gate is unresolved.', 512),
      source_ref: `.vibepro/pr/${state.story_id}/pr-prepare.json`
    };
  }
  if (state.stop_reason) {
    return {
      kind: 'run_stop',
      id: compactText(state.stop_reason.code, 160),
      status: state.status,
      label: compactText(state.stop_reason.message, 240),
      reason: compactText(state.stop_reason.message, 512),
      source_ref: `.vibepro/executions/${state.story_id}/runs/${state.run_id}/state.json`
    };
  }
  return null;
}

function extractOpenDecisions(state, decisions, decisionSource) {
  const items = [];
  if (state.pending_decision && typeof state.pending_decision === 'object') {
    items.push({
      id: compactText(state.pending_decision.id ?? 'run_pending_decision', 160),
      prompt: compactText(state.pending_decision.prompt ?? state.pending_decision.summary ?? 'Run decision is pending.', 512),
      source_ref: `.vibepro/executions/${state.story_id}/runs/${state.run_id}/state.json`
    });
  }
  for (const decision of Array.isArray(decisions?.decisions) ? decisions.decisions : []) {
    if (decision?.status !== 'open') continue;
    items.push({
      id: compactText(decision.id ?? decision.decision_id ?? 'open_decision', 160),
      prompt: compactText(decision.summary ?? decision.title ?? 'Decision is open.', 512),
      source_ref: decisionSource?.sourceRef ?? `.vibepro/pr/${state.story_id}/decision-records.json`
    });
  }
  const seen = new Set();
  return items.filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}

function extractObjective(storyRaw) {
  for (const pattern of [/\*\*So that\*\*\s*([^\n]+)/i, /\*\*I want\*\*\s*([^\n]+)/i, /^#\s+([^\n]+)/m]) {
    const match = storyRaw.match(pattern);
    if (match) return compactText(match[1], 4096);
  }
  return 'Continue the guarded Run using the registered Story intent.';
}

function extractInvariants(storyRaw) {
  const section = storyRaw.match(/##\s+Non Goals\s*\n([\s\S]*?)(?=\n##\s+|$)/i)?.[1] ?? '';
  const bullets = [...section.matchAll(/^\s*-\s+(.+)$/gm)].map((match) => compactText(match[1], 512));
  return bullets.length > 0 ? bullets.slice(0, 64) : ['The capsule remains a non-authoritative projection.'];
}

function extractLastProgress(state) {
  const transition = Array.isArray(state.transitions) ? state.transitions.at(-1) : null;
  return {
    at: state.last_progress_at ?? state.updated_at ?? null,
    status: state.status,
    reason: compactText(transition?.reason ?? state.stop_reason?.code ?? 'state_persisted', 160),
    sequence: Number.isInteger(transition?.sequence) ? transition.sequence : null,
    source_ref: `.vibepro/executions/${state.story_id}/runs/${state.run_id}/state.json`
  };
}

function fitCapsule(input) {
  const capsule = structuredClone(input);
  let raw = serializeCapsule(capsule);
  if (Buffer.byteLength(raw) <= RUN_CONTEXT_CAPSULE_MAX_BYTES) return capsule;

  if (capsule.open_decisions.length > 8) {
    capsule.open_decisions = capsule.open_decisions.slice(0, 8);
    markTruncated(capsule, 'open_decisions');
  }
  const compactedDecisions = capsule.open_decisions.map((item) => ({ ...item, prompt: compactText(item.prompt, 160) }));
  if (JSON.stringify(compactedDecisions) !== JSON.stringify(capsule.open_decisions)) {
    markTruncated(capsule, 'open_decisions');
  }
  capsule.open_decisions = compactedDecisions;
  if (capsule.invariants.length > 12) {
    capsule.invariants = capsule.invariants.slice(0, 12);
    markTruncated(capsule, 'invariants');
  }
  const compactedObjective = compactText(capsule.objective, 512);
  if (compactedObjective !== capsule.objective) markTruncated(capsule, 'objective');
  capsule.objective = compactedObjective;
  const compactedEvidence = capsule.evidence_refs.map((item) => ({ ...item, summary: compactText(item.summary, 128) }));
  if (JSON.stringify(compactedEvidence) !== JSON.stringify(capsule.evidence_refs)) {
    markTruncated(capsule, 'evidence_refs');
  }
  capsule.evidence_refs = compactedEvidence;
  raw = serializeCapsule(capsule);
  if (Buffer.byteLength(raw) <= RUN_CONTEXT_CAPSULE_MAX_BYTES) return capsule;

  capsule.open_decisions = capsule.open_decisions.slice(0, 1).map(({ id, source_ref }) => ({ id, prompt: 'See source artifact.', source_ref }));
  capsule.invariants = capsule.invariants.slice(0, 4).map((item) => compactText(item, 160));
  capsule.evidence_refs = capsule.evidence_refs.map(({ kind, source_ref, digest: value }) => ({ kind, source_ref, digest: value, summary: 'See source artifact.' }));
  for (const section of ['open_decisions', 'invariants', 'evidence_refs']) markTruncated(capsule, section);
  raw = serializeCapsule(capsule);
  if (Buffer.byteLength(raw) > RUN_CONTEXT_CAPSULE_MAX_BYTES) {
    throw capsuleError('capsule_size_exceeded', 'Run Context Capsule cannot fit within the 32 KiB budget after deterministic reduction.', {
      size_bytes: Buffer.byteLength(raw)
    });
  }
  return capsule;
}

function serializeCapsule(capsule) {
  for (let index = 0; index < 4; index += 1) {
    const raw = `${JSON.stringify(capsule, null, 2)}\n`;
    const size = Buffer.byteLength(raw);
    if (capsule.size_bytes === size) return raw;
    capsule.size_bytes = size;
  }
  return `${JSON.stringify(capsule, null, 2)}\n`;
}

function parseCapsule(raw, artifact) {
  const capsule = parseJson(raw, artifact);
  if (capsule.schema_version !== RUN_CONTEXT_CAPSULE_SCHEMA_VERSION) {
    throw capsuleError('unsupported_capsule_schema', `Unsupported Run Context Capsule schema: ${capsule.schema_version ?? 'missing'}.`, {
      artifact,
      schema_version: capsule.schema_version ?? null
    });
  }
  const required = [
    'story_id', 'run_id', 'head_sha', 'run_status', 'objective', 'invariants', 'bottleneck',
    'evidence_refs', 'open_decisions', 'budget_state', 'last_progress', 'generation_reason',
    'generated_at', 'event_fingerprint', 'source_fingerprints', 'truncated_sections', 'size_bytes'
  ];
  if (!capsule || typeof capsule !== 'object' || required.some((key) => !Object.hasOwn(capsule, key))
      || !Array.isArray(capsule.invariants) || !Array.isArray(capsule.evidence_refs)
      || !Array.isArray(capsule.open_decisions) || !Array.isArray(capsule.source_fingerprints)
      || !Array.isArray(capsule.truncated_sections)) {
    throw capsuleError('invalid_capsule', 'Run Context Capsule has an invalid shape.', { artifact });
  }
  if (capsule.size_bytes !== Buffer.byteLength(raw)) {
    throw capsuleError('invalid_capsule', 'Run Context Capsule size binding is invalid.', { artifact });
  }
  return capsule;
}

function validateCapsuleBinding(capsule, state) {
  if (capsule.story_id !== state.story_id || capsule.run_id !== state.run_id
      || capsule.head_sha !== state.current_head_sha || capsule.run_status !== state.status) {
    throw capsuleError('stale_binding', 'Run Context Capsule identity or state binding is stale.', {
      expected_story_id: state.story_id,
      expected_run_id: state.run_id,
      expected_head_sha: state.current_head_sha,
      actual_story_id: capsule.story_id,
      actual_run_id: capsule.run_id,
      actual_head_sha: capsule.head_sha
    });
  }
}

function parseOptionalSource(source) {
  return source ? parseJson(source.raw, source.path) : null;
}

function parseJson(raw, artifact) {
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new SyntaxError('root must be an object');
    return parsed;
  } catch (error) {
    throw capsuleError('invalid_capsule', `Context source JSON is invalid: ${artifact}.`, { artifact, cause: error.message });
  }
}

async function writeRawAtomic(io, filePath, raw) {
  await io.mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = path.join(path.dirname(filePath), `.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`);
  try {
    await io.writeFile(tempPath, raw);
    await io.rename(tempPath, filePath);
  } catch (error) {
    await io.rm(tempPath, { force: true }).catch(() => null);
    throw error;
  }
}

async function readRequired(io, filePath, code, message, details = {}) {
  try {
    return await io.readFile(filePath, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') throw capsuleError(code, message, { ...details, artifact: filePath });
    throw error;
  }
}

async function readOptional(io, filePath) {
  try {
    return await io.readFile(filePath, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

async function readDirectoryOrEmpty(io, dirPath) {
  try {
    return await io.readdir(dirPath, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

function resolveSourcePath(root, sourceRef) {
  if (typeof sourceRef !== 'string' || path.isAbsolute(sourceRef)) {
    throw capsuleError('invalid_capsule', 'Context Capsule source reference must be repository-relative.', { source_ref: sourceRef });
  }
  const resolved = path.resolve(root, sourceRef);
  const relative = path.relative(root, resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw capsuleError('invalid_capsule', 'Context Capsule source reference escapes the authoritative root.', { source_ref: sourceRef });
  }
  return resolved;
}

function toRootRelative(root, filePath) {
  const relative = path.relative(root, filePath);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw capsuleError('invalid_capsule', 'Context source escapes the authoritative root.', { artifact: filePath });
  }
  return relative.split(path.sep).join('/');
}

function getRunsRoot(root, storyId) {
  return path.join(getWorkspaceDir(root), 'executions', storyId, 'runs');
}

function getRunStatePath(root, storyId, runId) {
  return path.join(getRunsRoot(root, storyId), runId, 'state.json');
}

function getCapsulePathFromStatePath(statePath) {
  return path.join(path.dirname(statePath), 'context-capsule.json');
}

function requireStoryId(value) {
  if (typeof value !== 'string' || !STORY_ID_PATTERN.test(value) || value.includes('..')) {
    throw capsuleError('invalid_capsule', 'A valid Story id is required.', { story_id: value ?? null });
  }
  return value;
}

function requireRunId(value) {
  if (typeof value !== 'string' || !RUN_ID_PATTERN.test(value)) {
    throw capsuleError('invalid_capsule', 'A valid Run id is required.', { run_id: value ?? null });
  }
  return value;
}

function normalizeReason(value) {
  return compactText(typeof value === 'string' && value.trim() ? value : 'authoritative_state_changed', 160);
}

function compactText(value, maxLength) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 1))}…`;
}

function markTruncated(capsule, section) {
  if (!capsule.truncated_sections.includes(section)) capsule.truncated_sections.push(section);
}

function digest(value) {
  return createHash('sha256').update(value).digest('hex');
}

function toIso(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new TypeError('now dependency returned an invalid date');
  return date.toISOString();
}

function capsuleError(code, message, details = {}) {
  return new RunContextCapsuleError(code, message, details);
}

function assertClosedKeys(value, allowed, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${label} set must be an object`);
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  if (unknown.length > 0) throw new TypeError(`Unknown ${label} key(s): ${unknown.join(', ')}`);
}
