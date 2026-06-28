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
const CANONICAL_AUDIT_SCOPE = 'judgment_evidence_v1';

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
  let replayBundle = await writeCompressedReplayBundle(root, {
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
  const compressedReplayArtifact = {
    kind: 'compressed_replay_bundle',
    canonical_path: replayBundle.path,
    compression: replayBundle.compression,
    content_hash: replayBundle.content_hash
  };
  const artifacts = [
    {
      kind: 'audit_index',
      canonical_path: toWorkspaceRelative(root, indexPath)
    },
    {
      kind: 'decision_summary',
      canonical_path: toWorkspaceRelative(root, summaryPath)
    },
    compressedReplayArtifact
  ];
  const rawArtifacts = inventory.artifacts.map((artifact) => ({
    kind: artifact.kind,
    source: toWorkspaceRelative(root, artifact.sourcePath),
    persisted: 'compressed',
    compressed_path: replayBundle.path,
    digest: artifact.digest,
    audit_digest: artifact.audit_digest,
    line_count: artifact.line_count,
    raw_line_count: artifact.raw_line_count,
    audit_scope: artifact.audit_scope,
    excluded_from_audit: artifact.excluded_from_audit
  }));
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
    raw_artifacts: rawArtifacts,
    missing_artifacts: dedupeMissingArtifacts(inventory.missing_artifacts),
    resolved_references: [],
    copied_references: [],
    unresolved_references: []
  };
  let previousAccountingSignature = null;
  for (let index = 0; index < 5; index += 1) {
    syncReplayBundleReferences({
      replayBundle,
      decisionIndex,
      costSummary,
      bundle,
      compressedReplayArtifact
    });
    applyCompactCanonicalLineAccounting(costSummary, {
      rawSourceArtifactLines: inventory.artifact_line_count,
      replayBundle,
      decisionIndex,
      bundle
    });
    const currentAccountingSignature = JSON.stringify({
      artifact_lines: costSummary.artifact_lines,
      artifact_code_ratio: costSummary.artifact_code_ratio,
      budget_status: costSummary.budget_status,
      budget_exceeded_reasons: costSummary.budget_exceeded_reasons,
      replay_expanded_line_count: replayBundle.expanded_line_count
    });
    if (currentAccountingSignature === previousAccountingSignature) {
      break;
    }
    if (index === 4) {
      break;
    }
    previousAccountingSignature = currentAccountingSignature;
    replayBundle = await writeCompressedReplayBundle(root, {
      storyId,
      source,
      promotedAt,
      canonicalDir,
      decisionIndex,
      inventory,
      costSummary,
      merge
    });
  }
  await writeFile(indexPath, `${JSON.stringify(decisionIndex, null, 2)}\n`);
  await writeFile(summaryPath, renderDecisionSummary(decisionIndex));
  const bundlePath = path.join(canonicalDir, 'audit-bundle.json');
  await writeFile(bundlePath, `${JSON.stringify(bundle, null, 2)}\n`);
  return {
    canonical_dir: canonicalDir,
    bundle_path: bundlePath,
    bundle
  };
}

function syncReplayBundleReferences({
  replayBundle,
  decisionIndex,
  costSummary,
  bundle,
  compressedReplayArtifact
}) {
  decisionIndex.replay_bundle = replayBundle;
  costSummary.replay_bundle = replayBundle.cost;
  bundle.replay_bundle = replayBundle;
  bundle.handoff_replay.replay_bundle = replayBundle.path;
  bundle.handoff_replay.replay_command = replayBundle.replay_command;
  compressedReplayArtifact.canonical_path = replayBundle.path;
  compressedReplayArtifact.compression = replayBundle.compression;
  compressedReplayArtifact.content_hash = replayBundle.content_hash;
}

function applyCompactCanonicalLineAccounting(costSummary, {
  rawSourceArtifactLines,
  replayBundle,
  decisionIndex,
  bundle
}) {
  const rawRatio = ratioOrNull(rawSourceArtifactLines, costSummary.product_changed_lines);
  costSummary.raw_source_artifact_lines = rawSourceArtifactLines;
  costSummary.raw_source_artifact_code_ratio = rawRatio;
  costSummary.artifact_lines_source = 'persisted_canonical_compact';

  // Run twice so the second pass includes the first pass's accounting fields.
  for (let index = 0; index < 2; index += 1) {
    const summaryText = renderDecisionSummary(decisionIndex);
    const persistedLines = (
      countJsonLines(decisionIndex)
      + countTextLines(summaryText)
      + countJsonLines(bundle)
      + (replayBundle.expanded_line_count ?? 0)
    );
    const persistedRatio = ratioOrNull(persistedLines, costSummary.product_changed_lines);
    const lineBudgetExceeded = persistedLines > (costSummary.budget?.canonical_artifact_lines ?? Number.POSITIVE_INFINITY);
    const ratioBudgetExceeded = persistedRatio !== null
      && persistedRatio > (costSummary.budget?.artifact_code_ratio ?? Number.POSITIVE_INFINITY);
    costSummary.artifact_lines = persistedLines;
    costSummary.artifact_code_ratio = persistedRatio;
    costSummary.artifact_code_ratio_reason = persistedRatio === null
      ? (costSummary.product_changed_lines_status === 'available' ? 'product_changed_lines_zero' : 'diff_stats_unavailable')
      : null;
    costSummary.budget_status = lineBudgetExceeded || ratioBudgetExceeded ? 'exceeded' : 'within_budget';
    costSummary.budget_exceeded_reasons = [
      lineBudgetExceeded ? 'canonical_artifact_lines_exceeded' : null,
      ratioBudgetExceeded ? 'artifact_code_ratio_exceeded' : null
    ].filter(Boolean);
    decisionIndex.budget_status = costSummary.budget_status;
    decisionIndex.automation_value_audit = buildAutomationValueAuditContract(decisionIndex);
    bundle.automation_value_audit = decisionIndex.automation_value_audit;
  }
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
    artifacts: inventory.artifacts.map((artifact) => buildReplayArtifactManifest(root, artifact)),
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

function buildReplayArtifactManifest(root, artifact) {
  return {
    kind: artifact.kind,
    type: artifact.type,
    stage: artifact.stage,
    source: toWorkspaceRelative(root, artifact.sourcePath),
    digest: artifact.digest,
    audit_digest: artifact.audit_digest,
    line_count: artifact.line_count,
    raw_line_count: artifact.raw_line_count,
    audit_scope: artifact.audit_scope,
    excluded_from_audit: artifact.excluded_from_audit,
    summary: summarizeReplayArtifact(artifact)
  };
}

function summarizeReplayArtifact(artifact) {
  const data = artifact.data;
  if (artifact.kind === 'pr_prepare') {
    return compactObject({
      created_at: data?.created_at,
      gate_status: data?.gate_status,
      ready_for_pr_create: data?.gate_status?.ready_for_pr_create,
      unresolved_gate_count: data?.gate_status?.unresolved_gate_count,
      critical_unresolved_gate_count: data?.gate_status?.critical_unresolved_gate_count,
      evidence_reuse_status: data?.evidence_reuse?.status
    });
  }
  if (artifact.kind === 'pr_create') {
    return compactObject({
      status: data?.status,
      pr_url: data?.pr_url ?? data?.url,
      created_at: data?.created_at,
      gate_override_allowed: data?.gate_override?.allowed
    });
  }
  if (artifact.kind === 'pr_merge') {
    return compactObject({
      status: data?.status,
      pr_url: data?.pr?.url ?? data?.pr_url,
      merge_commit_sha: data?.merge_commit_sha,
      merged_at: data?.merged_at,
      current_head_sha: data?.current_head_sha,
      cost_accounting_status: data?.cost_accounting?.status,
      cost_accounting_collection_status: data?.cost_accounting_collection?.status
    });
  }
  if (artifact.kind === 'gate_dag') {
    const nodes = Array.isArray(data?.nodes) ? data.nodes : [];
    return compactObject({
      overall_status: data?.overall_status,
      node_count: nodes.length,
      blocking_count: nodes.filter((node) => ['block', 'needs_evidence', 'needs_review', 'failed'].includes(node?.status)).length,
      risk_profile: data?.risk_profile ?? data?.change_classification?.profile
    });
  }
  if (artifact.kind === 'senior_gap_judgment') {
    return compactObject({
      status: data?.decision?.status,
      gap_count: data?.gaps?.length,
      blocking_gap_count: data?.decision?.blocking_gap_count,
      residual_risk_count: data?.residual_risks?.length,
      followup_count: data?.followups?.length
    });
  }
  if (artifact.kind === 'traceability') {
    return compactObject({
      lifecycle: data?.lifecycle,
      coverage_summary: data?.coverage_summary
    });
  }
  if (artifact.kind === 'verification_evidence') {
    const commands = Array.isArray(data?.commands) ? data.commands : [];
    return compactObject({
      command_count: commands.length,
      pass_count: commands.filter((command) => ['pass', 'passed', 'success', 'ok'].includes(command?.status)).length,
      fail_count: commands.filter((command) => ['fail', 'failed', 'error'].includes(command?.status)).length,
      kinds: [...new Set(commands.map((command) => command?.kind).filter(Boolean))].sort()
    });
  }
  if (artifact.kind === 'evidence_reuse') {
    return compactObject({
      status: data?.status,
      evidence_key: data?.evidence_key,
      stale_reason_count: data?.stale_reasons?.length,
      full_evidence_status: data?.full_evidence?.status
    });
  }
  if (artifact.kind === 'review_summary') {
    return compactObject({
      status: data?.status,
      pass_count: data?.pass_count,
      stale_count: data?.stale_count,
      missing_count: data?.missing_count,
      block_count: data?.block_count,
      needs_changes_count: data?.needs_changes_count
    });
  }
  if (artifact.kind === 'review_result') {
    return compactObject({
      status: data?.status,
      summary: data?.summary,
      finding_count: data?.finding_count ?? data?.findings?.length,
      agent_id: data?.agent_provenance?.agent_id,
      provenance_status: data?.agent_provenance?.system
    });
  }
  if (artifact.kind === 'review_lifecycle') {
    const entries = Array.isArray(data?.entries) ? data.entries : [];
    return compactObject({
      entry_count: data?.entry_count ?? entries.length,
      running_count: data?.running_count,
      timed_out_count: data?.timed_out_count,
      closed_count: data?.closed_count,
      latest_status: data?.latest?.status
    });
  }
  if (artifact.kind === 'review_request') {
    return compactObject({
      line_count: artifact.line_count,
      raw_line_count: artifact.raw_line_count,
      content_digest: artifact.audit_digest
    });
  }
  return compactObject({
    line_count: artifact.line_count,
    raw_line_count: artifact.raw_line_count
  });
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
  const rawLineCount = countTextLines(text);
  const rawDigest = `sha256:${sha256Hex(text)}`;
  const sourceReferences = extractVibeProReferences(text);
  const scoped = type === 'json'
    ? applyCanonicalAuditScope(kind, JSON.parse(text))
    : {
        data: null,
        content: text,
        excluded_from_audit: [],
        audit_scope: CANONICAL_AUDIT_SCOPE
      };
  const auditText = type === 'json'
    ? `${JSON.stringify(scoped.data, null, 2)}\n`
    : scoped.content;
  return {
    kind,
    type,
    stage,
    sourcePath,
    targetPath,
    source: toWorkspaceRelative(root, sourcePath),
    canonical_path: toWorkspaceRelative(root, targetPath),
    line_count: countTextLines(auditText),
    raw_line_count: rawLineCount,
    digest: rawDigest,
    audit_digest: `sha256:${sha256Hex(auditText)}`,
    audit_scope: scoped.audit_scope,
    excluded_from_audit: scoped.excluded_from_audit,
    source_references: sourceReferences,
    data: scoped.data,
    content: scoped.content
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
    cost_controls: buildAutomationCostControls({ index, cost, evidenceToSrcRatio }),
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

function buildAutomationCostControls({ index, cost, evidenceToSrcRatio }) {
  const budgetExceeded = cost.budget_status === 'exceeded';
  const reasons = cost.budget_exceeded_reasons ?? [];
  const recommendations = [];
  if (budgetExceeded) {
    recommendations.push({
      id: 'prefer_summary_canonical_artifacts',
      action: 'persist summary/index/replay references instead of full raw audit copies for routine value audits',
      reason: 'canonical audit evidence exceeded the configured line or artifact/code ratio budget'
    });
  }
  if (cost.token_accounting?.status !== 'available' || cost.elapsed_time_accounting?.status !== 'available') {
    recommendations.push({
      id: 'collect_runtime_cost_before_merge',
      action: 'run execute merge with --session-id <id>|auto and --automation-memory <path>, or set VIBEPRO_SESSION_ID/CODEX_SESSION_ID and VIBEPRO_AUTOMATION_MEMORY',
      reason: 'daily automation cannot judge time/token efficiency without measured session cost'
    });
  }
  if (evidenceToSrcRatio !== null && evidenceToSrcRatio > 3) {
    recommendations.push({
      id: 'split_or_shrink_evidence_heavy_story',
      action: 'split follow-up evidence work or reduce non-product artifact churn before the next merge',
      reason: 'test/story/audit evidence changed lines are more than 3x src changed lines'
    });
  }
  return {
    status: recommendations.length > 0 ? 'action_required' : 'within_controls',
    budget_status: cost.budget_status ?? null,
    artifact_code_ratio: cost.artifact_code_ratio ?? null,
    automation_evidence_to_src: evidenceToSrcRatio,
    budget_exceeded_reasons: reasons,
    canonical_artifact_lines: cost.artifact_lines ?? null,
    product_changed_lines: cost.product_changed_lines ?? null,
    evidence_depth: index.evidence_depth ?? cost.evidence_depth ?? null,
    recommended_evidence_depth: budgetExceeded ? 'summary' : (cost.evidence_depth ?? null),
    recommendations
  };
}

function bucketChangedLines(bucket) {
  const value = bucket?.changed_lines;
  return Number.isFinite(value) ? value : 0;
}

function ratioOrNull(numerator, denominator) {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) return null;
  return Number((numerator / denominator).toFixed(3));
}

function countJsonLines(value) {
  return countTextLines(`${JSON.stringify(value, null, 2)}\n`);
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
- cost_controls: ${index.automation_value_audit?.cost_controls?.status ?? 'unknown'} recommended_depth=${index.automation_value_audit?.cost_controls?.recommended_evidence_depth ?? 'unknown'} recommendations=${index.automation_value_audit?.cost_controls?.recommendations?.length ?? 0}
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

function applyCanonicalAuditScope(kind, data) {
  const excluded = [];
  const scopedData = (() => {
    if (kind === 'pr_prepare') return scopedPrPrepare(data, excluded);
    if (kind === 'pr_create') return scopedPrLifecycle(data, 'canonical_pr_create_audit_summary', excluded);
    if (kind === 'pr_merge') return scopedPrLifecycle(data, 'canonical_pr_merge_audit_summary', excluded);
    if (kind === 'gate_dag') return scopedGateDag(data, excluded);
    if (kind === 'senior_gap_judgment') return scopedSeniorGapJudgment(data, excluded);
    if (kind === 'verification_evidence') return scopedVerificationEvidence(data, excluded);
    return data;
  })();
  return {
    data: scopedData,
    content: null,
    audit_scope: CANONICAL_AUDIT_SCOPE,
    excluded_from_audit: [...new Set(excluded)]
  };
}

function scopedPrPrepare(data, excluded) {
  excluded.push(
    'pr_prepare.diagnostics.progress_snapshots',
    'pr_prepare.pr_context.full_gate_dag',
    'pr_prepare.pr_context.design_ssot_full_registry_inventory',
    'pr_prepare.pr_context.inactive_judgment_axis_details',
    'pr_prepare.duplicated_child_artifacts'
  );
  const context = data?.pr_context ?? {};
  return compactObject({
    schema_version: data?.schema_version,
    artifact_kind: 'canonical_pr_prepare_audit_summary',
    audit_scope: CANONICAL_AUDIT_SCOPE,
    created_at: data?.created_at,
    story: data?.story,
    output: data?.output,
    gate_status: data?.gate_status,
    git: scopedGit(data?.git),
    scope: data?.scope,
    lifecycle_artifacts: data?.lifecycle_artifacts,
    pr_context: compactObject({
      story_source: context.story_source,
      story_source_integrity: context.story_source_integrity,
      design_ssot_reconciliation: scopedDesignSsotReconciliation(context.design_ssot_reconciliation, excluded),
      responsibility_authority: scopedResponsibilityAuthority(context.responsibility_authority, excluded),
      requirement_consistency: scopedRequirementConsistency(context.requirement_consistency, excluded),
      engineering_judgment: scopedEngineeringJudgment(context.engineering_judgment, excluded),
      verification_evidence: scopedVerificationEvidence(context.verification_evidence, excluded),
      decision_records: context.decision_records,
      agent_reviews: context.agent_reviews,
      senior_gap_judgment: scopedSeniorGapJudgment(context.senior_gap_judgment, excluded),
      traceability_clause_coverage: context.traceability_clause_coverage,
      evidence_reuse: context.evidence_reuse ? {
        status: context.evidence_reuse.status,
        key: context.evidence_reuse.key,
        stale: context.evidence_reuse.stale,
        fresh_use_allowed: context.evidence_reuse.fresh_use_allowed,
        used_as_fresh: context.evidence_reuse.used_as_fresh,
        artifact: context.evidence_reuse.artifact
      } : null,
      gate_dag_summary: scopedGateDag(context.gate_dag, excluded),
      execution_gate: context.execution_gate,
      completion_quality: context.completion_quality
    }),
    artifact_refs: compactObject({
      evidence_reuse: data?.evidence_reuse ? '.vibepro/pr/<story-id>/evidence-reuse.json' : null,
      evidence_plan: data?.evidence_plan ? '.vibepro/pr/<story-id>/evidence-plan.json' : null,
      decision_index: data?.decision_index ? '.vibepro/pr/<story-id>/decision-index.json' : null,
      split_plan: data?.split_plan ? '.vibepro/pr/<story-id>/split-plan.json' : null,
      gate_dag: context.gate_dag ? '.vibepro/pr/<story-id>/gate-dag.json' : null
    })
  });
}

function scopedPrLifecycle(data, artifactKind, excluded) {
  excluded.push('pr_lifecycle.full_gate_dag', 'pr_lifecycle.raw_command_output');
  const gateDag = data?.gate_dag;
  const results = data?.results;
  return compactObject({
    schema_version: data?.schema_version,
    artifact_kind: artifactKind,
    audit_scope: CANONICAL_AUDIT_SCOPE,
    created_at: data?.created_at,
    story: data?.story,
    mode: data?.mode,
    dry_run: data?.dry_run,
    status: data?.status,
    output: data?.output,
    pr_url: data?.pr_url,
    pr: data?.pr,
    title: data?.title,
    base: data?.base,
    head: data?.head,
    body_file: data?.body_file,
    current_branch: data?.current_branch,
    current_head_sha: data?.current_head_sha,
    workspace_initialized: data?.workspace_initialized,
    repository_slug: data?.repository_slug,
    strategy: data?.strategy,
    branch_cleanup: data?.branch_cleanup,
    delete_branch: data?.delete_branch,
    preconditions: data?.preconditions,
    merged_at: data?.merged_at,
    merge_commit_sha: data?.merge_commit_sha,
    stop_reason: data?.stop_reason,
    cost_accounting: data?.cost_accounting,
    cost_accounting_collection: data?.cost_accounting_collection,
    canonical_audit: data?.canonical_audit,
    prepare_artifacts: data?.prepare_artifacts,
    gate_override: data?.gate_override,
    execution_gate: data?.execution_gate,
    artifact_freshness: data?.artifact_freshness,
    warnings: data?.warnings,
    toolchain: data?.toolchain,
    gate_dag_summary: scopedGateDag(gateDag, excluded),
    commands: data?.commands,
    results: Array.isArray(results)
      ? results.map((result) => ({
          command: result.command,
          started_at: result.started_at,
          finished_at: result.finished_at,
          exit_code: result.exit_code,
          stdout_bytes: byteLength(result.stdout),
          stderr_bytes: byteLength(result.stderr),
          stdout_excerpt: excerpt(result.stdout),
          stderr_excerpt: excerpt(result.stderr)
        }))
      : results
  });
}

function scopedGateDag(gateDag, excluded) {
  if (!gateDag || typeof gateDag !== 'object') return gateDag ?? null;
  excluded.push('gate_dag.verbose_evidence_objects');
  return compactObject({
    schema_version: gateDag.schema_version,
    artifact_kind: 'canonical_gate_dag_audit_summary',
    audit_scope: CANONICAL_AUDIT_SCOPE,
    story_id: gateDag.story_id,
    model: gateDag.model,
    overall_status: gateDag.overall_status,
    risk_profile: gateDag.risk_profile,
    summary: gateDag.summary,
    nodes: Array.isArray(gateDag.nodes) ? gateDag.nodes.map(scopedGateNode) : gateDag.nodes,
    edges: gateDag.edges
  });
}

function scopedGateNode(node) {
  if (!node || typeof node !== 'object') return node;
  return compactObject({
    id: node.id,
    type: node.type,
    label: node.label,
    status: node.status,
    required: node.required,
    axis: node.axis,
    axis_status: node.axis_status,
    confidence: node.confidence,
    reason: node.reason,
    missing_evidence: node.missing_evidence,
    matched_blockers: node.matched_blockers,
    blocker_waiver: scopedDecisionRef(node.blocker_waiver),
    evidence: summarizeEvidenceList(node.matched_evidence),
    optional_evidence_count: Array.isArray(node.optional_evidence) ? node.optional_evidence.length : undefined
  });
}

function scopedEngineeringJudgment(judgment, excluded) {
  if (!judgment || typeof judgment !== 'object') return judgment ?? null;
  const axes = Array.isArray(judgment.judgment_axes) ? judgment.judgment_axes : [];
  const activeAxes = axes.filter((axis) => !String(axis.status ?? '').startsWith('inactive'));
  excluded.push('engineering_judgment.inactive_axis_details', 'engineering_judgment.verbose_matched_evidence');
  return compactObject({
    schema_version: judgment.schema_version,
    label: judgment.label,
    route_type: judgment.route_type,
    route_dag: judgment.route_dag,
    confidence: judgment.confidence,
    signals: judgment.signals,
    active_axes: judgment.active_axes,
    active_axis_count: judgment.active_axis_count ?? activeAxes.length,
    inactive_axis_count: Math.max(axes.length - activeAxes.length, 0),
    common_spine: judgment.common_spine,
    judgment_axes: activeAxes.map(scopedJudgmentAxis)
  });
}

function scopedJudgmentAxis(axis) {
  return compactObject({
    axis: axis.axis,
    status: axis.status,
    reason: axis.reason,
    confidence: axis.confidence,
    decision_question: axis.decision_question,
    required_evidence: axis.required_evidence,
    blocking_criteria: axis.blocking_criteria,
    acceptable_followup: axis.acceptable_followup,
    signals: axis.signals,
    activation_precision: axis.activation_precision,
    missing_evidence: axis.missing_evidence,
    matched_blockers: axis.matched_blockers,
    blocker_waiver: scopedDecisionRef(axis.blocker_waiver),
    evidence: summarizeEvidenceList(axis.matched_evidence),
    optional_evidence_count: Array.isArray(axis.optional_evidence) ? axis.optional_evidence.length : undefined
  });
}

function scopedDesignSsotReconciliation(reconciliation, excluded) {
  if (!reconciliation || typeof reconciliation !== 'object') return reconciliation ?? null;
  const coverage = reconciliation.coverage ?? {};
  excluded.push('design_ssot.unregistered_docs_full_inventory', 'design_ssot.registered_docs_full_inventory');
  return compactObject({
    schema_version: reconciliation.schema_version,
    status: reconciliation.status,
    model: reconciliation.model,
    workflow: reconciliation.workflow,
    generated_at: reconciliation.generated_at,
    summary: reconciliation.summary,
    changed_paths: reconciliation.changed_paths,
    action_items: reconciliation.action_items,
    registry_sources: reconciliation.registry_sources,
    coverage: compactObject({
      schema_version: coverage.schema_version,
      status: coverage.status,
      summary: coverage.summary,
      changed_paths: coverage.changed_paths,
      changed_docs: coverage.changed_docs,
      unregistered_changed_docs: coverage.unregistered_changed_docs,
      registered_doc_count: Array.isArray(coverage.registered_docs) ? coverage.registered_docs.length : undefined,
      unregistered_doc_count: Array.isArray(coverage.unregistered_docs) ? coverage.unregistered_docs.length : undefined,
      registry_sources: coverage.registry_sources
    })
  });
}

function scopedResponsibilityAuthority(authority, excluded) {
  if (!authority || typeof authority !== 'object') return authority ?? null;
  excluded.push('responsibility_authority.full_registry_entries');
  return compactObject({
    schema_version: authority.schema_version,
    status: authority.status,
    model: authority.model,
    summary: authority.summary,
    risk_surfaces: authority.risk_surfaces,
    changed_paths: authority.changed_paths,
    registry_sources: authority.registry_sources,
    domain_contract_sources: authority.domain_contract_sources,
    invalid_registry_entries: authority.invalid_registry_entries,
    unregistered_candidates: authority.unregistered_candidates,
    matched_responsibilities: Array.isArray(authority.matched_responsibilities)
      ? authority.matched_responsibilities.map((item) => compactObject({
          id: item.id,
          primary_authority: item.primary_authority,
          supporting_authority: item.supporting_authority,
          matched_by: item.matched_by,
          confidence: item.confidence,
          required_evidence: summarizeEvidenceList(item.required_evidence),
          contract_refs: item.contract_refs,
          unknown_policy: item.unknown_policy
        }))
      : authority.matched_responsibilities
  });
}

function scopedRequirementConsistency(consistency, excluded) {
  if (!consistency || typeof consistency !== 'object') return consistency ?? null;
  excluded.push('requirement_consistency.verbose_code_scenarios');
  return compactObject({
    schema_version: consistency.schema_version,
    status: consistency.status,
    summary: consistency.summary,
    story_source: consistency.story_source,
    requirement_sources: consistency.requirement_sources,
    invariants: consistency.invariants,
    contradictions: consistency.contradictions,
    scenario_gaps: consistency.scenario_gaps,
    policy_refs: consistency.policy_refs,
    responsibility_authority: consistency.responsibility_authority,
    code_scenarios: Array.isArray(consistency.code_scenarios)
      ? consistency.code_scenarios.map((scenario) => compactObject({
          id: scenario.id ?? scenario.scenario_id,
          status: scenario.status,
          source: scenario.source,
          covered: scenario.covered,
          evidence_refs: scenario.evidence_refs,
          requirement_count: Array.isArray(scenario.requirements) ? scenario.requirements.length : undefined
        }))
      : consistency.code_scenarios
  });
}

function scopedSeniorGapJudgment(data, excluded) {
  if (!data || typeof data !== 'object') return data ?? null;
  excluded.push('senior_gap_judgment.verbose_supporting_context');
  return compactObject({
    schema_version: data.schema_version,
    status: data.status,
    judgment_status: data.judgment_status,
    story_id: data.story_id,
    created_at: data.created_at,
    summary: data.summary,
    blocking_gap_count: data.blocking_gap_count,
    residual_gap_count: data.residual_gap_count,
    gaps: Array.isArray(data.gaps)
      ? data.gaps.map((gap) => compactObject({
          id: gap.id,
          status: gap.status,
          severity: gap.severity,
          title: gap.title,
          current: gap.current,
          ideal: gap.ideal,
          residual_risk: gap.residual_risk,
          recommendation: gap.recommendation,
          evidence_refs: gap.evidence_refs
        }))
      : data.gaps
  });
}

function scopedVerificationEvidence(data, excluded) {
  if (!data || typeof data !== 'object') return data ?? null;
  excluded.push('verification.raw_command_output');
  return compactObject({
    schema_version: data.schema_version,
    story_id: data.story_id,
    updated_at: data.updated_at,
    generated_at: data.generated_at,
    evidence_key: data.evidence_key,
    command_count: data.command_count,
    pass_count: data.pass_count,
    fail_count: data.fail_count,
    status: data.status,
    summary: data.summary,
    warnings: data.warnings,
    commands: Array.isArray(data.commands)
      ? data.commands.map((command) => compactObject({
          id: command.id,
          kind: command.kind,
          status: command.status,
          command: command.command,
          summary: command.summary,
          artifact: command.artifact,
          target: command.target,
          targets: command.targets,
          scenario: command.scenario,
          scenarios: command.scenarios,
          observed: command.observed,
          recorded_at: command.recorded_at,
          stdout_bytes: byteLength(command.stdout),
          stderr_bytes: byteLength(command.stderr),
          stdout_excerpt: excerpt(command.stdout),
          stderr_excerpt: excerpt(command.stderr)
        }))
      : data.commands
  });
}

function scopedGit(git) {
  if (!git || typeof git !== 'object') return git ?? null;
  return compactObject({
    base_ref: git.base_ref,
    head_ref: git.head_ref,
    base_sha: git.base_sha,
    head_sha: git.head_sha,
    current_branch: git.current_branch,
    diff_stats: git.diff_stats,
    diff_line_stats: git.diff_line_stats,
    changed_files: Array.isArray(git.changed_files)
      ? git.changed_files.map((file) => typeof file === 'string' ? file : file.path ?? file.file ?? file)
      : git.changed_files
  });
}

function summarizeEvidenceList(items) {
  if (!Array.isArray(items)) return items;
  return items.map((item) => {
    if (typeof item === 'string') return item;
    return compactObject({
      kind: item.kind ?? item.id ?? item.type,
      ref: item.ref ?? item.path ?? item.artifact,
      status: item.status,
      strength: item.strength,
      binding_status: item.binding_status,
      artifact_quality: item.artifact_quality,
      freshness: item.freshness,
      summary: item.summary
    });
  });
}

function scopedDecisionRef(value) {
  if (!value || typeof value !== 'object') return value ?? null;
  return compactObject({
    decision_id: value.decision_id ?? value.id,
    source: value.source,
    status: value.status ?? 'accepted',
    reason: value.reason,
    artifact: value.artifact
  });
}

function compactObject(object) {
  if (!object || typeof object !== 'object' || Array.isArray(object)) return object;
  return Object.fromEntries(
    Object.entries(object).filter(([, value]) => value !== undefined && value !== null)
  );
}

function byteLength(value) {
  return value === undefined || value === null ? 0 : Buffer.byteLength(String(value));
}

function excerpt(value, limit = 240) {
  if (value === undefined || value === null || value === '') return null;
  const text = String(value);
  return text.length > limit ? `${text.slice(0, limit)}...` : text;
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
    for (const ref of artifact.source_references ?? []) refs.add(ref);
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
  const text = await readTextIfExists(sourcePath);
  if (text === null) {
    missing_artifacts.push({
      kind,
      source: toWorkspaceRelative(root, sourcePath)
    });
    return;
  }
  const data = JSON.parse(text);
  const scoped = applyCanonicalAuditScope(kind, data);
  await mkdir(path.dirname(targetPath), { recursive: true });
  await writeFile(targetPath, `${JSON.stringify(scoped.data, null, 2)}\n`);
  artifacts.push({
    kind,
    source: toWorkspaceRelative(root, sourcePath),
    canonical_path: toWorkspaceRelative(root, targetPath),
    audit_scope: scoped.audit_scope,
    excluded_from_audit: scoped.excluded_from_audit,
    source_references: extractVibeProReferences(text)
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
