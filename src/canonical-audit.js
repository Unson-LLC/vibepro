import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';

import {
  buildCanonicalEvidenceCostSummary,
  shouldUseCompactCanonicalEvidence
} from './evidence-cost-budget.js';
import { getWorkspaceDir, toWorkspaceRelative } from './workspace.js';

export const CANONICAL_AUDIT_ROOT = path.join('docs', 'management', 'audit-artifacts');

const PR_AUDIT_FILES = [
  ['evidence-reuse.json', 'evidence_reuse'],
  ['pr-prepare.json', 'pr_prepare'],
  ['pr-create.json', 'pr_create'],
  ['gate-dag.json', 'gate_dag'],
  ['senior-gap-judgment.json', 'senior_gap_judgment'],
  ['pr-merge.json', 'pr_merge'],
  ['traceability.json', 'traceability'],
  ['verification-evidence.json', 'verification_evidence']
];
const REVIEW_AUDIT_FILES = [/^review-summary\.json$/, /^review-result-.+\.json$/, /^lifecycle\.json$/];
const REVIEW_HANDOFF_FILES = [/^review-request-.+\.md$/];
const VIBEPRO_REFERENCE_RE = /\.vibepro\/[A-Za-z0-9_./:@-]+/g;
const MAX_REFERENCED_ARTIFACT_BYTES = 512 * 1024;
const COMPRESSED_REPLAY_BUNDLE_FILE = 'audit-replay-bundle.json.gz';

export function getCanonicalAuditDir(repoRoot, storyId) {
  return path.join(path.resolve(repoRoot), CANONICAL_AUDIT_ROOT, storyId);
}

export async function promoteCanonicalAuditArtifacts(repoRoot, { storyId, source = 'execute_merge', merge = null, now = null } = {}) {
  if (!storyId) throw new Error('canonical audit promotion requires storyId');
  const root = path.resolve(repoRoot);
  const promotedAt = now ?? new Date().toISOString();
  const canonicalDir = getCanonicalAuditDir(root, storyId);
  const inventory = await collectAuditSourceInventory(root, storyId, canonicalDir);
  const costSummary = buildCanonicalEvidenceCostSummary({
    artifactLineCount: inventory.artifact_line_count,
    diffStats: merge?.git?.diff_line_stats ?? merge?.diff_line_stats ?? merge?.pr_context?.git?.diff_line_stats ?? null,
    diffStatsProvenance: merge?.git?.diff_stats ?? merge?.diff_stats ?? merge?.pr_context?.git?.diff_stats ?? null,
    tokenAccounting: extractCanonicalTokenAccounting(merge),
    elapsedTimeAccounting: extractCanonicalElapsedTimeAccounting(merge),
    riskProfile: merge?.gate_dag?.risk_profile ?? merge?.gate_dag?.change_classification?.profile ?? null,
    triggerSignals: collectCanonicalAuditTriggerSignals({ merge, missingArtifacts: inventory.missing_artifacts })
  });

  if (shouldUseCompactCanonicalEvidence(costSummary)) {
    return writeCompactCanonicalAuditArtifacts(root, {
      storyId,
      source,
      merge,
      promotedAt,
      canonicalDir,
      inventory,
      costSummary
    });
  }

  const artifacts = [];
  const missing_artifacts = [...inventory.missing_artifacts];

  for (const [fileName, kind] of PR_AUDIT_FILES) {
    await copyJsonArtifact({
      root,
      sourcePath: path.join(getWorkspaceDir(root), 'pr', storyId, fileName),
      targetPath: path.join(canonicalDir, 'pr', fileName),
      kind,
      artifacts,
      missing_artifacts
    });
  }

  const reviewRoot = path.join(getWorkspaceDir(root), 'reviews', storyId);
  for (const stage of await safeReaddir(reviewRoot)) {
    const stageDir = path.join(reviewRoot, stage);
    for (const entry of await safeReaddir(stageDir)) {
      if (REVIEW_AUDIT_FILES.some((pattern) => pattern.test(entry))) {
        const kind = entry === 'review-summary.json'
          ? 'review_summary'
          : entry === 'lifecycle.json'
            ? 'review_lifecycle'
            : 'review_result';
        await copyJsonArtifact({
          root,
          sourcePath: path.join(stageDir, entry),
          targetPath: path.join(canonicalDir, 'reviews', stage, entry),
          kind,
          artifacts,
          missing_artifacts
        });
        continue;
      }
      if (REVIEW_HANDOFF_FILES.some((pattern) => pattern.test(entry))) {
        await copyFileArtifact({
          root,
          sourcePath: path.join(stageDir, entry),
          targetPath: path.join(canonicalDir, 'reviews', stage, entry),
          kind: 'review_request',
          artifacts,
          missing_artifacts
        });
      }
    }
  }

  const referenceResolution = await promoteReferencedAuditArtifacts({
    root,
    canonicalDir,
    artifacts
  });
  const decisionIndex = buildDecisionIndex({
    storyId,
    source,
    merge,
    promotedAt,
    inventory,
    costSummary
  });

  const bundle = {
    schema_version: '0.1.0',
    story_id: storyId,
    source,
    promoted_at: promotedAt,
    canonical_dir: toWorkspaceRelative(root, canonicalDir),
    source_workspace_dir: toWorkspaceRelative(root, getWorkspaceDir(root)),
    artifact_policy: {
      scope: 'audit_core_only',
      evidence_depth: costSummary.evidence_depth,
      compacted: false,
      persisted_for_main_audit: true,
      excludes: [
        'HTML reports',
        'raw logs',
        'dispatch scratch artifacts',
        'temporary execution state'
      ]
    },
    evidence_depth: costSummary.evidence_depth,
    cost_summary: costSummary,
    automation_value_audit: decisionIndex.automation_value_audit,
    merge: merge ? {
      status: merge.status ?? null,
      pr_url: merge.pr?.url ?? merge.pr?.selector ?? null,
      merge_commit_sha: merge.merge_commit_sha ?? null,
      merged_at: merge.merged_at ?? null,
      current_head_sha: merge.current_head_sha ?? null,
      diff_stats_status: costSummary.diff_stats_status,
      diff_stats_source: costSummary.diff_stats_source
    } : null,
    handoff_replay_status: referenceResolution.unresolved_references.length === 0 ? 'ready' : 'blocked',
    handoff_replay: {
      status: referenceResolution.unresolved_references.length === 0 ? 'ready' : 'blocked',
      resolved_reference_count: referenceResolution.resolved_references.length,
      copied_reference_count: referenceResolution.copied_references.length,
      unresolved_reference_count: referenceResolution.unresolved_references.length
    },
    artifacts,
    missing_artifacts: dedupeMissingArtifacts(missing_artifacts),
    resolved_references: referenceResolution.resolved_references,
    copied_references: referenceResolution.copied_references,
    unresolved_references: referenceResolution.unresolved_references
  };
  const bundlePath = path.join(canonicalDir, 'audit-bundle.json');
  await mkdir(path.dirname(bundlePath), { recursive: true });
  await writeFile(bundlePath, `${JSON.stringify(bundle, null, 2)}\n`);
  return {
    canonical_dir: canonicalDir,
    bundle_path: bundlePath,
    bundle
  };
}

async function writeCompactCanonicalAuditArtifacts(root, {
  storyId,
  source,
  merge,
  promotedAt,
  canonicalDir,
  inventory,
  costSummary
}) {
  const decisionIndex = buildDecisionIndex({
    storyId,
    source,
    merge,
    promotedAt,
    inventory,
    costSummary
  });
  const indexPath = path.join(canonicalDir, 'audit-index.json');
  const summaryPath = path.join(canonicalDir, 'decision-summary.md');
  await mkdir(canonicalDir, { recursive: true });
  const replayBundle = await writeCompressedReplayBundle(root, {
    storyId,
    source,
    promotedAt,
    canonicalDir,
    decisionIndex,
    inventory,
    costSummary,
    merge
  });
  decisionIndex.replay_bundle = replayBundle;
  costSummary.replay_bundle = replayBundle.cost;
  await writeFile(indexPath, `${JSON.stringify(decisionIndex, null, 2)}\n`);
  await writeFile(summaryPath, renderDecisionSummary(decisionIndex));
  const artifacts = [
    {
      kind: 'audit_index',
      canonical_path: toWorkspaceRelative(root, indexPath)
    },
    {
      kind: 'decision_summary',
      canonical_path: toWorkspaceRelative(root, summaryPath)
    },
    {
      kind: 'compressed_replay_bundle',
      canonical_path: replayBundle.path,
      compression: replayBundle.compression,
      content_hash: replayBundle.content_hash
    }
  ];
  const bundle = {
    schema_version: '0.1.0',
    story_id: storyId,
    source,
    promoted_at: promotedAt,
    canonical_dir: toWorkspaceRelative(root, canonicalDir),
    source_workspace_dir: toWorkspaceRelative(root, getWorkspaceDir(root)),
    artifact_policy: {
      scope: 'decision_index_only',
      evidence_depth: costSummary.evidence_depth,
      compacted: true,
      persisted_for_main_audit: true,
      why_compacted: costSummary.budget_exceeded_reasons,
      excludes: [
        'full PR lifecycle JSON',
        'full review lifecycle JSON',
        'HTML reports',
        'raw logs',
        'dispatch scratch artifacts',
        'temporary execution state'
      ]
    },
    evidence_depth: costSummary.evidence_depth,
    cost_summary: costSummary,
    automation_value_audit: decisionIndex.automation_value_audit,
    decision_index: decisionIndex,
    replay_bundle: replayBundle,
    merge: decisionIndex.pr_merge.present ? decisionIndex.pr_merge.summary : null,
    handoff_replay_status: 'ready',
    handoff_replay: {
      status: 'ready',
      resolved_reference_count: 0,
      copied_reference_count: 0,
      unresolved_reference_count: 0,
      replay_bundle: replayBundle.path,
      replay_command: replayBundle.replay_command
    },
    artifacts,
    raw_artifacts: inventory.artifacts.map((artifact) => ({
      kind: artifact.kind,
      source: toWorkspaceRelative(root, artifact.sourcePath),
      persisted: 'compressed',
      compressed_path: replayBundle.path,
      digest: artifact.digest,
      line_count: artifact.line_count
    })),
    missing_artifacts: dedupeMissingArtifacts(inventory.missing_artifacts),
    resolved_references: [],
    copied_references: [],
    unresolved_references: []
  };
  const bundlePath = path.join(canonicalDir, 'audit-bundle.json');
  await writeFile(bundlePath, `${JSON.stringify(bundle, null, 2)}\n`);
  return {
    canonical_dir: canonicalDir,
    bundle_path: bundlePath,
    bundle
  };
}

async function writeCompressedReplayBundle(root, {
  storyId,
  source,
  promotedAt,
  canonicalDir,
  decisionIndex,
  inventory,
  costSummary,
  merge
}) {
  const replayPayload = {
    schema_version: '0.1.0',
    artifact_kind: 'canonical_audit_replay_bundle',
    story_id: storyId,
    source,
    promoted_at: promotedAt,
    decision_index: decisionIndex,
    cost_summary: costSummary,
    merge: merge ? {
      status: merge.status ?? null,
      pr_url: merge.pr?.url ?? merge.pr?.selector ?? merge.pr_url ?? null,
      merge_commit_sha: merge.merge_commit_sha ?? null,
      merged_at: merge.merged_at ?? null,
      current_head_sha: merge.current_head_sha ?? null
    } : null,
    artifacts: inventory.artifacts.map((artifact) => ({
      kind: artifact.kind,
      type: artifact.type,
      stage: artifact.stage,
      source: toWorkspaceRelative(root, artifact.sourcePath),
      digest: artifact.digest,
      line_count: artifact.line_count,
      data: artifact.type === 'json' ? artifact.data : null,
      content: artifact.type === 'text' ? artifact.content : null
    })),
    missing_artifacts: dedupeMissingArtifacts(inventory.missing_artifacts)
  };
  const expandedText = `${JSON.stringify(replayPayload, null, 2)}\n`;
  const compressed = gzipSync(Buffer.from(expandedText, 'utf8'));
  const bundlePath = path.join(canonicalDir, COMPRESSED_REPLAY_BUNDLE_FILE);
  await writeFile(bundlePath, compressed);
  const includedKinds = [...new Set(replayPayload.artifacts.map((artifact) => artifact.kind))].sort();
  return {
    schema_version: '0.1.0',
    path: toWorkspaceRelative(root, bundlePath),
    compression: 'gzip',
    media_type: 'application/json',
    content_hash: `sha256:${sha256Hex(Buffer.from(expandedText, 'utf8'))}`,
    compressed_hash: `sha256:${sha256Hex(compressed)}`,
    expanded_bytes: Buffer.byteLength(expandedText, 'utf8'),
    compressed_bytes: compressed.length,
    expanded_line_count: countTextLines(expandedText),
    included_artifact_kinds: includedKinds,
    replay_command: `vibepro audit replay . --story-id ${storyId}`,
    cost: {
      compressed_bytes: compressed.length,
      expanded_bytes: Buffer.byteLength(expandedText, 'utf8'),
      expanded_line_count: countTextLines(expandedText)
    }
  };
}

async function collectAuditSourceInventory(root, storyId, canonicalDir) {
  const artifacts = [];
  const missing_artifacts = [];

  for (const [fileName, kind] of PR_AUDIT_FILES) {
    const sourcePath = path.join(getWorkspaceDir(root), 'pr', storyId, fileName);
    const targetPath = path.join(canonicalDir, 'pr', fileName);
    const artifact = await readAuditSourceArtifact(root, { sourcePath, targetPath, kind, type: 'json' });
    if (artifact) {
      artifacts.push(artifact);
    } else {
      missing_artifacts.push({ kind, source: toWorkspaceRelative(root, sourcePath) });
    }
  }

  const reviewRoot = path.join(getWorkspaceDir(root), 'reviews', storyId);
  for (const stage of await safeReaddir(reviewRoot)) {
    const stageDir = path.join(reviewRoot, stage);
    for (const entry of await safeReaddir(stageDir)) {
      if (REVIEW_AUDIT_FILES.some((pattern) => pattern.test(entry))) {
        const kind = entry === 'review-summary.json'
          ? 'review_summary'
          : entry === 'lifecycle.json'
            ? 'review_lifecycle'
            : 'review_result';
        const artifact = await readAuditSourceArtifact(root, {
          sourcePath: path.join(stageDir, entry),
          targetPath: path.join(canonicalDir, 'reviews', stage, entry),
          kind,
          type: 'json',
          stage
        });
        if (artifact) artifacts.push(artifact);
        continue;
      }
      if (REVIEW_HANDOFF_FILES.some((pattern) => pattern.test(entry))) {
        const artifact = await readAuditSourceArtifact(root, {
          sourcePath: path.join(stageDir, entry),
          targetPath: path.join(canonicalDir, 'reviews', stage, entry),
          kind: 'review_request',
          type: 'text',
          stage
        });
        if (artifact) artifacts.push(artifact);
      }
    }
  }

  return {
    artifacts,
    missing_artifacts,
    artifact_line_count: artifacts.reduce((sum, artifact) => sum + artifact.line_count, 0)
  };
}

async function readAuditSourceArtifact(root, { sourcePath, targetPath, kind, type, stage = null }) {
  const text = await readTextIfExists(sourcePath);
  if (text === null) return null;
  return {
    kind,
    type,
    stage,
    sourcePath,
    targetPath,
    source: toWorkspaceRelative(root, sourcePath),
    canonical_path: toWorkspaceRelative(root, targetPath),
    line_count: countTextLines(text),
    digest: `sha256:${sha256Hex(text)}`,
    data: type === 'json' ? JSON.parse(text) : null,
    content: type === 'text' ? text : null
  };
}

export async function replayCanonicalAuditBundle(repoRoot, { storyId } = {}) {
  if (!storyId) throw new Error('canonical audit replay requires storyId');
  const root = path.resolve(repoRoot);
  const canonicalDir = getCanonicalAuditDir(root, storyId);
  const indexPath = path.join(canonicalDir, 'audit-index.json');
  const bundlePath = path.join(canonicalDir, 'audit-bundle.json');
  const index = await readJsonIfExists(indexPath);
  const bundle = await readJsonIfExists(bundlePath);
  const replayBundle = index?.replay_bundle ?? bundle?.replay_bundle ?? bundle?.decision_index?.replay_bundle ?? null;
  if (!replayBundle?.path) {
    return {
      schema_version: '0.1.0',
      story_id: storyId,
      status: 'blocked',
      handoff_replay_status: 'blocked',
      reason: 'compressed_replay_bundle_missing',
      decision_index_present: Boolean(index ?? bundle?.decision_index)
    };
  }

  const replayPath = path.isAbsolute(replayBundle.path)
    ? replayBundle.path
    : path.join(root, replayBundle.path);
  let compressed;
  let expandedText;
  let payload;
  try {
    compressed = await readFile(replayPath);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return replayBlocked(storyId, replayBundle, 'compressed_replay_bundle_file_missing');
  }

  const compressedHash = `sha256:${sha256Hex(compressed)}`;
  if (!replayBundle.compressed_hash) {
    return replayBlocked(storyId, replayBundle, 'compressed_hash_missing');
  }
  if (replayBundle.compressed_hash !== compressedHash) {
    return replayBlocked(storyId, replayBundle, 'compressed_hash_mismatch', {
      expected: replayBundle.compressed_hash,
      actual: compressedHash
    });
  }

  try {
    expandedText = gunzipSync(compressed).toString('utf8');
  } catch {
    return replayBlocked(storyId, replayBundle, 'compressed_replay_bundle_expand_failed');
  }

  const contentHash = `sha256:${sha256Hex(expandedText)}`;
  if (!replayBundle.content_hash) {
    return replayBlocked(storyId, replayBundle, 'content_hash_missing');
  }
  if (replayBundle.content_hash !== contentHash) {
    return replayBlocked(storyId, replayBundle, 'content_hash_mismatch', {
      expected: replayBundle.content_hash,
      actual: contentHash
    });
  }

  try {
    payload = JSON.parse(expandedText);
  } catch {
    return replayBlocked(storyId, replayBundle, 'compressed_replay_bundle_parse_failed');
  }

  if (payload.schema_version !== '0.1.0' || payload.story_id !== storyId) {
    return replayBlocked(storyId, replayBundle, 'compressed_replay_bundle_schema_mismatch', {
      payload_schema_version: payload.schema_version ?? null,
      payload_story_id: payload.story_id ?? null
    });
  }

  const payloadIndex = payload.decision_index ?? index ?? bundle?.decision_index ?? null;
  return {
    schema_version: '0.1.0',
    story_id: storyId,
    status: 'ready',
    handoff_replay_status: 'ready',
    replay_bundle: replayBundle,
    replayed_at: new Date().toISOString(),
    verdict: {
      pr_prepare: payloadIndex?.pr_prepare?.gate_status?.overall_status ?? null,
      pr_merge: payloadIndex?.pr_merge?.summary?.status ?? null,
      verification: payloadIndex?.verification ?? null,
      review: payloadIndex?.review ?? null,
      traceability: payloadIndex?.traceability ?? null
    },
    merge: payload.merge ?? payloadIndex?.pr_merge?.summary ?? null,
    artifact_count: payload.artifacts?.length ?? 0,
    included_artifact_kinds: [...new Set((payload.artifacts ?? []).map((artifact) => artifact.kind))].sort(),
    missing_artifacts: payload.missing_artifacts ?? []
  };
}

export function renderCanonicalAuditReplay(result) {
  if (result.status !== 'ready') {
    return `Audit replay blocked: ${result.story_id} reason=${result.reason ?? 'unknown'}\n`;
  }
  return [
    `Audit replay ready: ${result.story_id}`,
    `- pr_prepare: ${result.verdict?.pr_prepare ?? 'unknown'}`,
    `- pr_merge: ${result.verdict?.pr_merge ?? 'unknown'}`,
    `- verification: commands=${result.verdict?.verification?.command_count ?? 0} pass=${result.verdict?.verification?.pass_count ?? 0} fail=${result.verdict?.verification?.fail_count ?? 0}`,
    `- review: summaries=${result.verdict?.review?.summary_count ?? 0} results=${result.verdict?.review?.result_count ?? 0} pass=${result.verdict?.review?.pass_count ?? 0} block=${result.verdict?.review?.block_count ?? 0}`,
    `- artifacts: ${result.artifact_count}`,
    `- bundle: ${result.replay_bundle?.path ?? 'unknown'}`
  ].join('\n') + '\n';
}

function replayBlocked(storyId, replayBundle, reason, extra = {}) {
  return {
    schema_version: '0.1.0',
    story_id: storyId,
    status: 'blocked',
    handoff_replay_status: 'blocked',
    reason,
    replay_bundle: replayBundle,
    ...extra
  };
}

function buildDecisionIndex({ storyId, source, merge, promotedAt, inventory, costSummary }) {
  const byKind = new Map();
  for (const artifact of inventory.artifacts) {
    const items = byKind.get(artifact.kind) ?? [];
    items.push(artifact);
    byKind.set(artifact.kind, items);
  }
  const prPrepare = latestData(byKind.get('pr_prepare'));
  const evidenceReuse = latestData(byKind.get('evidence_reuse')) ?? prPrepare?.evidence_reuse ?? null;
  const prCreate = latestData(byKind.get('pr_create'));
  const prMerge = latestData(byKind.get('pr_merge')) ?? merge;
  const gateDag = latestData(byKind.get('gate_dag'));
  const seniorGapJudgment = latestData(byKind.get('senior_gap_judgment'))
    ?? prPrepare?.pr_context?.senior_gap_judgment
    ?? null;
  const traceability = latestData(byKind.get('traceability'));
  const verification = latestData(byKind.get('verification_evidence'));
  const reviewSummaries = (byKind.get('review_summary') ?? []).map((artifact) => artifact.data);
  const reviewResults = (byKind.get('review_result') ?? []).map((artifact) => artifact.data);

  const index = {
    schema_version: '0.1.0',
    story_id: storyId,
    source,
    generated_at: promotedAt,
    evidence_depth: costSummary.evidence_depth,
    budget_status: costSummary.budget_status,
    cost_summary: costSummary,
    pr_prepare: {
      present: Boolean(prPrepare),
      created_at: prPrepare?.created_at ?? prPrepare?.generated_at ?? null,
      gate_status: prPrepare?.gate_status ? {
        ready_for_pr_create: prPrepare.gate_status.ready_for_pr_create ?? null,
        overall_status: prPrepare.gate_status.overall_status ?? null,
        fast_lane: prPrepare.gate_status.fast_lane ?? null,
        critical_unresolved_gate_count: prPrepare.gate_status.critical_unresolved_gates?.length ?? 0
      } : null
    },
    evidence_reuse: {
      present: Boolean(evidenceReuse),
      created_at: evidenceReuse?.created_at ?? prPrepare?.created_at ?? null,
      status: evidenceReuse?.status ?? null,
      evidence_key: evidenceReuse?.evidence_key ?? null,
      verification_summary_fingerprint: evidenceReuse?.verification_summary_fingerprint
        ?? evidenceReuse?.key_inputs?.verification_summary_fingerprint
        ?? null,
      verification_evidence_updated_at: evidenceReuse?.verification_evidence_updated_at
        ?? evidenceReuse?.key_inputs?.verification_evidence_updated_at
        ?? null,
      verification_command_timestamps: evidenceReuse?.verification_command_timestamps
        ?? evidenceReuse?.key_inputs?.verification_command_timestamps
        ?? [],
      stale_reason_count: evidenceReuse?.stale_reasons?.length ?? 0,
      full_evidence_status: evidenceReuse?.full_evidence?.status ?? null,
      full_evidence_generation_count: evidenceReuse?.full_evidence?.generation_count ?? null,
      full_evidence_generation_count_scope: evidenceReuse?.full_evidence?.generation_count_scope ?? null,
      full_evidence_same_key_generation_count: evidenceReuse?.full_evidence?.same_key_generation_count
        ?? evidenceReuse?.full_evidence?.generation_count
        ?? null,
      full_evidence_cumulative_generation_count: evidenceReuse?.full_evidence?.cumulative_generation_count
        ?? evidenceReuse?.full_evidence?.generation_count
        ?? null
    },
    pr_create: {
      present: Boolean(prCreate),
      created_at: prCreate?.created_at ?? prCreate?.generated_at ?? null,
      status: prCreate?.status ?? null,
      pr_url: prCreate?.pr_url ?? prCreate?.url ?? null,
      gate_override_allowed: prCreate?.gate_override?.allowed ?? false
    },
    pr_merge: {
      present: Boolean(prMerge),
      summary: prMerge ? {
        status: prMerge.status ?? null,
        pr_url: prMerge.pr?.url ?? prMerge.pr?.selector ?? prMerge.pr_url ?? null,
        merge_commit_sha: prMerge.merge_commit_sha ?? null,
        merged_at: prMerge.merged_at ?? null,
        current_head_sha: prMerge.current_head_sha ?? null,
        diff_stats_status: costSummary.diff_stats_status,
        diff_stats_source: costSummary.diff_stats_source
      } : null
    },
    gate_dag: {
      present: Boolean(gateDag),
      overall_status: gateDag?.overall_status ?? null,
      node_count: Array.isArray(gateDag?.nodes) ? gateDag.nodes.length : 0,
      blocking_count: Array.isArray(gateDag?.nodes)
        ? gateDag.nodes.filter((node) => ['block', 'needs_evidence', 'needs_review', 'failed'].includes(node.status)).length
        : 0
    },
    senior_gap_judgment: {
      present: Boolean(seniorGapJudgment),
      status: seniorGapJudgment?.decision?.status ?? null,
      gap_count: seniorGapJudgment?.gaps?.length ?? 0,
      blocking_gap_count: seniorGapJudgment?.decision?.blocking_gap_count ?? 0,
      residual_risk_count: seniorGapJudgment?.residual_risks?.length ?? 0,
      followup_count: seniorGapJudgment?.followups?.length ?? 0
    },
    traceability: {
      present: Boolean(traceability),
      lifecycle: traceability?.lifecycle ?? null,
      coverage_summary: traceability?.coverage_summary ?? null
    },
    verification: {
      present: Boolean(verification),
      command_count: verification?.commands?.length ?? 0,
      pass_count: (verification?.commands ?? []).filter((command) => ['pass', 'passed', 'success', 'ok'].includes(command?.status)).length,
      fail_count: (verification?.commands ?? []).filter((command) => ['fail', 'failed', 'error'].includes(command?.status)).length
    },
    review: {
      summary_count: reviewSummaries.length,
      result_count: reviewResults.length,
      pass_count: reviewSummaries.reduce((sum, item) => sum + (item?.pass_count ?? 0), 0),
      block_count: reviewSummaries.reduce((sum, item) => sum + (item?.block_count ?? 0), 0),
      stale_count: reviewSummaries.reduce((sum, item) => sum + (item?.stale_count ?? 0), 0)
    },
    missing_artifacts: dedupeMissingArtifacts(inventory.missing_artifacts),
    raw_artifact_count: inventory.artifacts.length
  };
  index.automation_value_audit = buildAutomationValueAuditContract(index);
  return index;
}

function buildAutomationValueAuditContract(index) {
  const cost = index.cost_summary ?? {};
  const changedLines = cost.changed_lines ?? {};
  const buckets = changedLines.buckets ?? {};
  const srcLines = bucketChangedLines(buckets.src);
  const testLines = bucketChangedLines(buckets.test);
  const storySpecArchitectureLines = bucketChangedLines(buckets.story_spec_architecture_docs);
  const auditArtifactLines = bucketChangedLines(buckets.audit_artifacts);
  const otherLines = bucketChangedLines(buckets.other);
  const verificationAndDocsLines = testLines + storySpecArchitectureLines;
  const auditEvidenceLines = verificationAndDocsLines + auditArtifactLines;
  const evidenceToSrcRatio = ratioOrNull(auditEvidenceLines, srcLines);
  const findings = buildAutomationValueAuditFindings({
    index,
    cost,
    srcLines,
    auditEvidenceLines,
    evidenceToSrcRatio
  });

  return {
    schema_version: '0.1.0',
    artifact_kind: 'vibepro_automation_value_audit',
    story_id: index.story_id,
    generated_at: index.generated_at ?? null,
    status: automationReadinessStatus({ index, cost }),
    purpose: 'daily_automation_input',
    sources: {
      canonical_audit: true,
      cost_summary: true,
      pr_lifecycle: index.pr_merge?.present === true,
      verification: index.verification?.present === true,
      review: (index.review?.result_count ?? 0) > 0,
      senior_gap_judgment: index.senior_gap_judgment?.present === true
    },
    merge_context: {
      pr_url: index.pr_merge?.summary?.pr_url ?? index.pr_create?.pr_url ?? null,
      merge_status: index.pr_merge?.summary?.status ?? null,
      merge_commit_sha: index.pr_merge?.summary?.merge_commit_sha ?? null,
      merged_at: index.pr_merge?.summary?.merged_at ?? null
    },
    allocation: {
      changed_lines_status: changedLines.status ?? cost.diff_stats_status ?? 'unknown',
      total_changed_lines: changedLines.total_changed_lines ?? null,
      implementation_changed_lines: srcLines,
      verification_and_docs_changed_lines: verificationAndDocsLines,
      audit_evidence_changed_lines: auditEvidenceLines,
      buckets: {
        src: srcLines,
        test: testLines,
        story_spec_architecture_docs: storySpecArchitectureLines,
        audit_artifacts: auditArtifactLines,
        other: otherLines
      }
    },
    ratios: {
      test_to_src: ratioOrNull(testLines, srcLines),
      story_spec_architecture_to_src: ratioOrNull(storySpecArchitectureLines, srcLines),
      audit_artifacts_to_src: ratioOrNull(auditArtifactLines, srcLines),
      automation_evidence_to_src: evidenceToSrcRatio,
      artifact_lines_to_product_changed_lines: cost.artifact_code_ratio ?? null
    },
    session_cost: {
      token_status: cost.token_accounting?.status ?? 'unknown',
      total_tokens: cost.token_accounting?.total_tokens ?? null,
      token_source: cost.token_accounting?.source ?? null,
      token_window: cost.token_accounting?.window ?? null,
      elapsed_status: cost.elapsed_time_accounting?.status ?? 'unknown',
      elapsed_ms: cost.elapsed_time_accounting?.elapsed_ms ?? null,
      elapsed_source: cost.elapsed_time_accounting?.source ?? null,
      elapsed_window: cost.elapsed_time_accounting?.window ?? null
    },
    value_signal_inputs: {
      budget_status: cost.budget_status ?? null,
      budget_exceeded_reasons: cost.budget_exceeded_reasons ?? [],
      evidence_depth: index.evidence_depth ?? null,
      verification_pass_count: index.verification?.pass_count ?? 0,
      verification_fail_count: index.verification?.fail_count ?? 0,
      review_result_count: index.review?.result_count ?? 0,
      review_pass_count: index.review?.pass_count ?? 0,
      review_block_count: index.review?.block_count ?? 0,
      senior_gap_status: index.senior_gap_judgment?.status ?? null,
      senior_gap_residual_risk_count: index.senior_gap_judgment?.residual_risk_count ?? 0,
      evidence_reuse_status: index.evidence_reuse?.status ?? null,
      evidence_reuse_stale_reason_count: index.evidence_reuse?.stale_reason_count ?? 0,
      traceability_lifecycle: index.traceability?.lifecycle ?? null,
      missing_artifact_count: index.missing_artifacts?.length ?? 0
    },
    findings
  };
}

function automationReadinessStatus({ index, cost }) {
  if (index.pr_merge?.present !== true) return 'not_merged';
  if ((index.missing_artifacts?.length ?? 0) > 0 || cost.diff_stats_status !== 'available') return 'needs_evidence';
  if (
    cost.token_accounting?.status !== 'available'
    || cost.elapsed_time_accounting?.status !== 'available'
    || cost.budget_status === 'exceeded'
    || (index.senior_gap_judgment?.residual_risk_count ?? 0) > 0
  ) {
    return 'partial';
  }
  return 'ready';
}

function buildAutomationValueAuditFindings({ index, cost, srcLines, auditEvidenceLines, evidenceToSrcRatio }) {
  const findings = [];
  if (cost.token_accounting?.status !== 'available' || cost.elapsed_time_accounting?.status !== 'available') {
    findings.push({
      id: 'session_cost_unavailable',
      severity: 'needs_context',
      reason: 'token or elapsed-time accounting is not available in canonical audit summary',
      token_status: cost.token_accounting?.status ?? 'unknown',
      elapsed_status: cost.elapsed_time_accounting?.status ?? 'unknown'
    });
  }
  if (cost.budget_status === 'exceeded') {
    findings.push({
      id: 'artifact_budget_exceeded',
      severity: 'cost_risk',
      reason: 'canonical audit evidence exceeded the configured artifact budget',
      budget_exceeded_reasons: cost.budget_exceeded_reasons ?? [],
      artifact_code_ratio: cost.artifact_code_ratio ?? null
    });
  }
  if (srcLines === 0 && auditEvidenceLines > 0) {
    findings.push({
      id: 'no_src_changed_lines',
      severity: 'review_needed',
      reason: 'automation evidence changed without src/ implementation changes'
    });
  } else if (evidenceToSrcRatio !== null && evidenceToSrcRatio > 3) {
    findings.push({
      id: 'evidence_heavy_relative_to_src',
      severity: 'cost_risk',
      reason: 'test/story/audit evidence changed lines are more than 3x src changed lines',
      automation_evidence_to_src: evidenceToSrcRatio
    });
  }
  if ((index.review?.result_count ?? 0) === 0) {
    findings.push({
      id: 'agent_review_not_recorded',
      severity: 'needs_context',
      reason: 'no recorded review result is available for automation value judgment'
    });
  }
  if ((index.senior_gap_judgment?.residual_risk_count ?? 0) > 0) {
    findings.push({
      id: 'senior_gap_residual_risk',
      severity: 'review_needed',
      reason: 'senior gap judgment still reports residual risk',
      residual_risk_count: index.senior_gap_judgment.residual_risk_count
    });
  }
  return findings;
}

function bucketChangedLines(bucket) {
  const value = bucket?.changed_lines;
  return Number.isFinite(value) ? value : 0;
}

function ratioOrNull(numerator, denominator) {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) return null;
  return Number((numerator / denominator).toFixed(3));
}

function renderDecisionSummary(index) {
  return `# VibePro Decision Summary

- story: ${index.story_id}
- evidence_depth: ${index.evidence_depth}
- budget_status: ${index.budget_status}
- artifact_lines: ${index.cost_summary.artifact_lines}
- product_changed_lines: ${index.cost_summary.product_changed_lines ?? 'unknown'}
- artifact_code_ratio: ${index.cost_summary.artifact_code_ratio ?? 'unknown'}
- diff_stats: ${index.cost_summary.diff_stats_status ?? 'unknown'}
- token_accounting: ${index.cost_summary.token_accounting?.status ?? 'unknown'} total=${index.cost_summary.token_accounting?.total_tokens ?? 'unknown'} source=${index.cost_summary.token_accounting?.source ?? 'unknown'}
- elapsed_time_accounting: ${index.cost_summary.elapsed_time_accounting?.status ?? 'unknown'} elapsed_ms=${index.cost_summary.elapsed_time_accounting?.elapsed_ms ?? 'unknown'} source=${index.cost_summary.elapsed_time_accounting?.source ?? 'unknown'}
- automation_value_audit: ${index.automation_value_audit?.status ?? 'unknown'} findings=${index.automation_value_audit?.findings?.length ?? 0} evidence_to_src=${index.automation_value_audit?.ratios?.automation_evidence_to_src ?? 'unknown'}
- pr_prepare: ${index.pr_prepare.present ? index.pr_prepare.gate_status?.overall_status ?? 'present' : 'missing'}
- evidence_reuse: ${index.evidence_reuse.present ? `${index.evidence_reuse.status ?? 'present'} key=${index.evidence_reuse.evidence_key ?? 'unknown'} verification_updated_at=${index.evidence_reuse.verification_evidence_updated_at ?? 'unknown'} verification_fingerprint=${index.evidence_reuse.verification_summary_fingerprint ?? 'unknown'}` : 'missing'}
- senior_gap_judgment: ${index.senior_gap_judgment.present ? `${index.senior_gap_judgment.status ?? 'present'} gaps=${index.senior_gap_judgment.gap_count} blocking=${index.senior_gap_judgment.blocking_gap_count} residual=${index.senior_gap_judgment.residual_risk_count}` : 'missing'}
- pr_create: ${index.pr_create.present ? index.pr_create.status ?? index.pr_create.pr_url ?? 'present' : 'missing'}
- pr_merge: ${index.pr_merge.present ? index.pr_merge.summary?.status ?? 'present' : 'missing'}
- verification: commands=${index.verification.command_count} pass=${index.verification.pass_count} fail=${index.verification.fail_count}
- review: summaries=${index.review.summary_count} results=${index.review.result_count} pass=${index.review.pass_count} block=${index.review.block_count}
- missing_artifacts: ${index.missing_artifacts.length}

Full audit artifacts were not copied into canonical history because the evidence cost budget was exceeded. Use the raw artifact digests and source workspace references in audit-index.json when deeper replay is required.
`;
}

async function promoteReferencedAuditArtifacts({ root, canonicalDir, artifacts }) {
  const sourceToCanonical = new Map();
  for (const artifact of artifacts) {
    if (artifact.source && artifact.canonical_path) {
      sourceToCanonical.set(artifact.source, artifact.canonical_path);
    }
  }
  const refs = new Set();
  for (const artifact of artifacts) {
    if (!artifact.canonical_path) continue;
    const text = await readTextIfExists(path.join(root, artifact.canonical_path));
    for (const ref of extractVibeProReferences(text)) refs.add(ref);
  }

  const resolved_references = [];
  const copied_references = [];
  const unresolved_references = [];
  for (const ref of [...refs].sort()) {
    const existingCanonical = sourceToCanonical.get(ref);
    if (existingCanonical) {
      resolved_references.push({
        source: ref,
        canonical_path: existingCanonical,
        resolution: 'canonical_artifact'
      });
      continue;
    }

    const sourcePath = path.join(root, ref);
    const sourceStat = await statIfExists(sourcePath);
    if (!sourceStat || !sourceStat.isFile()) {
      unresolved_references.push({
        source: ref,
        reason: 'source_missing'
      });
      continue;
    }
    if (sourceStat.size > MAX_REFERENCED_ARTIFACT_BYTES) {
      unresolved_references.push({
        source: ref,
        reason: 'source_too_large',
        size_bytes: sourceStat.size
      });
      continue;
    }

    const targetPath = path.join(canonicalDir, 'references', ref.replace(/^\.vibepro\//, 'vibepro/'));
    await mkdir(path.dirname(targetPath), { recursive: true });
    await writeFile(targetPath, await readFile(sourcePath));
    const canonicalPath = toWorkspaceRelative(root, targetPath);
    copied_references.push({
      source: ref,
      canonical_path: canonicalPath,
      resolution: 'copied_reference'
    });
    resolved_references.push({
      source: ref,
      canonical_path: canonicalPath,
      resolution: 'copied_reference'
    });
  }
  return { resolved_references, copied_references, unresolved_references };
}

export async function collectCanonicalAuditArtifacts(repoRoot, since = null) {
  const root = path.resolve(repoRoot);
  const baseDir = path.join(root, CANONICAL_AUDIT_ROOT);
  const prArtifacts = [];
  const reviewArtifacts = [];
  const bundleArtifacts = [];
  for (const storyId of await safeReaddir(baseDir)) {
    const storyDir = path.join(baseDir, storyId);
    const bundlePath = path.join(storyDir, 'audit-bundle.json');
    const bundle = await readJsonIfExists(bundlePath);
    if (bundle && isWithinSince(bundle.promoted_at ?? bundle.updated_at ?? bundle.created_at, since)) {
      bundleArtifacts.push({
        kind: 'canonical_audit_bundle',
        story_id: bundle.story_id ?? storyId,
        path: toWorkspaceRelative(root, bundlePath),
        data: bundle
      });
      const decisionIndex = await readJsonIfExists(path.join(storyDir, 'audit-index.json')) ?? bundle.decision_index ?? null;
      for (const artifact of buildDecisionIndexPrArtifacts({
        root,
        storyId: bundle.story_id ?? storyId,
        index: decisionIndex,
        indexPath: path.join(storyDir, 'audit-index.json'),
        bundlePath
      })) {
        prArtifacts.push(artifact);
      }
    }

    for (const [fileName, kind] of PR_AUDIT_FILES) {
      const filePath = path.join(storyDir, 'pr', fileName);
      const data = await readJsonIfExists(filePath);
      if (!data || !isWithinSince(data.created_at ?? data.generated_at ?? data.updated_at ?? data.merged_at, since)) continue;
      prArtifacts.push({
        kind,
        story_id: data.story?.story_id ?? data.story_id ?? storyId,
        path: toWorkspaceRelative(root, filePath),
        data,
        source: 'canonical_audit'
      });
    }

    const reviewsDir = path.join(storyDir, 'reviews');
    for (const stage of await safeReaddir(reviewsDir)) {
      const stageDir = path.join(reviewsDir, stage);
      const summaryPath = path.join(stageDir, 'review-summary.json');
      const summary = await readJsonIfExists(summaryPath);
      if (summary && isWithinSince(summary.updated_at ?? summary.recorded_at ?? summary.created_at, since)) {
        reviewArtifacts.push({
          kind: 'review_summary',
          story_id: summary.story_id ?? storyId,
          path: toWorkspaceRelative(root, summaryPath),
          data: summary,
          source: 'canonical_audit'
        });
      }
      for (const entry of await safeReaddir(stageDir)) {
        if (!/^review-result-.+\.json$/.test(entry)) continue;
        const resultPath = path.join(stageDir, entry);
        const result = await readJsonIfExists(resultPath);
        if (!result || !isWithinSince(result.recorded_at ?? result.updated_at ?? result.created_at, since)) continue;
        reviewArtifacts.push({
          kind: 'review_result',
          story_id: result.story_id ?? storyId,
          path: toWorkspaceRelative(root, resultPath),
          data: result,
          source: 'canonical_audit'
        });
      }
    }
  }
  return { prArtifacts, reviewArtifacts, bundleArtifacts };
}

export function mergeArtifactsPreferLocal(localArtifacts, canonicalArtifacts) {
  const byKey = new Map();
  for (const artifact of canonicalArtifacts) {
    byKey.set(auditArtifactKey(artifact), artifact);
  }
  for (const artifact of localArtifacts) {
    byKey.set(auditArtifactKey(artifact), artifact);
  }
  return [...byKey.values()].sort((a, b) => String(a.path).localeCompare(String(b.path)));
}

async function copyJsonArtifact({ root, sourcePath, targetPath, kind, artifacts, missing_artifacts }) {
  const data = await readJsonIfExists(sourcePath);
  if (!data) {
    missing_artifacts.push({
      kind,
      source: toWorkspaceRelative(root, sourcePath)
    });
    return;
  }
  await mkdir(path.dirname(targetPath), { recursive: true });
  await writeFile(targetPath, `${JSON.stringify(data, null, 2)}\n`);
  artifacts.push({
    kind,
    source: toWorkspaceRelative(root, sourcePath),
    canonical_path: toWorkspaceRelative(root, targetPath)
  });
}

async function copyFileArtifact({ root, sourcePath, targetPath, kind, artifacts, missing_artifacts }) {
  const sourceStat = await statIfExists(sourcePath);
  if (!sourceStat || !sourceStat.isFile()) {
    missing_artifacts.push({
      kind,
      source: toWorkspaceRelative(root, sourcePath)
    });
    return;
  }
  if (sourceStat.size > MAX_REFERENCED_ARTIFACT_BYTES) {
    missing_artifacts.push({
      kind,
      source: toWorkspaceRelative(root, sourcePath),
      reason: 'source_too_large',
      size_bytes: sourceStat.size
    });
    return;
  }
  await mkdir(path.dirname(targetPath), { recursive: true });
  await writeFile(targetPath, await readFile(sourcePath));
  artifacts.push({
    kind,
    source: toWorkspaceRelative(root, sourcePath),
    canonical_path: toWorkspaceRelative(root, targetPath)
  });
}

function extractVibeProReferences(text) {
  if (!text) return [];
  return [...String(text).matchAll(VIBEPRO_REFERENCE_RE)]
    .map((match) => match[0].replace(/[),.;:"'\\\]}]+$/g, ''))
    .filter((ref) => ref.startsWith('.vibepro/'));
}

async function statIfExists(filePath) {
  try {
    return await stat(filePath);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

async function readTextIfExists(filePath) {
  try {
    return await readFile(filePath, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

function auditArtifactKey(artifact) {
  const stage = artifact.data?.stage ?? inferReviewStageFromPath(artifact.path) ?? '-';
  const file = path.basename(artifact.path ?? '');
  return [artifact.story_id ?? 'unknown', artifact.kind ?? 'unknown', stage, file].join(':');
}

function inferReviewStageFromPath(filePath) {
  const parts = String(filePath ?? '').split('/');
  const reviewIndex = parts.indexOf('reviews');
  if (reviewIndex < 0) return null;
  return parts[reviewIndex + 2] ?? null;
}

function latestData(artifacts = []) {
  return artifacts
    .slice()
    .sort((a, b) => artifactTimestamp(b.data) - artifactTimestamp(a.data))[0]
    ?.data ?? null;
}

function artifactTimestamp(data) {
  const value = data?.updated_at ?? data?.recorded_at ?? data?.created_at ?? data?.generated_at ?? data?.merged_at;
  const parsed = new Date(value ?? 0);
  return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime();
}

function countTextLines(text) {
  if (!text) return 0;
  return String(text).split(/\r\n|\r|\n/).length;
}

function sha256Hex(value) {
  return createHash('sha256').update(value).digest('hex');
}

function dedupeMissingArtifacts(items = []) {
  const seen = new Set();
  const result = [];
  for (const item of items) {
    const key = [item.kind ?? 'unknown', item.source ?? 'unknown', item.reason ?? '-'].join(':');
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}

function collectCanonicalAuditTriggerSignals({ merge = null, missingArtifacts = [] } = {}) {
  const signals = [];
  if (missingArtifacts.length > 0) signals.push('missing_artifact');
  if (merge?.warnings?.length > 0) signals.push('merge_warning');
  for (const node of merge?.gate_dag?.nodes ?? []) {
    if (['block', 'needs_evidence', 'needs_review', 'failed'].includes(node?.status)) {
      signals.push(`gate:${node.id ?? 'unknown'}:${node.status}`);
    }
    if (node?.status === 'bypassed') signals.push(`gate:${node.id ?? 'unknown'}:waiver`);
  }
  return signals;
}

function extractCanonicalTokenAccounting(merge = null) {
  return merge?.cost_accounting?.token_accounting
    ?? merge?.token_accounting
    ?? merge?.usage?.token_accounting
    ?? merge?.usage?.tokens
    ?? merge?.session?.token_accounting
    ?? null;
}

function extractCanonicalElapsedTimeAccounting(merge = null) {
  return merge?.cost_accounting?.elapsed_time_accounting
    ?? merge?.elapsed_time_accounting
    ?? merge?.usage?.elapsed_time_accounting
    ?? merge?.usage?.elapsed_time
    ?? merge?.session?.elapsed_time_accounting
    ?? null;
}

function buildDecisionIndexPrArtifacts({ root, storyId, index, indexPath, bundlePath }) {
  if (!index) return [];
  const canonicalPath = toWorkspaceRelative(root, indexPath);
  const fallbackPath = toWorkspaceRelative(root, bundlePath);
  const pathForArtifact = canonicalPath.endsWith('audit-index.json') ? canonicalPath : fallbackPath;
  const artifacts = [];
  if (index.pr_prepare?.present) {
    artifacts.push({
      kind: 'pr_prepare',
      story_id: storyId,
      path: pathForArtifact,
      source: 'canonical_audit_summary',
      data: {
        schema_version: '0.1.0',
        created_at: index.pr_prepare.created_at ?? index.generated_at,
        story: { story_id: storyId },
        gate_status: index.pr_prepare.gate_status ?? {}
      }
    });
  }
  if (index.evidence_reuse?.present) {
    artifacts.push({
      kind: 'evidence_reuse',
      story_id: storyId,
      path: pathForArtifact,
      source: 'canonical_audit_summary',
      data: {
        schema_version: '0.1.0',
        story_id: storyId,
        created_at: index.evidence_reuse.created_at ?? index.generated_at,
        status: index.evidence_reuse.status ?? null,
        evidence_key: index.evidence_reuse.evidence_key ?? null,
        verification_summary_fingerprint: index.evidence_reuse.verification_summary_fingerprint ?? null,
        verification_evidence_updated_at: index.evidence_reuse.verification_evidence_updated_at ?? null,
        verification_command_timestamps: index.evidence_reuse.verification_command_timestamps ?? [],
        stale_reasons: Array.from({ length: index.evidence_reuse.stale_reason_count ?? 0 }, (_, index) => ({
          field: 'compact_summary',
          reason: `stale reason ${index + 1} recorded in compact canonical audit`
        })),
        full_evidence: {
          status: index.evidence_reuse.full_evidence_status ?? null,
          generation_count: index.evidence_reuse.full_evidence_generation_count ?? null,
          generation_count_scope: index.evidence_reuse.full_evidence_generation_count_scope ?? null,
          same_key_generation_count: index.evidence_reuse.full_evidence_same_key_generation_count
            ?? index.evidence_reuse.full_evidence_generation_count
            ?? null,
          cumulative_generation_count: index.evidence_reuse.full_evidence_cumulative_generation_count
            ?? index.evidence_reuse.full_evidence_generation_count
            ?? null
        }
      }
    });
  }
  if (index.senior_gap_judgment?.present) {
    const summary = index.senior_gap_judgment;
    artifacts.push({
      kind: 'senior_gap_judgment',
      story_id: storyId,
      path: pathForArtifact,
      source: 'canonical_audit_summary',
      data: {
        schema_version: '0.1.0',
        model: 'vibepro-senior-gap-judgment-summary-v1',
        story_id: storyId,
        generated_at: index.generated_at,
        decision: {
          status: summary.status ?? null,
          blocking_gap_count: summary.blocking_gap_count ?? 0,
          reason: 'Compact canonical audit index preserved senior gap judgment summary'
        },
        gaps: Array.from({ length: summary.gap_count ?? 0 }, (_, index) => ({
          id: `compact-summary-gap-${index + 1}`,
          kind: 'compact_summary_gap',
          safe_to_defer: index >= (summary.blocking_gap_count ?? 0)
        })),
        residual_risks: Array.from({ length: summary.residual_risk_count ?? 0 }, (_, index) => ({
          id: `compact-summary-residual-risk-${index + 1}`,
          kind: 'compact_summary_residual_risk'
        })),
        followups: Array.from({ length: summary.followup_count ?? 0 }, (_, index) => ({
          id: `compact-summary-followup-${index + 1}`,
          kind: 'compact_summary_followup'
        })),
        summary
      }
    });
  }
  if (index.pr_create?.present) {
    artifacts.push({
      kind: 'pr_create',
      story_id: storyId,
      path: pathForArtifact,
      source: 'canonical_audit_summary',
      data: {
        schema_version: '0.1.0',
        created_at: index.pr_create.created_at ?? index.generated_at,
        story_id: storyId,
        status: index.pr_create.status ?? null,
        pr_url: index.pr_create.pr_url ?? null,
        gate_override: { allowed: index.pr_create.gate_override_allowed === true }
      }
    });
  }
  if (index.pr_merge?.present) {
    artifacts.push({
      kind: 'pr_merge',
      story_id: storyId,
      path: pathForArtifact,
      source: 'canonical_audit_summary',
      data: {
        schema_version: '0.1.0',
        created_at: index.generated_at,
        story: { story_id: storyId },
        status: index.pr_merge.summary?.status ?? null,
        merged_at: index.pr_merge.summary?.merged_at ?? null,
        merge_commit_sha: index.pr_merge.summary?.merge_commit_sha ?? null,
        current_head_sha: index.pr_merge.summary?.current_head_sha ?? null,
        pr: { url: index.pr_merge.summary?.pr_url ?? null }
      }
    });
  }
  if (index.traceability?.present) {
    artifacts.push({
      kind: 'traceability',
      story_id: storyId,
      path: pathForArtifact,
      source: 'canonical_audit_summary',
      data: {
        schema_version: '0.1.0',
        story_id: storyId,
        lifecycle: index.traceability.lifecycle ?? null,
        coverage_summary: index.traceability.coverage_summary ?? null
      }
    });
  }
  if (index.verification?.present) {
    artifacts.push({
      kind: 'verification_evidence',
      story_id: storyId,
      path: pathForArtifact,
      source: 'canonical_audit_summary',
      data: {
        schema_version: '0.1.0',
        story_id: storyId,
        commands: []
      }
    });
  }
  return artifacts;
}

async function safeReaddir(dir) {
  try {
    return (await readdir(dir)).sort();
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

async function readJsonIfExists(filePath) {
  try {
    return JSON.parse(await readFile(filePath, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

function isWithinSince(value, since) {
  if (!since) return true;
  if (!value) return true;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return true;
  return parsed >= since;
}
