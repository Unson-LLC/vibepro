import { createHash } from 'node:crypto';

import { extractMarkdownAcceptanceCriteria } from './markdown-acceptance-criteria.js';
import { TASK_PLAN_SCHEMA_VERSION, validateTaskPlan } from './task-plan.js';

const MARKDOWN_HEADING = /^#{1,6}\s+/;
const SECTION_HEADING = /^##\s+(.+?)\s*$/;
const BULLET = /^\s*-\s*(?:\[[ xX]\]\s*)?(.+?)\s*$/;
const H1 = /^#\s+(.+?)\s*$/;
const FORBIDDEN_BODY_SECTIONS = new Set(['completion_contract', 'description', 'body', 'criteria']);
const DELEGATED_SCOPE_HEADINGS = new Set(['委任範囲', 'delegated_scope']);
const OVERLAP_REF_LINE = /^\s*-\s*([^:]+):\s*(.+)\s*$/;

export function decomposeStoryToTaskPlan(storyText, { repository = null } = {}) {
  const content = String(storyText ?? '');
  assertNoForbiddenBodySections(content);

  const { frontmatter, body } = parseStoryFrontmatter(content);
  const missing = collectMissingRequiredFields({
    frontmatter,
    body,
    repository,
    content
  });
  if (missing.length > 0) {
    throw new Error(`missing required story input: ${missing.join(', ')}`);
  }

  const storyId = frontmatter.story_id.trim();
  const resolvedRepository = (repository ?? frontmatter.owner_repository).trim();
  const purpose = extractH1(body);
  const priority = frontmatter.priority.trim();
  const conflictOwner = frontmatter.conflict_owner.trim();
  const acceptanceCriteria = extractMarkdownAcceptanceCriteria(content);
  const allowedPaths = extractSectionBullets(body, ['allowed_paths']);
  const delegatedScope = extractSectionBullets(body, [...DELEGATED_SCOPE_HEADINGS]);
  const overlapRefs = parseOverlapRefsSection(body);

  const intentCriteria = acceptanceCriteria.map((item) => item.text);
  const tasks = acceptanceCriteria.map((criterion) => ({
    task_id: criterion.id,
    story_id: storyId,
    allowed_paths: allowedPaths,
    acceptance_criteria: [criterion.text],
    depends_on: [],
    purpose: criterion.text,
    out_of_scope: [],
    dependencies: [],
    contracts: [],
    assignment: {
      capabilities: [],
      parallel_group: null,
      adjustable_scope: []
    },
    integration: {
      order: 1,
      conflict_owner: conflictOwner
    }
  }));

  const draft = {
    schema_version: TASK_PLAN_SCHEMA_VERSION,
    repository: resolvedRepository,
    story_id: storyId,
    plan_version: 'plan-pending',
    intent: {
      purpose,
      priority,
      delegated_scope: delegatedScope,
      acceptance_criteria: intentCriteria
    },
    tasks,
    ...(overlapRefs == null ? {} : { overlap_refs: overlapRefs })
  };

  const normalized = validateTaskPlan(draft, {
    storyId,
    repository: resolvedRepository
  });
  const planVersion = computePlanVersion(normalized);
  return validateTaskPlan({ ...normalized, plan_version: planVersion }, {
    storyId,
    repository: resolvedRepository
  });
}

function assertNoForbiddenBodySections(content) {
  for (const line of content.split(/\r?\n/)) {
    const match = line.match(SECTION_HEADING);
    if (!match) continue;
    const heading = match[1].trim();
    if (FORBIDDEN_BODY_SECTIONS.has(heading)) {
      throw new Error(`story contains forbidden body field section: ${heading}`);
    }
  }
}

function collectMissingRequiredFields({ frontmatter, body, repository, content }) {
  const missing = [];
  if (!nonemptyScalar(frontmatter.story_id)) missing.push('story_id');
  if (!nonemptyScalar(repository) && !nonemptyScalar(frontmatter.owner_repository)) missing.push('repository');
  if (!extractH1(body)) missing.push('H1');
  if (!nonemptyScalar(frontmatter.priority)) missing.push('priority');
  if (extractMarkdownAcceptanceCriteria(content).length === 0) missing.push('acceptance_criteria');
  if (extractSectionBullets(body, ['allowed_paths']).length === 0) missing.push('allowed_paths');
  if (extractSectionBullets(body, [...DELEGATED_SCOPE_HEADINGS]).length === 0) missing.push('delegated_scope');
  if (!nonemptyScalar(frontmatter.conflict_owner)) missing.push('conflict_owner');
  return missing;
}

function nonemptyScalar(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function parseStoryFrontmatter(content) {
  const match = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n?/);
  if (!match) return { frontmatter: {}, body: content };
  const frontmatter = {};
  for (const line of match[1].split(/\r?\n/)) {
    const item = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!item) continue;
    frontmatter[item[1]] = item[2].replace(/^['"]|['"]$/g, '').trim();
  }
  return { frontmatter, body: content.slice(match[0].length) };
}

function extractH1(body) {
  for (const line of body.split(/\r?\n/)) {
    const match = line.match(H1);
    if (match) return match[1].trim();
  }
  return null;
}

function extractSectionBullets(body, headings) {
  const wanted = new Set(headings.map((heading) => heading.toLowerCase()));
  const lines = body.split(/\r?\n/);
  const bullets = [];
  let inSection = false;
  for (const line of lines) {
    const sectionMatch = line.match(SECTION_HEADING);
    if (sectionMatch) {
      inSection = wanted.has(sectionMatch[1].trim().toLowerCase());
      continue;
    }
    if (!inSection) continue;
    if (MARKDOWN_HEADING.test(line.trim())) break;
    const bulletMatch = line.match(BULLET);
    if (!bulletMatch) continue;
    const text = bulletMatch[1].trim();
    if (text) bullets.push(text);
  }
  return bullets;
}

function parseOverlapRefsSection(body) {
  const lines = body.split(/\r?\n/);
  let inSection = false;
  const entries = [];
  for (const line of lines) {
    const sectionMatch = line.match(SECTION_HEADING);
    if (sectionMatch) {
      inSection = sectionMatch[1].trim().toLowerCase() === 'overlap_refs';
      continue;
    }
    if (!inSection) continue;
    if (MARKDOWN_HEADING.test(line.trim())) break;
    const match = line.match(OVERLAP_REF_LINE);
    if (!match) continue;
    const completionContractRef = match[1].trim();
    const rawTaskIds = match[2].split(',').map((item) => item.trim()).filter(Boolean);
    entries.push({
      completion_contract_ref: completionContractRef,
      task_ids: rawTaskIds
    });
  }
  if (entries.length === 0) return undefined;
  return entries;
}

function computePlanVersion(normalizedPlan) {
  const { plan_version: _ignored, ...withoutVersion } = normalizedPlan;
  const digest = createHash('sha256').update(stableStringify(withoutVersion)).digest('hex');
  return `plan-${digest.slice(0, 12)}`;
}

function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
}
