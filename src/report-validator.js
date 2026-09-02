import { stat } from 'node:fs/promises';
import path from 'node:path';

import { readDrift, readInferredSpec } from './spec-store.js';

const SLOT_KINDS = new Set(['summary', 'review_focus', 'risks_synthesis', 'open_questions']);
const SLOT_LIMITS = {
  summary: { min: 1, max: 1 },
  review_focus: { min: 0, max: 5 },
  risks_synthesis: { min: 1, max: 1 },
  open_questions: { min: 0, max: 5 }
};
const NUMERICAL_FIELDS = new Set([
  'changed_files_count',
  'drift_high_count',
  'drift_total_count',
  'requirement_invariant_count',
  'requirement_contradiction_count',
  'acceptance_criteria_count'
]);

export async function validateReportNarrative(repoRoot, narrative, fingerprint, options = {}) {
  const errors = [];
  const warnings = [];

  if (!narrative || typeof narrative !== 'object') {
    return { ok: false, errors: [{ code: 'invalid_root', message: 'narrative must be a JSON object' }], warnings };
  }
  if (narrative.schema_version !== '0.1.0') {
    errors.push({ code: 'schema_version', message: `expected schema_version "0.1.0", got "${narrative.schema_version}"` });
  }
  if (narrative.kind !== 'pr-body') {
    errors.push({ code: 'kind', message: `narrative.kind must be "pr-body"` });
  }
  if (!narrative.story_id || typeof narrative.story_id !== 'string') {
    errors.push({ code: 'story_id', message: 'story_id is required' });
  }
  if (options.expectedStoryId && narrative.story_id !== options.expectedStoryId) {
    errors.push({
      code: 'story_id_mismatch',
      message: `narrative.story_id "${narrative.story_id}" does not match expected "${options.expectedStoryId}"`
    });
  }
  const caller = narrative.generated_by?.caller;
  if (caller !== undefined
    && (typeof caller !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._/-]{0,63}$/.test(caller))) {
    errors.push({
      code: 'generated_by_caller',
      message: 'generated_by.caller must be a single safe identifier of 1-64 characters'
    });
  }
  if (!Array.isArray(narrative.narrative_slots)) {
    errors.push({ code: 'slots_missing', message: 'narrative_slots must be an array' });
    return { ok: false, errors, warnings, narrative };
  }

  const slotCounts = countSlots(narrative.narrative_slots);
  for (const [slot, { min, max }] of Object.entries(SLOT_LIMITS)) {
    const count = slotCounts.get(slot) ?? 0;
    if (count < min) {
      errors.push({ code: 'slot_min', message: `slot "${slot}" requires at least ${min} entry, got ${count}` });
    }
    if (count > max) {
      errors.push({ code: 'slot_max', message: `slot "${slot}" allows at most ${max} entries, got ${count}` });
    }
  }

  const driftItems = fingerprint?.drift?.items ?? [];
  const driftIds = new Set(driftItems.map((item) => item.id));
  const findingIds = new Set((fingerprint?.findings ?? []).map((entry) => entry.id));
  const clauseIds = new Set((fingerprint?.inferred_spec?.clauses ?? []).map((entry) => entry.id));
  const numericalTruth = fingerprint?.numerical_truth ?? {};
  const seenSlotIds = new Set();

  for (let index = 0; index < narrative.narrative_slots.length; index += 1) {
    const slot = narrative.narrative_slots[index];
    if (typeof slot?.id === 'string') {
      if (seenSlotIds.has(slot.id)) {
        errors.push({
          code: 'slot_id_duplicate',
          message: `narrative_slots[${index}] (${slot.id}).id must be unique`
        });
      }
      seenSlotIds.add(slot.id);
    }
    const slotErrors = await validateSlot(repoRoot, slot, index, {
      driftIds,
      findingIds,
      clauseIds,
      numericalTruth,
      allowTemporaryIds: options.allowTemporaryIds === true
    });
    errors.push(...slotErrors);
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    narrative
  };
}

function countSlots(slots) {
  const counts = new Map();
  for (const slot of slots) {
    if (!slot || typeof slot !== 'object') continue;
    counts.set(slot.slot, (counts.get(slot.slot) ?? 0) + 1);
  }
  return counts;
}

async function validateSlot(repoRoot, slot, index, ctx) {
  const errors = [];
  const locator = slot?.id ? `narrative_slots[${index}] (${slot.id})` : `narrative_slots[${index}]`;
  if (!slot || typeof slot !== 'object') {
    errors.push({ code: 'slot_shape', message: `${locator} must be an object` });
    return errors;
  }
  const slotIdPattern = ctx.allowTemporaryIds
    ? /^TP-(?:NEW-[1-9][0-9]*|[0-9]{3,})$/
    : /^TP-[0-9]{3,}$/;
  if (typeof slot.id !== 'string' || !slotIdPattern.test(slot.id)) {
    errors.push({
      code: 'slot_id',
      message: ctx.allowTemporaryIds
        ? `${locator}.id must be TP-<3 or more digits> or TP-NEW-<positive integer>`
        : `${locator}.id must be a canonical TP-<3 or more digits> identifier`
    });
  }
  if (!SLOT_KINDS.has(slot.slot)) {
    errors.push({
      code: 'slot_kind',
      message: `${locator}.slot must be one of ${[...SLOT_KINDS].join('|')}`
    });
  }
  if (typeof slot.text !== 'string' || slot.text.trim().length < 4) {
    errors.push({ code: 'slot_text', message: `${locator}.text must be a non-empty string` });
  } else {
    const rawText = slot.text;
    const text = slot.text.trim();
    if (rawText.length > 280) {
      errors.push({ code: 'slot_text_length', message: `${locator}.text must be 280 characters or fewer` });
    }
    if (/\r|\n/.test(rawText)
      || /^\s*(?:(?:[-*_]\s*){3,}$|#{1,6}\s|[-+*]\s|>\s|\d+\.\s|```|~~~|<)/.test(text)
      || /<[^>]+>|\*\*|__|~~|\*[^*\r\n]+\*|(?:^|[^A-Za-z0-9])_[^_\r\n]+_(?:$|[^A-Za-z0-9])|`|\[[^\]]+\]\([^)]*\)|!?\[[^\]\r\n]+\]\[[^\]\r\n]*\]|\[\^[^\]\r\n]+\]/.test(text)) {
      errors.push({
        code: 'slot_text_structure',
        message: `${locator}.text must be single-line prose without markdown structure`
      });
    }
  }

  const citations = slot.citations === undefined ? {} : slot.citations;
  if (!citations || typeof citations !== 'object' || Array.isArray(citations)) {
    errors.push({ code: 'citations_shape', message: `${locator}.citations must be an object` });
    return errors;
  }
  const citationFields = ['files', 'finding_ids', 'clause_ids', 'drift_ids'];
  for (const field of citationFields) {
    if (citations[field] !== undefined && !Array.isArray(citations[field])) {
      errors.push({ code: 'citations_shape', message: `${locator}.citations.${field} must be an array` });
    }
  }
  for (const file of Array.isArray(citations.files) ? citations.files : []) {
    const fileResult = await fileExists(repoRoot, file);
    if (!fileResult) {
      errors.push({
        code: 'citation_file_missing',
        message: `${locator}.citations.files: "${file}" not found in repository`
      });
    }
  }
  for (const id of Array.isArray(citations.finding_ids) ? citations.finding_ids : []) {
    if (!ctx.findingIds.has(id)) {
      errors.push({
        code: 'citation_finding_missing',
        message: `${locator}.citations.finding_ids: "${id}" not found in evidence.findings`
      });
    }
  }
  for (const id of Array.isArray(citations.clause_ids) ? citations.clause_ids : []) {
    if (!ctx.clauseIds.has(id)) {
      errors.push({
        code: 'citation_clause_missing',
        message: `${locator}.citations.clause_ids: "${id}" not found in inferred spec clauses`
      });
    }
  }
  for (const id of Array.isArray(citations.drift_ids) ? citations.drift_ids : []) {
    if (!ctx.driftIds.has(id)) {
      errors.push({
        code: 'citation_drift_missing',
        message: `${locator}.citations.drift_ids: "${id}" not found in drift.items`
      });
    }
  }

  if (slot.numerical_claims !== undefined && !Array.isArray(slot.numerical_claims)) {
    errors.push({ code: 'numerical_claims_shape', message: `${locator}.numerical_claims must be an array` });
  }
  for (const claim of Array.isArray(slot.numerical_claims) ? slot.numerical_claims : []) {
    if (!claim || !NUMERICAL_FIELDS.has(claim.field)) {
      errors.push({
        code: 'numerical_field',
        message: `${locator}.numerical_claims: field must be one of ${[...NUMERICAL_FIELDS].join('|')}`
      });
      continue;
    }
    const truth = ctx.numericalTruth[claim.field];
    if (truth === undefined) {
      errors.push({
        code: 'numerical_truth_missing',
        message: `${locator}.numerical_claims: fingerprint lacks "${claim.field}" — cannot verify`
      });
      continue;
    }
    if (typeof claim.value !== 'number' || claim.value !== truth) {
      errors.push({
        code: 'numerical_contradiction',
        message: `${locator}.numerical_claims: ${claim.field}=${claim.value} contradicts fingerprint=${truth}`
      });
    }
  }

  return errors;
}

async function fileExists(repoRoot, relativeFile) {
  try {
    const stats = await stat(path.join(repoRoot, relativeFile));
    return stats.isFile();
  } catch {
    return false;
  }
}

// Cross-check that fingerprint slot existence matches expectation when AI is rerun
// without changes. Used in tests / drift detection later.
export async function reconcileWithRunArtifacts(repoRoot, narrative, storyId) {
  const drift = await readDrift(repoRoot, storyId);
  const spec = await readInferredSpec(repoRoot, storyId);
  return {
    drift_present: Boolean(drift),
    spec_present: Boolean(spec),
    narrative_slots: narrative?.narrative_slots?.length ?? 0
  };
}
