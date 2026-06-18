import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

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

export function getCanonicalAuditDir(repoRoot, storyId) {
  return path.join(path.resolve(repoRoot), CANONICAL_AUDIT_ROOT, storyId);
}

export async function promoteCanonicalAuditArtifacts(repoRoot, { storyId, source = 'execute_merge', merge = null, now = null } = {}) {
  if (!storyId) throw new Error('canonical audit promotion requires storyId');
  const root = path.resolve(repoRoot);
  const promotedAt = now ?? new Date().toISOString();
  const canonicalDir = getCanonicalAuditDir(root, storyId);
  const artifacts = [];
  const missing_artifacts = [];

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
      if (!REVIEW_AUDIT_FILES.some((pattern) => pattern.test(entry))) continue;
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
    }
  }

  const bundle = {
    schema_version: '0.1.0',
    story_id: storyId,
    source,
    promoted_at: promotedAt,
    canonical_dir: toWorkspaceRelative(root, canonicalDir),
    source_workspace_dir: toWorkspaceRelative(root, getWorkspaceDir(root)),
    artifact_policy: {
      scope: 'audit_core_only',
      persisted_for_main_audit: true,
      excludes: [
        'HTML reports',
        'raw logs',
        'dispatch scratch artifacts',
        'temporary execution state'
      ]
    },
    merge: merge ? {
      status: merge.status ?? null,
      pr_url: merge.pr?.url ?? merge.pr?.selector ?? null,
      merge_commit_sha: merge.merge_commit_sha ?? null,
      merged_at: merge.merged_at ?? null,
      current_head_sha: merge.current_head_sha ?? null
    } : null,
    artifacts,
    missing_artifacts
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
