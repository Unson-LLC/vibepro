import crypto from 'node:crypto';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
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
// only write path appends under a story-level lock, and it is idempotent on a
// deterministic violation_id so replaying the same close cannot inflate the
// ledger either.
//
// The file itself is still just a file, and nothing here can stop someone from
// overwriting it out of band. What the design does instead is make that visible:
// review close also stamps surface_violation_id onto the lifecycle entry, and
// reconciliation reports any pointer with no matching ledger entry as a
// missing-entry violation. Replacing the ledger with a well-formed empty one
// therefore trades a recorded violation for a different recorded violation.

export const REVIEW_SURFACE_VIOLATIONS_FILE = 'surface-violations.json';
export const REVIEW_SURFACE_MUTATION_KIND = 'review_surface_mutated_during_review';
export const REVIEW_SURFACE_INTEGRITY_GATE_ID = 'gate:review_surface_integrity';

const SCHEMA_VERSION = '0.1.0';

export function getReviewSurfaceViolationsPath(storyReviewDir) {
  return path.join(storyReviewDir, REVIEW_SURFACE_VIOLATIONS_FILE);
}

export const REVIEW_SURFACE_LEDGER_UNREADABLE = 'VIBEPRO_REVIEW_SURFACE_LEDGER_UNREADABLE';
export const REVIEW_SURFACE_LEDGER_UNREADABLE_VIOLATION_ID = 'ledger_unreadable';
export const REVIEW_SURFACE_POINTERS_UNREADABLE_VIOLATION_ID = 'lifecycle_pointers_unreadable';

/**
 * A malformed or structurally invalid ledger is rejected, never read as empty.
 * Treating corrupt content as "no violations" would hand back the erase path
 * this module exists to remove: truncating the file would silently clear every
 * recorded violation. An absent file is different — nothing was ever recorded.
 */
export async function readReviewSurfaceViolations(storyReviewDir, storyId = null) {
  const filePath = getReviewSurfaceViolationsPath(storyReviewDir);
  let raw;
  try {
    raw = await readFile(filePath, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return { schema_version: SCHEMA_VERSION, story_id: storyId, entries: [] };
    throw error;
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw unreadableLedgerError(filePath, `malformed JSON: ${error.message}`);
  }
  if (!Array.isArray(parsed?.entries)) {
    throw unreadableLedgerError(filePath, 'invalid ledger: entries[] is missing or not an array');
  }
  return { schema_version: SCHEMA_VERSION, story_id: storyId, ...parsed, entries: parsed.entries };
}

function unreadableLedgerError(filePath, detail) {
  const error = new Error(`review surface violation ledger ${filePath} is unreadable and is rejected rather than read as empty (${detail}). An unreadable ledger fails closed because clearing it would erase append-only violation records. Restore the file from a copy, or move it aside so a fresh ledger can be started - both review close and review record refuse to append over it until then. An accepted decision record on ${REVIEW_SURFACE_INTEGRITY_GATE_ID}:${REVIEW_SURFACE_LEDGER_UNREADABLE_VIOLATION_ID} clears the pr prepare gate but does not make this append succeed.`);
  error.code = REVIEW_SURFACE_LEDGER_UNREADABLE;
  error.ledger_path = filePath;
  return error;
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
 *
 * The whole read-modify-write is serialised on a story-level lock. Without it,
 * two concurrent closes both read the same entries[] and the second rename drops
 * the first entry — an erasure by race, on the one file that must never lose a
 * record. Deduplicating on violation_id does not help here: it collapses
 * identical facts, it does not serialise distinct ones.
 */
export async function appendReviewSurfaceViolation(storyReviewDir, storyId, violation) {
  await mkdir(storyReviewDir, { recursive: true });
  return withDirectoryLock(path.join(storyReviewDir, LEDGER_LOCK_DIR), async () => {
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
  });
}

const LEDGER_LOCK_DIR = '.surface-violations.lock';
const LOCK_STALE_MS = 30_000;

async function withDirectoryLock(lockDir, callback) {
  const start = Date.now();
  while (true) {
    try {
      await mkdir(lockDir);
      break;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const lockStat = await stat(lockDir).catch((statError) => {
        if (statError.code === 'ENOENT') return null;
        throw statError;
      });
      if (lockStat && Date.now() - lockStat.mtimeMs > LOCK_STALE_MS) {
        await rm(lockDir, { recursive: true, force: true });
        continue;
      }
      if (Date.now() - start > LOCK_STALE_MS) {
        throw new Error(`timed out waiting for the review surface violation ledger lock: ${lockDir}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }
  try {
    return await callback();
  } finally {
    await rm(lockDir, { recursive: true, force: true });
  }
}

/**
 * The ledger is not the only record that a violation happened: review close also
 * stamps surface_violation_id onto the lifecycle entry. Reconciling the two
 * closes the erase path that corruption-rejection alone leaves open — replacing
 * the ledger with a well-formed `{"entries": []}` is not malformed, but it
 * orphans every lifecycle pointer, and an orphaned pointer is reported as a
 * missing-entry violation that fails closed exactly like the record it replaced.
 */
export function reconcileReviewSurfaceViolationPointers(entries = [], lifecycleEntries = []) {
  const known = new Set((Array.isArray(entries) ? entries : []).map((entry) => entry.violation_id));
  const orphans = new Map();
  for (const lifecycle of Array.isArray(lifecycleEntries) ? lifecycleEntries : []) {
    for (const violationId of lifecycleViolationPointers(lifecycle)) {
    if (!violationId || known.has(violationId) || orphans.has(violationId)) continue;
    orphans.set(violationId, {
      // Deliberately NOT the erased entry's own id. Reusing it would let the
      // decision record that acknowledged the original violation also acknowledge
      // its disappearance, so an already-acknowledged violation could be deleted
      // with nothing left blocking. Erasing a record is a separate fact and needs
      // a separate human acknowledgement.
      violation_id: `missing:${violationId}`,
      erased_violation_id: violationId,
      kind: REVIEW_SURFACE_LEDGER_ENTRY_MISSING_KIND,
      evidence_class: 'violation',
      changed_fields: [],
      stage: lifecycle.stage ?? null,
      role: lifecycle.role ?? null,
      lifecycle_id: lifecycle.lifecycle_id ?? null,
      detected_by: 'ledger reconciliation',
      detail: `Lifecycle ${lifecycle.lifecycle_id ?? 'unknown'} records surface_violation_id ${violationId}, but no such entry exists in the ledger. The ledger has been replaced or edited; append-only records cannot disappear.`
    });
    }
  }
  return [...orphans.values()];
}

// One lifecycle can carry more than one violation: an orphaned close records one
// and the record that completes the same entry can record another. Reading only
// the latest pointer would make the earlier erasure invisible.
function lifecycleViolationPointers(lifecycle) {
  const pointers = Array.isArray(lifecycle?.surface_violation_ids) ? lifecycle.surface_violation_ids : [];
  const latest = lifecycle?.surface_violation_id;
  return latest && !pointers.includes(latest) ? [...pointers, latest] : pointers;
}

export const REVIEW_SURFACE_LEDGER_ENTRY_MISSING_KIND = 'review_surface_violation_entry_missing';

/**
 * Acknowledgement never deletes anything. It pairs surviving ledger entries with
 * accepted decision records so a human episode can close the gate while the
 * recorded fact stays in the artifact forever.
 */
export function summarizeReviewSurfaceViolations(entries = [], {
  decisionRecords = null,
  lifecycleEntries = [],
  pointersReadable = true
} = {}) {
  // Lifecycles closed before this detection existed carry no surface_detection.
  // They are not "checked and clean", and the summary must not let them be
  // reported as such.
  const lifecycles = Array.isArray(lifecycleEntries) ? lifecycleEntries : [];
  const closedLifecycles = lifecycles.filter((item) => item?.closed_at || ['closed', 'replaced'].includes(item?.status));
  const unevaluated = closedLifecycles.filter((item) => item?.surface_detection !== 'evaluated');
  const accepted = (decisionRecords?.decisions ?? [])
    .filter((decision) => decision?.status === 'accepted' && typeof decision.source === 'string');
  const reconciled = [
    ...(Array.isArray(entries) ? entries : []),
    ...reconcileReviewSurfaceViolationPointers(entries, lifecycleEntries),
    ...(pointersReadable ? [] : [{
      violation_id: REVIEW_SURFACE_POINTERS_UNREADABLE_VIOLATION_ID,
      kind: 'review_surface_lifecycle_pointers_unreadable',
      evidence_class: 'violation',
      changed_fields: [],
      detected_by: 'ledger reconciliation',
      detail: 'The lifecycle entries carrying surface_violation_id could not be read, so the ledger cross-check did not run. In this state a ledger rewrite would not be detected, which is why it blocks rather than reading the missing pointers as agreement.'
    }])
  ];
  const items = reconciled.map((entry) => {
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
    readable: true,
    evaluated_lifecycle_count: closedLifecycles.length - unevaluated.length,
    unevaluated_lifecycle_count: unevaluated.length,
    total_count: items.length,
    acknowledged_count: items.length - unacknowledged.length,
    unacknowledged_count: unacknowledged.length,
    entries: items,
    unacknowledged
  };
}

/**
 * The blocking summary for a ledger that could not be read. It reports the
 * unreadable state as a violation entry so the gate fails closed: an unreadable
 * ledger cannot be distinguished from an erased one, and both must stop the PR.
 *
 * It runs through the same acknowledgement path as any other violation. There is
 * no self-service repair — .vibepro artifacts are not tracked in git, so
 * "restore the file" is not a recovery for most repositories — and a block with
 * no exit is not a gate, it is a dead end.
 */
export function buildUnreadableReviewSurfaceViolationSummary(error, { decisionRecords = null } = {}) {
  const summary = summarizeReviewSurfaceViolations([{
    violation_id: REVIEW_SURFACE_LEDGER_UNREADABLE_VIOLATION_ID,
    kind: 'review_surface_ledger_unreadable',
    evidence_class: 'violation',
    changed_fields: [],
    detected_by: 'ledger read',
    detail: error?.message ?? 'review surface violation ledger could not be read'
  }], { decisionRecords });
  return {
    ...summary,
    readable: false,
    unreadable_reason: error?.message ?? 'review surface violation ledger could not be read'
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
