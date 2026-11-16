import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { getWorkspaceDir } from './workspace.js';

// Per-journey configuration lives in .vibepro/config.json under
// journey.journeys.<journey_id>:
//   scope.story_tags / scope.story_id_prefixes / scope.story_ids
//   walking_skeleton.required_step_ids
// Every field is optional. Without configuration derive keeps its default
// behavior (all non-archived Stories, inferred discover/signup/first-value).

export async function readJourneyConfig(root, journeyId) {
  let config;
  try {
    config = JSON.parse(await readFile(path.join(getWorkspaceDir(root), 'config.json'), 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return {};
    throw error;
  }
  const entry = config.journey?.journeys?.[journeyId];
  return entry && typeof entry === 'object' ? entry : {};
}

export function parseTagList(value) {
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean);
  if (value === null || value === undefined) return [];
  return String(value)
    .replace(/^\[|\]$/g, '')
    .split(',')
    .map((item) => item.trim().replace(/^["']|["']$/g, ''))
    .filter(Boolean);
}

export function normalizeJourneyScope(scope) {
  if (!scope || typeof scope !== 'object') return null;
  const normalized = {
    story_tags: parseTagList(scope.story_tags ?? scope.tags).sort(),
    story_id_prefixes: parseTagList(scope.story_id_prefixes ?? scope.id_prefixes).sort(),
    story_ids: parseTagList(scope.story_ids).sort()
  };
  const empty = Object.values(normalized).every((list) => list.length === 0);
  return empty ? null : normalized;
}

export function storyMatchesScope(story, scope) {
  if (!scope) return true;
  const tags = new Set(parseTagList(story.tags));
  if (scope.story_ids.includes(story.story_id)) return true;
  if (scope.story_id_prefixes.some((prefix) => story.story_id.startsWith(prefix))) return true;
  return scope.story_tags.some((tag) => tags.has(tag));
}

export function filterStoriesByScope(stories, scope) {
  return scope ? stories.filter((story) => storyMatchesScope(story, scope)) : stories;
}

export function sameJourneyScope(a, b) {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

export function resolveConfiguredRequiredSteps(journeyConfig) {
  const ids = journeyConfig?.walking_skeleton?.required_step_ids;
  if (!Array.isArray(ids)) return null;
  const normalized = [...new Set(ids.map((id) => String(id).trim()).filter(Boolean))];
  return normalized.length > 0 ? normalized : null;
}

// Curate input additions. Steps may be added without any Story; they are
// recorded as human-curated structure (source: 'curation') and never invent
// Story coverage. Added open questions stay unresolved unless they carry a
// status, so they surface in the curated handoff instead of being closed.
export function normalizeAddedSteps(value) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new Error('journey curate add_steps must be an array');
  return value.map((item, index) => {
    const stepId = String(item?.step_id ?? '').trim();
    const activityId = String(item?.activity_id ?? '').trim();
    if (!stepId) throw new Error(`journey curate add_steps[${index}] requires step_id`);
    if (!activityId) throw new Error(`journey curate add_steps[${index}] requires activity_id`);
    return {
      step_id: stepId,
      activity_id: activityId,
      label: item.label === undefined || item.label === null || String(item.label).trim() === '' ? null : String(item.label),
      story_ids: parseTagList(item.story_ids),
      after_step_id: item.after_step_id ? String(item.after_step_id) : null,
      walking_skeleton_required: item.walking_skeleton_required === true,
      reason: item.reason ? String(item.reason) : null
    };
  });
}

export function normalizeAddedOpenQuestions(value) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new Error('journey curate add_open_questions must be an array');
  const seen = new Set();
  return value.map((item, index) => {
    const id = String(item?.id ?? '').trim();
    const question = String(item?.question ?? '').trim();
    if (!id) throw new Error(`journey curate add_open_questions[${index}] requires id`);
    if (!question) throw new Error(`journey curate add_open_questions[${index}] requires question`);
    if (seen.has(id)) throw new Error(`journey curate add_open_questions[${index}] duplicates id within add_open_questions: ${id}`);
    seen.add(id);
    return {
      id,
      kind: item.kind ? String(item.kind) : 'curated_question',
      question,
      blocker: item.blocker === true,
      step_id: item.step_id ? String(item.step_id) : null,
      source: 'curation',
      curation: item.status ? { status: String(item.status).toLowerCase(), reason: item.reason ?? null } : null
    };
  });
}

// Validate curate additions against the derived context pack before anything
// is written. Every check throws, so curate stops without writing an artifact.
// - add_steps[].story_ids must be in source_story_ids (in-scope, existing
//   Stories); otherwise an unknown or out-of-scope id could mark a
//   walking-skeleton step as covered.
// - a step_id may live in only one activity (existing backbone + additions).
// - after_step_id must name a step already in the same activity, or one added
//   earlier in add_steps to that activity.
// - configured walking_skeleton.required_step_ids must exist in the curated
//   backbone (add them with add_steps when no Story places them yet).
export function validateCurateAdditions(contextPack, addedSteps, { configuredRequiredStepIds = null } = {}) {
  const sourceStoryIds = new Set(contextPack.source_story_ids ?? []);
  const stepActivity = new Map();
  for (const activity of contextPack.backbone ?? []) {
    for (const step of activity.steps ?? []) stepActivity.set(step.step_id, activity.activity_id);
  }
  addedSteps.forEach((added, index) => {
    const outOfScope = added.story_ids.filter((id) => !sourceStoryIds.has(id));
    if (outOfScope.length > 0) {
      throw new Error(`journey curate add_steps[${index}] (${added.step_id}) story_ids are not in this journey's source_story_ids (unknown or out of scope): ${outOfScope.join(', ')}`);
    }
    const knownActivity = stepActivity.get(added.step_id);
    if (knownActivity && knownActivity !== added.activity_id) {
      throw new Error(`journey curate add_steps[${index}] step_id ${added.step_id} already belongs to activity ${knownActivity}; a step_id can appear in only one activity`);
    }
    if (added.after_step_id) {
      const afterActivity = stepActivity.get(added.after_step_id);
      if (!afterActivity) throw new Error(`journey curate add_steps[${index}] after_step_id is unknown: ${added.after_step_id}`);
      if (afterActivity !== added.activity_id) {
        throw new Error(`journey curate add_steps[${index}] after_step_id ${added.after_step_id} is in activity ${afterActivity}, not ${added.activity_id}`);
      }
    }
    stepActivity.set(added.step_id, added.activity_id);
  });
  const unknownRequired = (configuredRequiredStepIds ?? []).filter((id) => !stepActivity.has(id));
  if (unknownRequired.length > 0) {
    throw new Error(`journey walking_skeleton.required_step_ids are not steps in the curated backbone: ${unknownRequired.join(', ')}. Add them with add_steps or fix .vibepro/config.json.`);
  }
}

export function applyAddedSteps(backbone, addedSteps, { activityLabel } = {}) {
  if (addedSteps.length === 0) return backbone;
  const activities = backbone.map((activity) => ({ ...activity, steps: activity.steps.map((step) => ({ ...step })) }));
  for (const added of addedSteps) {
    let activity = activities.find((item) => item.activity_id === added.activity_id);
    if (!activity) {
      activity = { activity_id: added.activity_id, label: activityLabel?.(added.activity_id) ?? added.activity_id, order: activities.length, steps: [] };
      activities.push(activity);
    }
    const existing = activity.steps.find((step) => step.step_id === added.step_id);
    if (existing) {
      existing.label = added.label ?? existing.label;
      existing.story_ids = [...new Set([...(existing.story_ids ?? []), ...added.story_ids])];
      existing.curation = { source: 'curation', reason: added.reason };
      continue;
    }
    const step = {
      step_id: added.step_id,
      label: added.label ?? added.step_id,
      order: 0,
      story_ids: added.story_ids,
      story_labels: {},
      enabler_story_ids: [],
      enabler_story_labels: {},
      evidence: [],
      confidence: 'curated',
      curation: { source: 'curation', reason: added.reason }
    };
    const afterIndex = added.after_step_id ? activity.steps.findIndex((item) => item.step_id === added.after_step_id) : -1;
    if (afterIndex >= 0) activity.steps.splice(afterIndex + 1, 0, step);
    else activity.steps.push(step);
  }
  return activities.map((activity) => ({
    ...activity,
    steps: activity.steps.map((step, index) => ({ ...step, order: index }))
  }));
}

export function recomputeWalkingSkeleton(backbone, requiredStepIds, labelFor = (id) => id) {
  if (requiredStepIds.length === 0) {
    return { status: 'not_applicable', required_step_ids: [], covered_step_ids: [], gaps: [], story_ids: [] };
  }
  const steps = backbone.flatMap((activity) => activity.steps);
  const covered = steps.filter((step) => requiredStepIds.includes(step.step_id) && (step.story_ids ?? []).length > 0);
  const coveredIds = covered.map((step) => step.step_id);
  const gaps = requiredStepIds
    .filter((id) => !coveredIds.includes(id))
    .map((id) => ({ step_id: id, label: steps.find((step) => step.step_id === id)?.label ?? labelFor(id) }));
  return {
    status: gaps.length > 0 ? 'needs_evidence' : 'covered',
    required_step_ids: requiredStepIds,
    covered_step_ids: coveredIds,
    gaps,
    story_ids: [...new Set(covered.flatMap((step) => step.story_ids))]
  };
}
