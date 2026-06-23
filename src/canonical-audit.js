import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
  buildCanonicalEvidenceCostSummary,
  shouldUseCompactCanonicalEvidence
} from './evidence-cost-budget.js';
import { getWorkspaceDir, toWorkspaceRelative } from './workspace.js';

export const CANONICAL_AUDIT_ROOT = path.join('docs', 'management', 'audit-artifacts');

const PR_AUDIT_FILES = [
  ['pr-prepare.json', 'pr_prepare'],
  ['pr-create.json', 'pr_create'],
  ['gate-dag.json', 'gate_dag'],
  ['pr-merge.json', 'pr_merge'],
  ['traceability.json', 'traceability'],
  ['verification-evidence.json', 'verification_evidence']
];
const REVIEW_AUDIT_FILES = [/^review-summary\.json$/, /^review-result-.+\.json$/, /^lifecycle\.json$/];
const REVIEW_HANDOFF_FILES = [/^review-request-.+\.md$/];
const VIBEPRO_REFERENCE_RE = /\.vibepro\/[A-Za-z0-9_./:@-]+/g;
const MAX_REFERENCED_ARTIFACT_BYTES = 512 * 1024;

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
    merge: merge ? {
      status: merge.status ?? null,
      pr_url: merge.pr?.url ?? merge.pr?.selector ?? null,
      merge_commit_sha: merge.merge_commit_sha ?? null,
      merged_at: merge.merged_at ?? null,
      current_head_sha: merge.current_head_sha ?? null
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
    decision_index: decisionIndex,
    merge: decisionIndex.pr_merge.present ? decisionIndex.pr_merge.summary : null,
    handoff_replay_status: 'summary_ready',
    handoff_replay: {
      status: 'summary_ready',
      resolved_reference_count: 0,
      copied_reference_count: 0,
      unresolved_reference_count: 0
    },
    artifacts,
    raw_artifacts: inventory.artifacts.map((artifact) => ({
      kind: artifact.kind,
      source: toWorkspaceRelative(root, artifact.sourcePath),
      persisted: false,
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
    digest: `sha256:${createHash('sha256').update(text).digest('hex')}`,
    data: type === 'json' ? JSON.parse(text) : null
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
  const prCreate = latestData(byKind.get('pr_create'));
  const prMerge = latestData(byKind.get('pr_merge')) ?? merge;
  const gateDag = latestData(byKind.get('gate_dag'));
  const traceability = latestData(byKind.get('traceability'));
  const verification = latestData(byKind.get('verification_evidence'));
  const reviewSummaries = (byKind.get('review_summary') ?? []).map((artifact) => artifact.data);
  const reviewResults = (byKind.get('review_result') ?? []).map((artifact) => artifact.data);

  return {
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
        current_head_sha: prMerge.current_head_sha ?? null
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
}

function renderDecisionSummary(index) {
  return `# VibePro Decision Summary

- story: ${index.story_id}
- evidence_depth: ${index.evidence_depth}
- budget_status: ${index.budget_status}
- artifact_lines: ${index.cost_summary.artifact_lines}
- product_changed_lines: ${index.cost_summary.product_changed_lines}
- artifact_code_ratio: ${index.cost_summary.artifact_code_ratio ?? 'unknown'}
- pr_prepare: ${index.pr_prepare.present ? index.pr_prepare.gate_status?.overall_status ?? 'present' : 'missing'}
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
