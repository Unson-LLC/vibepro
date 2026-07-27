import crypto from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

// Review-surface violations are deliberately kept apart from review staleness.
//
// Stale means "the review no longer covers the current head" and is resolved by
// re-running the review; the result artifact is overwritten and the previous
// state is supposed to disappear. A violation means "the review surface moved
// while the review was running", so what the reviewer actually inspected can no
// longer be reconstructed. Re-running does not answer that question, therefore
// the record must survive every later run.
//
// The separation is structural, not conventional: violations live in their own
// story-level file, and this module exposes no delete or update operation. The
// only write path appends, and it is idempotent on a deterministic violation_id
// so replaying the same close cannot inflate the ledger either.

export const REVIEW_SURFACE_VIOLATIONS_FILE = 'surface-violations.json';
export const REVIEW_SURFACE_MUTATION_KIND = 'review_surface_mutated_during_review';
export const REVIEW_SURFACE_INTEGRITY_GATE_ID = 'gate:review_surface_integrity';

const SCHEMA_VERSION = '0.1.0';

export function getReviewSurfaceViolationsPath(storyReviewDir) {
  return path.join(storyReviewDir, REVIEW_SURFACE_VIOLATIONS_FILE);
}

export async function readReviewSurfaceViolations(storyReviewDir, storyId = null) {
  const empty = { schema_version: SCHEMA_VERSION, story_id: storyId, entries: [] };
  try {
    const parsed = JSON.parse(await readFile(getReviewSurfaceViolationsPath(storyReviewDir), 'utf8'));
    if (!Array.isArray(parsed?.entries)) return empty;
    return { ...empty, ...parsed, entries: parsed.entries };
  } catch (error) {
    if (error.code === 'ENOENT') return empty;
    if (error instanceof SyntaxError) return empty;
    throw error;
  }
}

/**
 * Compare the surface a review lifecycle started on with the surface observed at
 * close time. Returns null when nothing moved, or when the close is not the kind
 * of close that can carry a completed review.
 */
export function detectReviewSurfaceMutation(lifecycleEntry, {
  closeHeadSha = null,
  closeSurfaceDigest = null,
  closeReason = null
} = {}) {
  if (!lifecycleEntry) return null;
  // replaced / timeout / manual_shutdown closes never carry a review result
  // (review record refuses to attach to them), so a moved surface there is a
  // discarded attempt, not a contaminated verdict.
  if (closeReason !== 'completed') return null;
  const startHeadSha = normalize(lifecycleEntry.head_sha);
  const startSurfaceDigest = normalize(lifecycleEntry.surface_digest);
  const changedFields = [];
  if (startHeadSha && closeHeadSha && startHeadSha !== closeHeadSha) changedFields.push('head_sha');
  if (startSurfaceDigest && closeSurfaceDigest && startSurfaceDigest !== closeSurfaceDigest) {
    changedFields.push('surface_digest');
  }
  if (changedFields.length === 0) return null;
  return {
    kind: REVIEW_SURFACE_MUTATION_KIND,
    evidence_class: 'violation',
    changed_fields: changedFields,
    started: { head_sha: startHeadSha, surface_digest: startSurfaceDigest },
    closed: { head_sha: normalize(closeHeadSha), surface_digest: normalize(closeSurfaceDigest) }
  };
}

export function buildReviewSurfaceViolationId(violation) {
  const material = [
    violation.story_id,
    violation.stage,
    violation.role,
    violation.lifecycle_id,
    violation.kind,
    violation.started?.head_sha,
    violation.started?.surface_digest,
    violation.closed?.head_sha,
    violation.closed?.surface_digest
  ].map((value) => value ?? '').join('|');
  return `rsv-${crypto.createHash('sha256').update(material).digest('hex').slice(0, 16)}`;
}

/**
 * Append-only. Never removes or rewrites an existing entry: a replayed close
 * resolves to the same violation_id and returns the entry already on disk.
 */
export async function appendReviewSurfaceViolation(storyReviewDir, storyId, violation) {
  const existing = await readReviewSurfaceViolations(storyReviewDir, storyId);
  const entry = {
    schema_version: SCHEMA_VERSION,
    violation_id: buildReviewSurfaceViolationId({ ...violation, story_id: storyId }),
    story_id: storyId,
    ...violation,
    detected_by: violation.detected_by ?? 'review close',
    recorded_at: violation.recorded_at ?? new Date().toISOString()
  };
  const already = existing.entries.find((item) => item.violation_id === entry.violation_id);
  if (already) return { entry: already, appended: false, entries: existing.entries };
  const entries = [...existing.entries, entry];
  await writeViolations(storyReviewDir, storyId, entries);
  return { entry, appended: true, entries };
}

/**
 * Acknowledgement never deletes anything. It pairs surviving ledger entries with
 * accepted decision records so a human episode can close the gate while the
 * recorded fact stays in the artifact forever.
 */
export function summarizeReviewSurfaceViolations(entries = [], { decisionRecords = null } = {}) {
  const accepted = (decisionRecords?.decisions ?? [])
    .filter((decision) => decision?.status === 'accepted' && typeof decision.source === 'string');
  const items = (Array.isArray(entries) ? entries : []).map((entry) => {
    const acknowledgement = accepted.find((decision) => decision.source === `${REVIEW_SURFACE_INTEGRITY_GATE_ID}:${entry.violation_id}`) ?? null;
    return {
      ...entry,
      acknowledged: Boolean(acknowledgement),
      acknowledgement: acknowledgement ? {
        decision_id: acknowledgement.decision_id ?? null,
        source: acknowledgement.source,
        reason: acknowledgement.reason ?? null,
        artifact: acknowledgement.artifact ?? null,
        reviewer: acknowledgement.reviewer ?? null
      } : null
    };
  });
  const unacknowledged = items.filter((item) => !item.acknowledged);
  return {
    schema_version: SCHEMA_VERSION,
    total_count: items.length,
    acknowledged_count: items.length - unacknowledged.length,
    unacknowledged_count: unacknowledged.length,
    entries: items,
    unacknowledged
  };
}

export function buildReviewSurfaceViolationAcknowledgementCommand(storyId, violationId) {
  return `vibepro decision record . --id ${storyId} --type needs_review --source ${REVIEW_SURFACE_INTEGRITY_GATE_ID}:${violationId} --status accepted --summary "<what the reviewer actually inspected>" --reason "<human judgement on the mid-review surface change>" --artifact <evidence-path>`;
}

async function writeViolations(storyReviewDir, storyId, entries) {
  await mkdir(storyReviewDir, { recursive: true });
  const filePath = getReviewSurfaceViolationsPath(storyReviewDir);
  const tempPath = `${filePath}.${crypto.randomUUID()}.tmp`;
  const payload = {
    schema_version: SCHEMA_VERSION,
    model: 'vibepro-review-surface-violations-v1',
    story_id: storyId,
    append_only: true,
    updated_at: new Date().toISOString(),
    entries
  };
  try {
    await writeFile(tempPath, `${JSON.stringify(payload, null, 2)}\n`);
    await rename(tempPath, filePath);
  } catch (error) {
    await rm(tempPath, { force: true });
    throw error;
  }
}

function normalize(value) {
  const text = typeof value === 'string' ? value.trim() : '';
  return text.length > 0 ? text : null;
}
