import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { resolveGateArtifactFile, resolveGraphifyArtifactFile, resolvePrArtifactFile } from './artifact-routing.js';
import { getWorkspaceDir, initWorkspace, readManifest, toWorkspaceRelative, writeManifest } from './workspace.js';

const JOURNEY_SCHEMA_VERSION = '0.1.0';
const DEFAULT_JOURNEY_ID = 'default-product-journey';
const JOURNEY_CONTEXT_ARTIFACT_KIND = 'journey_context_pack';
const CURATED_JOURNEY_ARTIFACT_KIND = 'curated_journey';
const STORY_DIRS = [
  path.join('docs', 'management', 'stories', 'active'),
  path.join('docs', 'user_stories', 'active'),
  path.join('docs', 'stories')
];

const ACTIVITY_ORDER = [
  'acquisition',
  'activation',
  'core_usage',
  'monetization',
  'retention',
  'operations',
  'risk_control',
  'quality_gate',
  'architecture',
  'knowledge_recovery'
];

const ACTIVITY_LABELS = {
  acquisition: '価値を知る',
  activation: '利用開始する',
  core_usage: '主要価値を得る',
  monetization: '支払い・契約する',
  retention: '継続利用する',
  operations: '運用する',
  risk_control: '信頼境界を守る',
  quality_gate: '品質を保つ',
  architecture: '構造を整える',
  knowledge_recovery: '正本を復元する'
};

const RELEASE_SLICE_ORDER = ['walking_skeleton', 'next_slice', 'hardening', 'custom'];

export async function deriveJourneyMap(repoRoot, options = {}) {
  const root = path.resolve(repoRoot);
  await initWorkspace(root);
  const manifest = await readManifest(root);
  const journeyId = options.journeyId ?? DEFAULT_JOURNEY_ID;
  const storyInputs = await readJourneyStoryInputs(root);
  const sourceStories = storyInputs.filter((story) => story.status !== 'archived');
  const placements = sourceStories.map((story) => placeStory(story));
  const backbone = buildBackbone(placements);
  const releaseSlices = buildReleaseSlices(placements, backbone);
  const walkingSkeleton = buildWalkingSkeleton(backbone, releaseSlices);
  const conflicts = buildJourneyConflicts(placements);
  const unplacedStories = placements
    .filter((placement) => placement.placement_status !== 'placed')
    .map((placement) => ({
      story_id: placement.story_id,
      title: placement.title,
      reason: placement.placement_reason,
      confidence: placement.confidence
    }));
  const openQuestions = [
    ...walkingSkeleton.gaps.map((gap) => ({
      id: `gap:${gap.step_id}`,
      kind: 'walking_skeleton_gap',
      question: `Walking skeleton に必要な ${gap.label} step をどの Story が満たすか確認する。`,
      blocker: true,
      step_id: gap.step_id
    })),
    ...unplacedStories.map((story) => ({
      id: `unplaced:${story.story_id}`,
      kind: 'unplaced_story',
      question: `${story.story_id} をJourney stepへ配置するか、補助Storyまたは横断関心として扱うか確認する。`,
      blocker: false,
      story_id: story.story_id
    }))
  ];
  const generatedAt = new Date().toISOString();
  const journey = {
    schema_version: JOURNEY_SCHEMA_VERSION,
    journey_id: journeyId,
    artifact_kind: JOURNEY_CONTEXT_ARTIFACT_KIND,
    machine_derived: true,
    authoritative: false,
    curation_status: 'needs_curated_journey',
    generated_at: generatedAt,
    source_story_ids: sourceStories.map((story) => story.story_id),
    source_digest: buildSourceDigest(sourceStories),
    source: {
      story_count: sourceStories.length,
      story_catalog_available: storyInputs.some((story) => story.source_types.includes('story_catalog')),
      input_paths: sourceStories.flatMap((story) => story.source_paths).filter(Boolean).sort()
    },
    backbone,
    release_slices: releaseSlices,
    walking_skeleton: walkingSkeleton,
    unplaced_stories: unplacedStories,
    conflicts,
    open_questions: openQuestions
  };
  journey.handoff = buildJourneyHandoff(journey);

  const journeyDir = path.join(getWorkspaceDir(root), 'journey');
  const historyDir = path.join(journeyDir, 'history');
  await mkdir(historyDir, { recursive: true });
  const latestJsonPath = path.join(journeyDir, 'latest-journey.json');
  const latestMarkdownPath = path.join(journeyDir, 'latest-journey.md');
  const latestHandoffPath = path.join(journeyDir, 'latest-handoff.md');
  const historyJsonPath = path.join(historyDir, `${generatedAt.replace(/\.\d{3}Z$/, 'Z').replace(/:/g, '')}.json`);
  const markdown = renderJourneyMapMarkdown(journey);
  const handoffMarkdown = renderJourneyHandoffMarkdown(journey);
  await writeFile(latestJsonPath, `${JSON.stringify(journey, null, 2)}\n`);
  await writeFile(latestMarkdownPath, markdown);
  await writeFile(latestHandoffPath, handoffMarkdown);
  await writeFile(historyJsonPath, `${JSON.stringify(journey, null, 2)}\n`);

  manifest.artifacts = {
    ...(manifest.artifacts ?? {}),
    latest_journey: toWorkspaceRelative(root, latestJsonPath),
    latest_journey_markdown: toWorkspaceRelative(root, latestMarkdownPath),
    latest_journey_handoff: toWorkspaceRelative(root, latestHandoffPath)
  };
  manifest.journey = {
    schema_version: JOURNEY_SCHEMA_VERSION,
    artifact_kind: JOURNEY_CONTEXT_ARTIFACT_KIND,
    curation_status: 'needs_curated_journey',
    latest_journey: toWorkspaceRelative(root, latestJsonPath),
    latest_journey_markdown: toWorkspaceRelative(root, latestMarkdownPath),
    latest_handoff: toWorkspaceRelative(root, latestHandoffPath),
    latest_history: toWorkspaceRelative(root, historyJsonPath),
    generated_at: generatedAt,
    source_story_count: sourceStories.length,
    walking_skeleton_status: walkingSkeleton.status,
    conflict_count: conflicts.length,
    open_question_count: openQuestions.length
  };
  await writeManifest(root, manifest);

  return {
    journey,
    artifacts: {
      json: latestJsonPath,
      markdown: latestMarkdownPath,
      handoff_markdown: latestHandoffPath,
      history_json: historyJsonPath
    }
  };
}

export async function readLatestJourneyMap(repoRoot) {
  const journeyPath = path.join(getWorkspaceDir(repoRoot), 'journey', 'latest-journey.json');
  try {
    return JSON.parse(await readFile(journeyPath, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

export async function readCuratedJourneyMap(repoRoot, journeyId = DEFAULT_JOURNEY_ID) {
  const root = path.resolve(repoRoot);
  const manifest = await readManifest(root);
  const manifestCuratedPath = manifest.journey?.curated_journey
    ? path.resolve(root, manifest.journey.curated_journey)
    : null;
  const candidates = [
    manifestCuratedPath,
    path.join(getWorkspaceDir(root), 'journeys', `${journeyId}.json`),
    path.join(getWorkspaceDir(root), 'journey', 'curated-journey.json')
  ].filter(Boolean);
  const seen = new Set();
  for (const candidate of candidates) {
    if (seen.has(candidate)) continue;
    seen.add(candidate);
    try {
      const parsed = JSON.parse(await readFile(candidate, 'utf8'));
      if (parsed.journey_id && parsed.journey_id !== journeyId) continue;
      return {
        ...parsed,
        schema_version: parsed.schema_version ?? JOURNEY_SCHEMA_VERSION,
        journey_id: parsed.journey_id ?? journeyId,
        artifact_kind: parsed.artifact_kind ?? CURATED_JOURNEY_ARTIFACT_KIND,
        machine_derived: parsed.machine_derived ?? false,
        authoritative: parsed.authoritative ?? true,
        curation_status: parsed.curation_status ?? 'curated',
        curated_journey_path: toWorkspaceRelative(root, candidate)
      };
    } catch (error) {
      if (error.code === 'ENOENT') continue;
      throw error;
    }
  }
  return null;
}

export async function curateJourneyMap(repoRoot, options = {}) {
  const root = path.resolve(repoRoot);
  await initWorkspace(root);
  const contextPack = await readLatestJourneyMap(root);
  const journeyId = options.journeyId ?? contextPack?.journey_id ?? DEFAULT_JOURNEY_ID;
  if (!contextPack) {
    throw new Error(`Journey context pack is missing. Run \`vibepro journey derive . --id ${journeyId}\` before \`vibepro journey curate .\`.`);
  }
  if (!options.inputPath) {
    throw new Error('journey curate requires --input <judgments.json|yaml>');
  }
  const inputAbsolutePath = path.resolve(root, options.inputPath);
  const judgments = parseJudgmentInput(await readFile(inputAbsolutePath, 'utf8'), inputAbsolutePath);
  const conflictDecisions = normalizeJudgments(judgments.conflicts ?? judgments.conflict_resolutions);
  const questionDecisions = normalizeJudgments(judgments.open_questions ?? judgments.open_question_resolutions ?? judgments.questions);
  const missing = collectUnhandledJourneyItems(contextPack, { conflictDecisions, questionDecisions });
  if (missing.length > 0) {
    throw new Error([
      'Unhandled Journey curation items:',
      ...missing.map((item) => `- ${item}`),
      'Revise --input and rerun `vibepro journey curate . --input <file>`.'
    ].join('\n'));
  }

  const curatedAt = new Date().toISOString();
  const curated = {
    ...contextPack,
    artifact_kind: CURATED_JOURNEY_ARTIFACT_KIND,
    machine_derived: false,
    authoritative: true,
    curation_status: 'curated',
    curated_at: curatedAt,
    curation: {
      input_path: toWorkspaceRelative(root, inputAbsolutePath),
      next_slice: judgments.next_slice ?? judgments.nextSlice ?? null,
      notes: judgments.notes ?? null,
      conflicts: Object.fromEntries(conflictDecisions),
      open_questions: Object.fromEntries(questionDecisions)
    },
    conflicts: (contextPack.conflicts ?? []).map((conflict) => ({
      ...conflict,
      curation: conflictDecisions.get(conflict.id) ?? null
    })),
    open_questions: (contextPack.open_questions ?? []).map((question) => {
      const curation = questionDecisions.get(question.id) ?? null;
      return {
        ...question,
        blocker: curation?.status ? false : question.blocker === true,
        curation
      };
    })
  };
  curated.handoff = buildJourneyHandoff(curated);

  const curatedDir = path.join(getWorkspaceDir(root), 'journeys');
  await mkdir(curatedDir, { recursive: true });
  const curatedPath = options.outputPath
    ? path.resolve(root, options.outputPath)
    : path.join(curatedDir, `${journeyId}.json`);
  await mkdir(path.dirname(curatedPath), { recursive: true });
  await writeFile(curatedPath, `${JSON.stringify(curated, null, 2)}\n`);

  const manifest = await readManifest(root);
  manifest.journey = {
    ...(manifest.journey ?? {}),
    artifact_kind: CURATED_JOURNEY_ARTIFACT_KIND,
    curation_status: 'curated',
    curated_journey: toWorkspaceRelative(root, curatedPath),
    curated_at: curatedAt,
    unresolved_conflict_count: countUnresolvedJourneyConflicts(curated),
    unresolved_open_question_count: countUnresolvedJourneyOpenQuestions(curated)
  };
  await writeManifest(root, manifest);

  return {
    journey: curated,
    artifacts: {
      json: toWorkspaceRelative(root, curatedPath)
    },
    status: await getJourneyStatus(root, { journeyId })
  };
}

export async function getJourneyStatus(repoRoot, options = {}) {
  const journey = await readLatestJourneyMap(repoRoot);
  if (!journey) {
    return {
      schema_version: JOURNEY_SCHEMA_VERSION,
      status: 'missing',
      curated: false,
      handoff_available: false,
      artifact_kind: null,
      curation_status: 'missing',
      reason: 'Journey context is not generated.',
      journey: null
    };
  }
  const curatedJourney = await readCuratedJourneyMap(repoRoot, options.journeyId ?? journey.journey_id);
  const effectiveJourney = curatedJourney ?? journey;
  const status = curatedJourney
    ? resolveJourneyReadinessStatus(curatedJourney)
    : 'needs_curated_journey';
  return {
    schema_version: JOURNEY_SCHEMA_VERSION,
    status,
    generated_at: effectiveJourney.generated_at ?? journey.generated_at,
    journey_id: effectiveJourney.journey_id,
    artifact_kind: effectiveJourney.artifact_kind ?? (curatedJourney ? CURATED_JOURNEY_ARTIFACT_KIND : JOURNEY_CONTEXT_ARTIFACT_KIND),
    curation_status: effectiveJourney.curation_status ?? (curatedJourney ? 'curated' : 'needs_curated_journey'),
    curated: Boolean(curatedJourney),
    curated_journey_path: curatedJourney?.curated_journey_path ?? null,
    handoff_available: Boolean(journey.handoff),
    source_story_count: journey.source_story_ids?.length ?? 0,
    activity_count: effectiveJourney.backbone?.length ?? 0,
    walking_skeleton_status: effectiveJourney.walking_skeleton?.status ?? 'unknown',
    conflict_count: effectiveJourney.conflicts?.length ?? 0,
    open_question_count: effectiveJourney.open_questions?.length ?? 0,
    reason: curatedJourney ? null : 'Only machine-derived Journey context exists. Create or provide a curated Journey before treating the product Journey as settled.',
    journey: effectiveJourney,
    context_pack: journey,
    curated_journey: curatedJourney
  };
}

export function summarizeJourneyForPr(journey, storyId = null, { curatedJourney = null } = {}) {
  if (!journey) {
    return {
      status: 'missing',
      artifact_kind: null,
      curated: false,
      handoff_available: false,
      curation_status: 'missing',
      reason: 'Journey context is not generated.',
      current_story: null
    };
  }
  const effectiveJourney = curatedJourney ?? journey;
  const storyPlacement = findStoryPlacement(effectiveJourney, storyId);
  const affectedConflicts = findAffectedJourneyConflicts(effectiveJourney, storyId, storyPlacement);
  const affectedOpenQuestions = findAffectedJourneyOpenQuestions(effectiveJourney, storyId, storyPlacement);
  return {
    status: curatedJourney ? resolveJourneyReadinessStatus(curatedJourney) : 'needs_curated_journey',
    generated_at: effectiveJourney.generated_at ?? journey.generated_at,
    journey_id: effectiveJourney.journey_id,
    artifact_kind: effectiveJourney.artifact_kind ?? (curatedJourney ? CURATED_JOURNEY_ARTIFACT_KIND : JOURNEY_CONTEXT_ARTIFACT_KIND),
    curated: Boolean(curatedJourney),
    curated_journey_path: curatedJourney?.curated_journey_path ?? null,
    handoff_available: Boolean(journey.handoff),
    curation_status: effectiveJourney.curation_status ?? (curatedJourney ? 'curated' : 'needs_curated_journey'),
    walking_skeleton_status: effectiveJourney.walking_skeleton?.status ?? 'unknown',
    conflict_count: effectiveJourney.conflicts?.length ?? 0,
    open_question_count: effectiveJourney.open_questions?.length ?? 0,
    current_story: storyPlacement,
    affected_release_slices: storyPlacement
      ? (effectiveJourney.release_slices ?? [])
        .filter((slice) => (slice.story_ids ?? []).includes(storyId))
        .map((slice) => ({ slice_id: slice.slice_id, kind: slice.kind, label: slice.label }))
      : [],
    affected_conflicts: affectedConflicts,
    affected_open_questions: affectedOpenQuestions
  };
}

export function renderJourneyMap(result) {
  return renderJourneyMapMarkdown(result.journey ?? result);
}

export function renderJourneyStatus(status) {
  if (status.status === 'missing') {
    return `# Journey Status\n\n- status: missing\n- reason: ${status.reason}\n`;
  }
  return `# Journey Status

- status: ${status.status}
- generated_at: ${status.generated_at}
- journey_id: ${status.journey_id}
- artifact_kind: ${status.artifact_kind ?? '-'}
- curated: ${status.curated ? 'yes' : 'no'}
- curation_status: ${status.curation_status ?? '-'}
- handoff_available: ${status.handoff_available ? 'yes' : 'no'}
- source stories: ${status.source_story_count}
- activities: ${status.activity_count}
- walking skeleton: ${status.walking_skeleton_status}
- conflicts: ${status.conflict_count}
- open questions: ${status.open_question_count}
${status.reason ? `- reason: ${status.reason}\n` : ''}
`;
}

export function renderJourneyHandoff(journey) {
  return renderJourneyHandoffMarkdown(journey.journey ?? journey);
}

export function renderJourneyPrSection(summary) {
  if (!summary || summary.status === 'missing') {
    return `## Journey Map
- Status: missing
- Detail: ${summary?.reason ?? 'Journey context is not generated.'}`;
  }
  const current = summary.current_story;
  const slices = summary.affected_release_slices.length > 0
    ? summary.affected_release_slices.map((slice) => `${slice.slice_id} (${slice.kind})`).join(', ')
    : '-';
  return `## Journey Map
- Status: ${summary.status}
- Generated: ${summary.generated_at}
- Artifact: ${summary.artifact_kind ?? '-'}
- Curated: ${summary.curated ? 'yes' : 'no'}
- Handoff available: ${summary.handoff_available ? 'yes' : 'no'}
- Walking skeleton: ${summary.walking_skeleton_status}
- Current Story step: ${current ? `${current.activity_id}/${current.step_id} (${current.placement_kind})` : '-'}
- Affected release slices: ${slices}
- Conflicts: ${summary.conflict_count}
- Open questions: ${summary.open_question_count}`;
}

function resolveJourneyReadinessStatus(journey) {
  return countUnresolvedJourneyConflicts(journey) > 0
    ? 'conflict'
    : journey.walking_skeleton?.status === 'needs_evidence'
      ? 'needs_evidence'
      : 'available';
}

export function renderJourneyCurateSummary(result) {
  return `# Journey Curated

- status: ${result.status.status}
- journey_id: ${result.journey.journey_id}
- artifact: ${result.artifacts.json}
- unresolved_conflicts: ${countUnresolvedJourneyConflicts(result.journey)}
- unresolved_open_questions: ${countUnresolvedJourneyOpenQuestions(result.journey)}
`;
}

function parseJudgmentInput(raw, filePath) {
  try {
    return JSON.parse(raw);
  } catch {
    if (!/\.ya?ml$/i.test(filePath)) throw new Error(`journey curate --input must be JSON or YAML: ${toPosix(filePath)}`);
    return parseSimpleYaml(raw);
  }
}

function parseSimpleYaml(raw) {
  const root = {};
  let currentKey = null;
  let currentItem = null;
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const top = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
    if (top && !line.startsWith(' ')) {
      currentKey = top[1];
      const value = top[2];
      if (value) root[currentKey] = parseScalar(value);
      else root[currentKey] = [];
      currentItem = null;
      continue;
    }
    const item = /^\s*-\s*([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
    if (item && currentKey) {
      currentItem = { [item[1]]: parseScalar(item[2]) };
      if (!Array.isArray(root[currentKey])) root[currentKey] = [];
      root[currentKey].push(currentItem);
      continue;
    }
    const nested = /^\s+([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
    if (nested && currentItem) currentItem[nested[1]] = parseScalar(nested[2]);
  }
  return root;
}

function parseScalar(value) {
  const trimmed = String(value ?? '').trim();
  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;
  return trimmed.replace(/^['"]|['"]$/g, '');
}

function normalizeJudgments(value) {
  const map = new Map();
  if (Array.isArray(value)) {
    for (const item of value) {
      if (!item?.id) continue;
      map.set(String(item.id), normalizeJudgment(item));
    }
    return map;
  }
  if (value && typeof value === 'object') {
    for (const [id, item] of Object.entries(value)) {
      map.set(id, normalizeJudgment(typeof item === 'string' ? { status: item } : { id, ...item }));
    }
  }
  return map;
}

function normalizeJudgment(item) {
  const status = String(item.status ?? item.resolution ?? item.decision ?? item.answer_status ?? '').toLowerCase();
  return {
    id: item.id ?? null,
    status,
    reason: item.reason ?? item.rationale ?? item.answer ?? item.deferral_reason ?? null,
    owner: item.owner ?? null
  };
}

function collectUnhandledJourneyItems(journey, { conflictDecisions, questionDecisions }) {
  const missing = [];
  for (const conflict of journey.conflicts ?? []) {
    if (!isHandledDecision(conflictDecisions.get(conflict.id), ['resolved', 'accepted', 'deferred'])) {
      missing.push(`conflict ${conflict.id}`);
    }
  }
  for (const question of journey.open_questions ?? []) {
    const decision = questionDecisions.get(question.id);
    if (!isHandledDecision(decision, ['answered', 'resolved', 'deferred'])) {
      missing.push(`open_question ${question.id}`);
      continue;
    }
    if (decision.status === 'deferred' && !decision.reason) missing.push(`open_question ${question.id} deferral_reason`);
  }
  return missing;
}

function isHandledDecision(decision, statuses) {
  return Boolean(decision && statuses.includes(decision.status));
}

function countUnresolvedJourneyConflicts(journey) {
  return (journey.conflicts ?? []).filter((conflict) => !isHandledDecision(conflict.curation, ['resolved', 'accepted', 'deferred'])).length;
}

function countUnresolvedJourneyOpenQuestions(journey) {
  return (journey.open_questions ?? []).filter((question) => !isHandledDecision(question.curation, ['answered', 'resolved', 'deferred'])).length;
}

async function readJourneyStoryInputs(root) {
  const [configStories, catalogStories, docStories, evidenceIndex] = await Promise.all([
    readConfigStories(root),
    readCatalogStories(root),
    readStoryDocs(root),
    readJourneyEvidenceIndex(root)
  ]);
  const byId = new Map();
  for (const story of [...configStories, ...catalogStories, ...docStories]) {
    if (!story.story_id) continue;
    const existing = byId.get(story.story_id) ?? emptyStoryInput(story.story_id);
    byId.set(story.story_id, mergeStoryInput(existing, story));
  }
  for (const [storyId, evidence] of evidenceIndex.entries()) {
    const existing = byId.get(storyId);
    if (!existing) continue;
    byId.set(storyId, mergeStoryInput(existing, evidence));
  }
  return [...byId.values()].sort((a, b) => {
    const dateA = a.updated_at ?? a.created_at ?? '';
    const dateB = b.updated_at ?? b.created_at ?? '';
    return dateA.localeCompare(dateB) || a.story_id.localeCompare(b.story_id);
  });
}

async function readConfigStories(root) {
  try {
    const config = JSON.parse(await readFile(path.join(getWorkspaceDir(root), 'config.json'), 'utf8'));
    return (config.brainbase?.stories ?? []).map((story) => normalizeStoryInput({
      ...story,
      source_types: ['config'],
      source_paths: []
    }));
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

async function readCatalogStories(root) {
  try {
    const catalogPath = path.join(getWorkspaceDir(root), 'stories', 'story-catalog.json');
    const catalog = JSON.parse(await readFile(catalogPath, 'utf8'));
    return (catalog.stories ?? []).map((story) => normalizeStoryInput({
      ...story,
      story_id: story.story_id,
      title: story.title,
      status: story.status,
      view: story.view,
      category: story.category,
      period: story.period,
      source_types: ['story_catalog'],
      source_paths: story.source?.paths ?? [],
      surfaces: buildSurfaceEvidenceFromPaths(story.source?.paths ?? [], 'story_catalog'),
      derived_definition: story.derived?.story_definition ?? null,
      workflow_position: story.derived?.meaning?.workflow_position ?? null
    }));
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

async function readStoryDocs(root) {
  const stories = [];
  for (const dir of STORY_DIRS) {
    const absoluteDir = path.join(root, dir);
    for (const filePath of await listMarkdownFiles(absoluteDir)) {
      const relativePath = path.relative(root, filePath).split(path.sep).join('/');
      const content = await readFile(filePath, 'utf8');
      stories.push(normalizeStoryInput(parseStoryDoc(relativePath, content)));
    }
  }
  return stories;
}

async function readJourneyEvidenceIndex(root) {
  const [specEvidence, graphifyEvidence, gateEvidence] = await Promise.all([
    readSpecEvidence(root),
    readGraphifyEvidence(root),
    readGateEvidence(root)
  ]);
  const index = new Map();
  for (const item of [...specEvidence, ...graphifyEvidence, ...gateEvidence]) {
    if (!item.story_id) continue;
    const existing = index.get(item.story_id) ?? normalizeStoryInput({
      story_id: item.story_id,
      source_types: ['journey_evidence']
    });
    index.set(item.story_id, mergeStoryInput(existing, normalizeStoryInput({
      story_id: item.story_id,
      spec_clauses: item.spec_clauses ?? [],
      surfaces: item.surfaces ?? [],
      gate_evidence: item.gate_evidence ?? [],
      source_types: item.source_types ?? ['journey_evidence'],
      source_paths: item.source_paths ?? []
    })));
  }
  return index;
}

async function readSpecEvidence(root) {
  const specs = [];
  const specDir = path.join(root, 'docs', 'specs');
  for (const filePath of await listMarkdownFiles(specDir)) {
    const relativePath = path.relative(root, filePath).split(path.sep).join('/');
    const content = await readFile(filePath, 'utf8');
    const { frontmatter, body } = parseFrontmatter(content);
    const storyId = frontmatter.story_id ?? inferStoryIdFromText(body);
    if (!storyId) continue;
    const clauses = extractSpecClauses(body, relativePath);
    if (clauses.length === 0) continue;
    specs.push({
      story_id: storyId,
      spec_clauses: clauses,
      source_types: ['spec'],
      source_paths: [relativePath]
    });
  }
  return specs;
}

async function readGraphifyEvidence(root) {
  const entries = [];
  const storyIds = await readConfiguredStoryIds(root);
  const candidates = storyIds.length > 0 ? storyIds : ['story-default'];
  const seen = new Set();
  for (const routedStoryId of candidates) {
    const graphPath = await resolveGraphifyArtifactFile(root, routedStoryId);
    if (seen.has(graphPath)) continue;
    seen.add(graphPath);
    let graph;
    try { graph = JSON.parse(await readFile(graphPath, 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    const relativeGraphPath = toWorkspaceRelative(root, graphPath);
  for (const story of graph.stories ?? []) {
    const surfaces = normalizeSurfaceEvidence(story.surfaces ?? story.coverage ?? story.paths ?? [], relativeGraphPath, 'graphify');
    if (story.story_id && surfaces.length > 0) {
      entries.push({
        story_id: story.story_id,
        surfaces,
        source_types: ['graphify'],
        source_paths: [relativeGraphPath]
      });
    }
  }
  for (const node of graph.nodes ?? []) {
    const storyIds = [
      node.story_id,
      ...(Array.isArray(node.story_ids) ? node.story_ids : [])
    ].filter(Boolean);
    if (storyIds.length === 0) continue;
    const surfaces = normalizeSurfaceEvidence([node.path, node.file, node.route, node.api, node.component, node].filter(Boolean), relativeGraphPath, 'graphify');
    if (surfaces.length === 0) continue;
    for (const storyId of storyIds) {
      entries.push({
        story_id: storyId,
        surfaces,
        source_types: ['graphify'],
        source_paths: [relativeGraphPath]
      });
    }
  }
  }
  return entries;
}

async function readGateEvidence(root) {
  const configuredStoryIds = await readConfiguredStoryIds(root);
  if (configuredStoryIds.length > 0) {
    const evidence = [];
    for (const storyId of configuredStoryIds) {
      const verificationPath = await resolvePrArtifactFile(root, storyId, 'verification-evidence.json');
      const gateDagPath = await resolveGateArtifactFile(root, storyId);
      evidence.push(...await readVerificationEvidence(path.dirname(verificationPath), root, storyId));
      evidence.push(...await readGateDagEvidence(path.dirname(gateDagPath), root, storyId));
    }
    return evidence;
  }
  const prRoot = path.join(getWorkspaceDir(root), 'pr');
  let entries;
  try {
    entries = await readdir(prRoot, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
  const evidence = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const storyId = entry.name;
    const prDir = path.join(prRoot, storyId);
    evidence.push(...await readVerificationEvidence(prDir, root, storyId));
    evidence.push(...await readGateDagEvidence(prDir, root, storyId));
  }
  return evidence;
}

async function readConfiguredStoryIds(root) {
  try {
    const config = JSON.parse(await readFile(path.join(root, '.vibepro', 'config.json'), 'utf8'));
    return [...new Set((config.brainbase?.stories ?? []).map((story) => story.story_id ?? story.id).filter(Boolean))];
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

async function readVerificationEvidence(prDir, root, storyId) {
  const evidencePath = path.join(prDir, 'verification-evidence.json');
  let parsed;
  try {
    parsed = JSON.parse(await readFile(evidencePath, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
  const relativePath = toWorkspaceRelative(root, evidencePath);
  const commands = (parsed.commands ?? []).map((command) => ({
    kind: command.kind ?? 'verification',
    ref: command.status ?? 'unknown',
    source: relativePath,
    command: command.command ?? null
  }));
  return commands.length > 0
    ? [{
        story_id: parsed.story_id ?? storyId,
        gate_evidence: commands,
        source_types: ['gate_evidence'],
        source_paths: [relativePath]
      }]
    : [];
}

async function readGateDagEvidence(prDir, root, storyId) {
  const gateDagPath = path.join(prDir, 'gate-dag.json');
  let parsed;
  try {
    parsed = JSON.parse(await readFile(gateDagPath, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
  const relativePath = toWorkspaceRelative(root, gateDagPath);
  const nodes = Array.isArray(parsed.nodes)
    ? parsed.nodes
    : Array.isArray(parsed.gate_dag?.nodes)
      ? parsed.gate_dag.nodes
      : [];
  const gateEvidence = nodes.map((node) => ({
    kind: 'gate',
    ref: `${node.id ?? node.gate ?? 'unknown'}:${node.status ?? 'unknown'}`,
    source: relativePath
  }));
  if (parsed.overall_status) {
    gateEvidence.unshift({ kind: 'gate_dag', ref: parsed.overall_status, source: relativePath });
  }
  return gateEvidence.length > 0
    ? [{
        story_id: parsed.story_id ?? storyId,
        gate_evidence: gateEvidence,
        source_types: ['gate_evidence'],
        source_paths: [relativePath]
      }]
    : [];
}

async function listMarkdownFiles(dir) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
  const files = [];
  for (const entry of entries) {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await listMarkdownFiles(entryPath));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith('.md')) files.push(entryPath);
  }
  return files;
}

function parseStoryDoc(relativePath, content) {
  const { frontmatter, body } = parseFrontmatter(content);
  const title = frontmatter.title ?? body.match(/^#\s+(.+)$/m)?.[1]?.replace(/^Story:\s*/i, '').trim() ?? path.basename(relativePath, '.md');
  return {
    story_id: frontmatter.story_id ?? slugify(path.basename(relativePath, '.md')),
    title,
    status: frontmatter.status ?? 'active',
    view: frontmatter.view ?? null,
    category: frontmatter.category ?? null,
    period: frontmatter.period ?? null,
    created_at: frontmatter.created_at ?? null,
    updated_at: frontmatter.updated_at ?? null,
    journey_activity: frontmatter.journey_activity ?? null,
    journey_step: frontmatter.journey_step ?? null,
    journey_step_label: frontmatter.journey_step_label ?? null,
    release_slice: frontmatter.release_slice ?? null,
    enabler_kind: frontmatter.enabler_kind ?? null,
    journey_to: frontmatter.journey_to ?? frontmatter.post_step_destination ?? null,
    body,
    acceptance_focus: extractAcceptanceCriteria(body),
    source_types: ['story_doc'],
    source_paths: [relativePath]
  };
}

function parseFrontmatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!match) return { frontmatter: {}, body: content };
  const frontmatter = {};
  for (const line of match[1].split(/\r?\n/)) {
    const item = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!item) continue;
    frontmatter[item[1]] = item[2].replace(/^["']|["']$/g, '').trim();
  }
  return { frontmatter, body: content.slice(match[0].length) };
}

function extractAcceptanceCriteria(body) {
  const section = body.split(/^##\s+(?:Acceptance Criteria|受け入れ基準|受入基準)\s*$/m)[1] ?? '';
  return section
    .split(/\r?\n/)
    .map((line) => line.match(/^\s*-\s+\[[ xX]\]\s+(.+)$|^\s*-\s+(.+)$/))
    .filter(Boolean)
    .map((match) => (match[1] ?? match[2]).trim())
    .slice(0, 12);
}

function inferStoryIdFromText(text) {
  return text.match(/\bstory-[a-z0-9][a-z0-9-]+\b/i)?.[0] ?? null;
}

function extractSpecClauses(body, source) {
  return body
    .split(/\r?\n/)
    .map((line) => line.match(/^\s*-\s+`?([A-Z][A-Z0-9]+-[A-Z0-9-]+)`?:\s+(.+)$/))
    .filter(Boolean)
    .map((match) => ({
      id: match[1],
      text: match[2].trim(),
      source
    }))
    .slice(0, 40);
}

function buildSurfaceEvidenceFromPaths(paths, source) {
  return normalizeSurfaceEvidence(paths, source, source);
}

function normalizeSurfaceEvidence(items, source, defaultKind = 'surface') {
  const values = Array.isArray(items) ? items : [items];
  return values
    .flatMap((item) => normalizeSurfaceItem(item, source, defaultKind))
    .filter(Boolean);
}

function normalizeSurfaceItem(item, source, defaultKind) {
  if (!item) return [];
  if (typeof item === 'string') {
    const kind = classifySurfacePath(item) ?? defaultKind;
    return [{ kind, ref: item, source }];
  }
  if (typeof item !== 'object') return [];
  const ref = item.ref ?? item.path ?? item.file ?? item.route ?? item.api ?? item.component ?? item.id ?? null;
  if (!ref) return [];
  const kind = item.kind ?? item.type ?? classifySurfacePath(ref) ?? defaultKind;
  return [{ kind, ref: String(ref), source }];
}

function classifySurfacePath(value) {
  const text = String(value ?? '').toLowerCase();
  if (!text) return null;
  if (/\/api\/|(^|\/)api($|\/)|route\.(js|ts)$/.test(text)) return 'api';
  if (/\/app\/|\/pages\/|page\.(jsx|tsx|js|ts)$|layout\.(jsx|tsx|js|ts)$/.test(text)) return 'route';
  if (/\/components?\//.test(text) || /\.(jsx|tsx)$/.test(text)) return 'component';
  if (/^docs\//.test(text) || /\.md$/.test(text)) return 'document';
  if (/config|\.json$|\.ya?ml$/.test(text)) return 'config';
  return null;
}

function emptyStoryInput(storyId) {
  return normalizeStoryInput({ story_id: storyId });
}

function normalizeStoryInput(story) {
  return {
    story_id: story.story_id,
    title: story.title ?? story.story_id,
    status: story.status ?? 'active',
    view: story.view ?? null,
    category: story.category ?? null,
    period: story.period ?? null,
    created_at: story.created_at ?? null,
    updated_at: story.updated_at ?? null,
    journey_activity: story.journey_activity ?? null,
    journey_step: story.journey_step ?? null,
    journey_step_label: story.journey_step_label ?? null,
    release_slice: story.release_slice ?? null,
    enabler_kind: story.enabler_kind ?? null,
    journey_to: story.journey_to ?? null,
    body: story.body ?? '',
    acceptance_focus: story.acceptance_focus ?? story.derived_definition?.acceptance_focus ?? [],
    derived_definition: story.derived_definition ?? null,
    workflow_position: story.workflow_position ?? null,
    spec_clauses: story.spec_clauses ?? [],
    surfaces: story.surfaces ?? buildSurfaceEvidenceFromPaths(story.source_paths ?? [], 'source_path'),
    gate_evidence: story.gate_evidence ?? [],
    source_types: story.source_types ?? [],
    source_paths: story.source_paths ?? []
  };
}

function mergeStoryInput(a, b) {
  return {
    ...a,
    ...Object.fromEntries(Object.entries(b).filter(([key, value]) => {
      if (value === null || value === undefined || value === '') return false;
      if (key === 'title' && value === b.story_id && a.title && a.title !== a.story_id) return false;
      return true;
    })),
    source_types: [...new Set([...(a.source_types ?? []), ...(b.source_types ?? [])])],
    source_paths: [...new Set([...(a.source_paths ?? []), ...(b.source_paths ?? [])])],
    acceptance_focus: [...new Set([...(a.acceptance_focus ?? []), ...(b.acceptance_focus ?? [])])],
    spec_clauses: mergeEvidenceArray(a.spec_clauses, b.spec_clauses, (item) => item.id),
    surfaces: mergeEvidenceArray(a.surfaces, b.surfaces, (item) => `${item.kind}:${item.ref}`),
    gate_evidence: mergeEvidenceArray(a.gate_evidence, b.gate_evidence, (item) => `${item.kind}:${item.ref}`)
  };
}

function mergeEvidenceArray(a = [], b = [], keyFn) {
  const byKey = new Map();
  for (const item of [...a, ...b]) {
    if (!item) continue;
    const key = keyFn(item);
    if (!key) continue;
    byKey.set(key, { ...(byKey.get(key) ?? {}), ...item });
  }
  return [...byKey.values()];
}

function placeStory(story) {
  const explicitActivity = normalizeActivity(story.journey_activity);
  const inferredActivity = explicitActivity ?? normalizeActivity(story.workflow_position?.stage) ?? inferActivity(story);
  const placementKind = isEnablerStory(story, inferredActivity) ? 'enabler' : 'backbone_step';
  const stepId = story.journey_step ? slugify(story.journey_step) : inferStepId(story, inferredActivity);
  const confidence = story.journey_activity || story.journey_step
    ? 'high'
    : story.workflow_position?.confidence ?? (inferredActivity === 'knowledge_recovery' ? 'low' : 'medium');
  return {
    ...story,
    activity_id: inferredActivity,
    activity_label: ACTIVITY_LABELS[inferredActivity] ?? inferredActivity,
    step_id: stepId,
    step_label: story.journey_step_label ?? inferStepLabel(story, stepId),
    release_slice: normalizeReleaseSlice(story.release_slice) ?? inferReleaseSlice(story, placementKind, inferredActivity),
    placement_kind: placementKind,
    placement_status: inferredActivity && stepId ? 'placed' : 'unplaced',
    placement_reason: inferredActivity && stepId ? null : 'Journey activity or step could not be inferred.',
    confidence,
    evidence: buildPlacementEvidence(story)
  };
}

function normalizeActivity(value) {
  const normalized = slugify(value)?.replace(/-/g, '_');
  const aliases = {
    entry: 'activation',
    personalization: 'core_usage',
    usage: 'core_usage',
    risk: 'risk_control',
    security: 'risk_control',
    quality: 'quality_gate',
    docs: 'knowledge_recovery'
  };
  return ACTIVITY_ORDER.includes(normalized) ? normalized : aliases[normalized] ?? null;
}

function inferActivity(story) {
  const text = storyText(story);
  if (/public-discovery|seo|article|content|cms|landing|contact|waiting|問い合わせ|検索|流入/.test(text)) return 'acquisition';
  if (/auth|login|signup|account|onboarding|navigation|利用開始|登録|認証|ログイン/.test(text)) return 'activation';
  if (/profile|personal|dashboard|home|workflow|sample|core|主要|編集|保存|確認/.test(text)) return 'core_usage';
  if (/billing|premium|stripe|payment|subscription|課金|支払い/.test(text)) return 'monetization';
  if (/notification|retention|email|push|通知|再訪|継続/.test(text)) return 'retention';
  if (/security|auth-boundary|trust|permission|権限|信頼|境界/.test(text)) return 'risk_control';
  if (/quality|test|ci|e2e|gate|coverage|検証|品質/.test(text)) return 'quality_gate';
  if (/architecture|adr|spec|contract|journey|patton|構造|設計/.test(text)) return 'architecture';
  if (/ops|deploy|runtime|observability|health|運用|デプロイ/.test(text)) return 'operations';
  if (/docs|ssot|recovery|正本|復元/.test(text)) return 'knowledge_recovery';
  return story.category === 'product' ? 'core_usage' : 'knowledge_recovery';
}

function isEnablerStory(story, activity) {
  if (story.enabler_kind) return true;
  if (['architecture', 'risk_control', 'operations', 'quality_gate', 'knowledge_recovery'].includes(activity)) return true;
  return ['architecture', 'security', 'ops', 'quality', 'docs'].includes(story.category);
}

function inferStepId(story, activity) {
  const text = storyText(story);
  if (activity === 'acquisition') {
    if (/contact|waiting|問い合わせ/.test(text)) return 'contact';
    if (/cms|content|article|記事/.test(text)) return 'content';
    return 'discover';
  }
  if (activity === 'activation') {
    if (/onboarding|初回/.test(text)) return 'onboarding';
    if (/navigation|home|shell|ナビ/.test(text)) return 'enter-app';
    return 'signup';
  }
  if (activity === 'core_usage') {
    if (/profile|personal|個人/.test(text)) return 'personalize';
    if (/sample|review/.test(text)) return 'review-work';
    return 'first-value';
  }
  if (activity === 'monetization') return 'pay';
  if (activity === 'retention') return 'return';
  if (activity === 'risk_control') return 'trust-boundary';
  if (activity === 'quality_gate') return 'quality-evidence';
  if (activity === 'architecture') return 'architecture-decision';
  if (activity === 'operations') return 'operate';
  return 'recover-source';
}

function inferStepLabel(story, stepId) {
  const labels = {
    discover: '価値を理解する',
    contact: '問い合わせる',
    content: 'コンテンツを見る',
    signup: '登録・認証する',
    onboarding: '初期設定する',
    'enter-app': 'アプリに入る',
    'first-value': '最初の価値を得る',
    personalize: '体験を個人化する',
    'review-work': '作業を確認する',
    pay: '支払う',
    return: '再訪する',
    'trust-boundary': '信頼境界を守る',
    'quality-evidence': '品質証跡を揃える',
    'architecture-decision': '設計判断を確定する',
    operate: '運用する',
    'recover-source': '正本を復元する'
  };
  return labels[stepId] ?? story.title ?? stepId;
}

function normalizeReleaseSlice(value) {
  const normalized = slugify(value)?.replace(/-/g, '_');
  if (RELEASE_SLICE_ORDER.includes(normalized)) return normalized;
  return null;
}

function inferReleaseSlice(story, placementKind, activity) {
  if (placementKind === 'enabler') return 'hardening';
  if (['acquisition', 'activation', 'core_usage'].includes(activity)) return 'walking_skeleton';
  if (['monetization', 'retention'].includes(activity)) return 'next_slice';
  return 'hardening';
}

function buildPlacementEvidence(story) {
  return [
    ...(story.source_paths ?? []).map((file) => ({ type: 'source_path', ref: file })),
    ...(story.spec_clauses ?? []).map((clause) => ({ type: 'spec_clause', ref: clause.id, source: clause.source })),
    ...(story.surfaces ?? []).map((surface) => ({ type: 'surface', ref: `${surface.kind}:${surface.ref}`, source: surface.source })),
    ...(story.gate_evidence ?? []).map((evidence) => ({ type: 'gate_evidence', ref: `${evidence.kind}:${evidence.ref}`, source: evidence.source })),
    story.workflow_position ? { type: 'workflow_position', ref: story.workflow_position.stage } : null,
    story.journey_activity ? { type: 'frontmatter', ref: 'journey_activity' } : null,
    story.journey_step ? { type: 'frontmatter', ref: 'journey_step' } : null
  ].filter(Boolean);
}

function buildBackbone(placements) {
  const byActivity = new Map();
  for (const placement of placements.filter((item) => item.placement_status === 'placed')) {
    if (!byActivity.has(placement.activity_id)) {
      byActivity.set(placement.activity_id, {
        activity_id: placement.activity_id,
        label: placement.activity_label,
        order: ACTIVITY_ORDER.indexOf(placement.activity_id),
        steps: new Map()
      });
    }
    const activity = byActivity.get(placement.activity_id);
    if (!activity.steps.has(placement.step_id)) {
      activity.steps.set(placement.step_id, {
        step_id: placement.step_id,
        label: placement.step_label,
        order: activity.steps.size,
        story_ids: [],
        story_labels: {},
        enabler_story_ids: [],
        enabler_story_labels: {},
        evidence: [],
        confidence: placement.confidence
      });
    }
    const step = activity.steps.get(placement.step_id);
    const target = placement.placement_kind === 'enabler' ? step.enabler_story_ids : step.story_ids;
    const targetLabels = placement.placement_kind === 'enabler' ? step.enabler_story_labels : step.story_labels;
    target.push(placement.story_id);
    targetLabels[placement.story_id] = formatStoryTitleForHuman(placement.title, placement.story_id);
    step.evidence.push(...placement.evidence);
    step.confidence = combineConfidence(step.confidence, placement.confidence);
  }
  return [...byActivity.values()]
    .sort((a, b) => a.order - b.order)
    .map((activity) => ({
      ...activity,
      steps: [...activity.steps.values()].map((step, index) => ({
        ...step,
        order: index,
        story_ids: [...new Set(step.story_ids)],
        story_labels: selectStoryLabels(step.story_labels, step.story_ids),
        enabler_story_ids: [...new Set(step.enabler_story_ids)],
        enabler_story_labels: selectStoryLabels(step.enabler_story_labels, step.enabler_story_ids),
        evidence: dedupeEvidence(step.evidence)
      }))
    }));
}

function buildReleaseSlices(placements, backbone) {
  return RELEASE_SLICE_ORDER.slice(0, 3).map((sliceId) => {
    const placed = placements.filter((placement) => placement.release_slice === sliceId);
    return {
      slice_id: sliceId,
      label: formatReleaseSliceName({ slice_id: sliceId }),
      kind: sliceId,
      story_ids: placed.map((placement) => placement.story_id),
      required_step_ids: sliceId === 'walking_skeleton' ? inferWalkingSkeletonRequiredSteps(backbone) : [],
      status: placed.length > 0 ? 'present' : 'empty'
    };
  });
}

function buildWalkingSkeleton(backbone, releaseSlices) {
  const requiredStepIds = releaseSlices.find((slice) => slice.slice_id === 'walking_skeleton')?.required_step_ids ?? [];
  if (requiredStepIds.length === 0) {
    return {
      status: 'not_applicable',
      required_step_ids: [],
      covered_step_ids: [],
      gaps: [],
      story_ids: []
    };
  }
  const steps = backbone.flatMap((activity) => activity.steps.map((step) => ({ ...step, activity_id: activity.activity_id })));
  const coveredStepIds = steps
    .filter((step) => requiredStepIds.includes(step.step_id) && step.story_ids.length > 0)
    .map((step) => step.step_id);
  const gaps = requiredStepIds
    .filter((stepId) => !coveredStepIds.includes(stepId))
    .map((stepId) => ({ step_id: stepId, label: inferStepLabel({}, stepId) }));
  return {
    status: gaps.length > 0 ? 'needs_evidence' : 'covered',
    required_step_ids: requiredStepIds,
    covered_step_ids: coveredStepIds,
    gaps,
    story_ids: steps
      .filter((step) => coveredStepIds.includes(step.step_id))
      .flatMap((step) => step.story_ids)
  };
}

function inferWalkingSkeletonRequiredSteps(backbone) {
  const activityIds = new Set(backbone.map((activity) => activity.activity_id));
  if (!['acquisition', 'activation', 'core_usage'].some((activity) => activityIds.has(activity))) return [];
  return ['discover', 'signup', 'first-value'];
}

function buildJourneyConflicts(placements) {
  const byStep = new Map();
  for (const placement of placements) {
    if (!placement.journey_to) continue;
    const key = `${placement.activity_id}:${placement.step_id}`;
    if (!byStep.has(key)) byStep.set(key, []);
    byStep.get(key).push(placement);
  }
  const conflicts = [];
  for (const [key, items] of byStep.entries()) {
    const destinations = [...new Set(items.map((item) => item.journey_to))];
    if (destinations.length <= 1) continue;
    conflicts.push({
      id: `journey-conflict:${key}`,
      type: 'step_destination_conflict',
      severity: 'needs_review',
      activity_id: items[0].activity_id,
      step_id: items[0].step_id,
      story_ids: items.map((item) => item.story_id),
      destinations,
      reason: 'Multiple active Stories define different next destinations for the same Journey step.'
    });
  }
  return conflicts;
}

function findStoryPlacement(journey, storyId) {
  if (!storyId) return null;
  for (const activity of journey.backbone ?? []) {
    for (const step of activity.steps ?? []) {
      if ((step.story_ids ?? []).includes(storyId) || (step.enabler_story_ids ?? []).includes(storyId)) {
        return {
          activity_id: activity.activity_id,
          activity_label: activity.label,
          step_id: step.step_id,
          step_label: step.label,
          placement_kind: (step.enabler_story_ids ?? []).includes(storyId) ? 'enabler' : 'backbone_step',
          confidence: step.confidence
        };
      }
    }
  }
  return null;
}

function findAffectedJourneyConflicts(journey, storyId, storyPlacement) {
  if (!journey) return [];
  return (journey.conflicts ?? [])
    .filter((conflict) => (
      (storyId && (conflict.story_ids ?? []).includes(storyId))
      || (
        storyPlacement
        && conflict.activity_id === storyPlacement.activity_id
        && conflict.step_id === storyPlacement.step_id
      )
    ))
    .map((conflict) => ({
      id: conflict.id,
      type: conflict.type,
      severity: conflict.severity,
      activity_id: conflict.activity_id,
      step_id: conflict.step_id,
      story_ids: conflict.story_ids ?? [],
      destinations: conflict.destinations ?? [],
      reason: conflict.reason,
      curation: conflict.curation ?? null
    }));
}

function findAffectedJourneyOpenQuestions(journey, storyId, storyPlacement) {
  if (!journey) return [];
  return (journey.open_questions ?? [])
    .filter((question) => (
      (storyId && question.story_id === storyId)
      || (
        storyPlacement
        && question.step_id
        && question.step_id === storyPlacement.step_id
      )
    ))
    .map((question) => ({
      id: question.id,
      kind: question.kind,
      blocker: question.blocker === true,
      story_id: question.story_id ?? null,
      step_id: question.step_id ?? null,
      question: question.question,
      curation: question.curation ?? null
    }));
}

function buildJourneyHandoff(journey) {
  const blockingQuestions = (journey.open_questions ?? []).filter((question) => question.blocker === true);
  return {
    status: 'ready_for_ai',
    purpose: 'Use this machine-derived context to create or revise a curated product Journey. Do not treat the candidate placements as authoritative.',
    artifact_kind: 'ai_handoff',
    target_curated_artifact: `.vibepro/journeys/${journey.journey_id}.json`,
    candidate_artifact_kind: journey.artifact_kind,
    candidate_journey_id: journey.journey_id,
    source_story_count: journey.source_story_ids?.length ?? 0,
    candidate_activity_count: journey.backbone?.length ?? 0,
    conflict_count: journey.conflicts?.length ?? 0,
    open_question_count: journey.open_questions?.length ?? 0,
    blocking_question_count: blockingQuestions.length,
    instructions: [
      'Decide which product loop or user/business journey is being curated.',
      'Classify candidate Story placements as core steps, supporting concerns, or out-of-journey evidence.',
      'Resolve conflicts and blocking open questions explicitly.',
      'Write a curated Journey JSON artifact before treating Journey status as available.'
    ]
  };
}

function renderJourneyHandoffMarkdown(journey) {
  const handoff = journey.handoff ?? buildJourneyHandoff(journey);
  const conflicts = (journey.conflicts ?? []).length === 0
    ? '-'
    : journey.conflicts.map((conflict) => `- ${conflict.id}: ${conflict.reason} (${(conflict.story_ids ?? []).join(', ')})`).join('\n');
  const questions = (journey.open_questions ?? []).length === 0
    ? '-'
    : journey.open_questions.map((question) => `- ${question.id}${question.blocker ? ' [blocking]' : ''}: ${question.question}`).join('\n');
  const candidateSteps = (journey.backbone ?? [])
    .flatMap((activity) => (activity.steps ?? []).map((step) => ({
      activity,
      step
    })))
    .map(({ activity, step }) => [
      activity.activity_id,
      step.step_id,
      summarizeStoryRefs(step.story_ids ?? [], { labels: step.story_labels ?? {}, limit: 8 }),
      summarizeStoryRefs(step.enabler_story_ids ?? [], { labels: step.enabler_story_labels ?? {}, limit: 8 }),
      step.confidence ?? '-'
    ]);
  const rows = candidateSteps.length === 0
    ? '| - | - | - | - | - |'
    : candidateSteps
      .map((row) => `| ${row.map(escapeMarkdownTableCell).join(' | ')} |`)
      .join('\n');
  return `# Journey AI Handoff

## Purpose

This is a machine-derived Journey context pack for AI or human interpretation. It is not the authoritative product Journey.

## Target Output

- Curated artifact: \`${handoff.target_curated_artifact}\`
- Candidate Journey: \`${journey.journey_id}\`
- Candidate artifact kind: \`${journey.artifact_kind ?? JOURNEY_CONTEXT_ARTIFACT_KIND}\`
- Curation status: \`${journey.curation_status ?? 'needs_curated_journey'}\`

## Instructions

${handoff.instructions.map((item) => `- ${item}`).join('\n')}

## Candidate Steps

| Activity | Step | Candidate core Stories | Supporting Stories | Confidence |
|---|---|---|---|---|
${rows}

## Walking Skeleton

- status: ${journey.walking_skeleton?.status ?? 'unknown'}
- required_step_ids: ${(journey.walking_skeleton?.required_step_ids ?? []).join(', ') || '-'}
- covered_step_ids: ${(journey.walking_skeleton?.covered_step_ids ?? []).join(', ') || '-'}

## Conflicts

${conflicts}

## Open Questions

${questions}
`;
}

function renderJourneyMapMarkdown(journey) {
  const activities = journey.backbone ?? [];
  const slices = journey.release_slices ?? [];
  const generatedAt = journey.generated_at ?? '-';
  const storyCount = journey.source_story_ids?.length ?? 0;
  const walkingSkeletonStatus = journey.walking_skeleton?.status ?? 'unknown';
  const conflictCount = journey.conflicts?.length ?? 0;
  const openQuestionCount = journey.open_questions?.length ?? 0;
  const unplacedCount = journey.unplaced_stories?.length ?? 0;
  const headline = buildJourneyHeadline(journey);
  const nextJudgments = buildJourneyNextJudgments(journey);
  const flowRows = renderJourneyFlowRows(activities);
  const sliceRows = renderReleaseSliceRows(slices, journey);
  const storyLabels = buildStoryLabelIndex(activities);
  const header = ['スライス', ...activities.map((activity) => activity.label)].join(' | ');
  const divider = ['---', ...activities.map(() => '---')].join(' | ');
  const rows = slices.map((slice) => [
    `${formatReleaseSliceName(slice)}（${formatJourneyStatus(slice.status)}）`,
    ...activities.map((activity) => renderJourneyCell(activity, slice))
  ].join(' | '));
  const conflicts = (journey.conflicts ?? []).length === 0
    ? '-'
    : journey.conflicts.map((conflict) => `- ${conflict.id}: ${conflict.story_ids.join(', ')} -> ${conflict.destinations.join(' / ')}`).join('\n');
  const questions = (journey.open_questions ?? []).length === 0
    ? '-'
    : journey.open_questions.map((question) => `- ${question.id}: ${question.question}`).join('\n');
  const unplaced = (journey.unplaced_stories ?? []).length === 0
    ? '-'
    : journey.unplaced_stories.map((story) => `- ${story.story_id}: ${story.reason}`).join('\n');
  const evidenceBindings = renderEvidenceBindings(activities);
  return `# VibePro Journey

> This artifact is a machine-derived Journey context pack for AI handoff. It is not the authoritative product Journey until a curated Journey exists.

| 項目 | 内容 |
|------|------|
| Journey | ${journey.journey_id} |
| Artifact | ${journey.artifact_kind ?? JOURNEY_CONTEXT_ARTIFACT_KIND} |
| Authoritative | ${journey.authoritative === true ? 'yes' : 'no'} |
| Curation status | ${journey.curation_status ?? 'needs_curated_journey'} |
| 生成日時 | ${generatedAt} |
| 対象Story | ${storyCount} |
| 最小体験 | ${formatJourneyStatus(walkingSkeletonStatus)} |
| Journey衝突 | ${conflictCount} |
| 未配置Story | ${unplacedCount} |
| 未解決の問い | ${openQuestionCount} |

## いまの結論

${headline}

## 現在の体験フロー

| 順 | 体験段階 | 状態 | 主なステップ | 判断 |
|---:|---|---|---|---|
${flowRows}

## リリーススライス

| スライス | 状態 | Story数 | 判断 |
|---|---|---:|---|
${sliceRows}

## 次の判断

${nextJudgments}

## 監査ログ: Patton式マップ

| ${header} |
| ${divider} |
${rows.map((row) => `| ${row} |`).join('\n')}

## 監査ログ: 最小体験

- 状態: ${formatJourneyStatus(walkingSkeletonStatus)}
- 必須ステップ: ${(journey.walking_skeleton?.required_step_ids ?? []).join(', ') || '-'}
- カバー済み: ${(journey.walking_skeleton?.covered_step_ids ?? []).join(', ') || '-'}
- 対象Story: ${summarizeStoryRefs(journey.walking_skeleton?.story_ids ?? [], { labels: storyLabels, limit: 12 })}

## 監査ログ: 証跡バインディング

${evidenceBindings}

## 監査ログ: Journey衝突

${conflicts}

## 監査ログ: 未配置Story

${unplaced}

## 監査ログ: 未解決の問い

${questions}
`;
}

function buildJourneyHeadline(journey) {
  const walkingSkeletonStatus = journey.walking_skeleton?.status ?? 'unknown';
  const conflictCount = journey.conflicts?.length ?? 0;
  const openQuestionCount = journey.open_questions?.length ?? 0;
  const unplacedCount = journey.unplaced_stories?.length ?? 0;
  const nextSlice = (journey.release_slices ?? []).find((slice) => slice.slice_id === 'next_slice');
  const lines = [];
  if (walkingSkeletonStatus === 'covered' && conflictCount === 0 && openQuestionCount === 0 && unplacedCount === 0) {
    lines.push('- 現在のJourneyは、最小体験が成立しており、未解決の衝突や未配置Storyはありません。');
  } else if (walkingSkeletonStatus === 'needs_evidence') {
    lines.push('- 現在のJourneyは、最小体験に不足があります。まず不足ステップを埋めるStoryまたは証跡を確認してください。');
  } else {
    lines.push(`- 現在のJourney状態は ${formatJourneyStatus(walkingSkeletonStatus)} です。衝突、未配置Story、未解決の問いを確認してください。`);
  }
  if (nextSlice?.status === 'empty') {
    lines.push('- 次の成長領域はまだ空です。次に伸ばす体験を明示すると、Story追加とPR分割の判断がしやすくなります。');
  }
  if (conflictCount > 0) lines.push(`- Journey衝突が ${conflictCount} 件あります。ユーザー遷移の正本を決めるまで、関連PRでは判断材料として扱ってください。`);
  if (unplacedCount > 0) lines.push(`- 未配置Storyが ${unplacedCount} 件あります。Journey stepへ置くか、補助Storyとして扱うかを決める必要があります。`);
  return lines.join('\n');
}

function renderJourneyFlowRows(activities) {
  if (!Array.isArray(activities) || activities.length === 0) return '| 1 | - | 未生成 | - | Journeyがまだ生成されていません。 |';
  return activities.map((activity, index) => {
    const storyCount = sumActivityStories(activity);
    const enablerCount = sumActivityEnablers(activity);
    const state = storyCount > 0 ? '成立' : enablerCount > 0 ? '強化中' : '未着手';
    const steps = (activity.steps ?? [])
      .map((step) => `${step.label}（${step.story_ids?.length ?? 0} Story${(step.enabler_story_ids?.length ?? 0) > 0 ? ` / 補助 ${step.enabler_story_ids.length}` : ''}）`)
      .join('<br>') || '-';
    return `| ${index + 1} | ${escapeMarkdownTableCell(activity.label)} | ${state} | ${escapeMarkdownTableCell(steps)} | ${escapeMarkdownTableCell(describeActivityJudgment(activity, state))} |`;
  }).join('\n');
}

function renderReleaseSliceRows(slices, journey) {
  if (!Array.isArray(slices) || slices.length === 0) return '| - | 未生成 | 0 | Journey deriveを実行してください。 |';
  return slices.map((slice) => {
    const storyCount = slice.story_ids?.length ?? 0;
    return `| ${escapeMarkdownTableCell(formatReleaseSliceName(slice))} | ${formatJourneyStatus(slice.status)} | ${storyCount} | ${escapeMarkdownTableCell(describeReleaseSliceJudgment(slice, journey))} |`;
  }).join('\n');
}

function buildJourneyNextJudgments(journey) {
  const actions = [];
  const nextSlice = (journey.release_slices ?? []).find((slice) => slice.slice_id === 'next_slice');
  if (journey.walking_skeleton?.status === 'needs_evidence') {
    const gaps = (journey.walking_skeleton.gaps ?? []).map((gap) => gap.label ?? gap.step_id).join(' / ');
    actions.push(`- 最優先: 最小体験の不足を埋める。対象: ${gaps || '-'}`);
  }
  if ((journey.conflicts ?? []).length > 0) {
    actions.push('- Journey衝突を解消する。特に同じstepで遷移先が割れているStoryは、どちらを正本にするか決める。');
  }
  if ((journey.unplaced_stories ?? []).length > 0) {
    actions.push('- 未配置Storyを整理する。ユーザー体験のstepに置くか、品質・信頼・構造の補助Storyとして扱うかを決める。');
  }
  if (nextSlice?.status === 'empty') {
    actions.push('- 次の成長領域を決める。今は次に強化するユーザー体験が空なので、対象体験をStoryとして切り出す。');
  }
  if (actions.length === 0) {
    actions.push('- 未解決のJourney判断はありません。新しいStoryを追加するときは、この体験フローのどこに置くかを確認してください。');
  }
  return actions.join('\n');
}

function describeActivityJudgment(activity, state) {
  if (state === '未着手') return 'まだ体験としては成立していません。';
  const storyCount = sumActivityStories(activity);
  const enablerCount = sumActivityEnablers(activity);
  if (storyCount > 0 && enablerCount > 0) return '体験は成立しており、補助Storyで品質や信頼性を強化しています。';
  if (storyCount > 0) return 'ユーザーが通る体験として成立しています。';
  return '主体験ではなく、補助Storyとして体験を支えています。';
}

function describeReleaseSliceJudgment(slice, journey) {
  if (slice.slice_id === 'walking_skeleton') {
    return journey.walking_skeleton?.status === 'covered'
      ? '最小体験は成立しています。'
      : '最小体験に不足があります。';
  }
  if (slice.slice_id === 'next_slice') {
    return slice.status === 'empty'
      ? '次に伸ばす体験が未定義です。'
      : '次の成長領域が定義されています。';
  }
  if (slice.slice_id === 'hardening') {
    return slice.status === 'present'
      ? '品質、信頼、運用、構造の補強Storyがあります。'
      : '補強Storyはまだありません。';
  }
  return slice.status === 'present' ? 'Storyがあります。' : 'Storyはありません。';
}

function formatReleaseSliceName(slice) {
  const names = {
    walking_skeleton: '最小体験',
    next_slice: '次の成長領域',
    hardening: '信頼性・品質強化'
  };
  return names[slice.slice_id] ?? slice.label ?? slice.slice_id ?? '-';
}

function formatJourneyStatus(status) {
  const statuses = {
    covered: '成立',
    present: 'あり',
    empty: '空',
    needs_evidence: '証跡不足',
    not_applicable: '対象外',
    available: '利用可能',
    missing: '未生成',
    unknown: '不明'
  };
  return statuses[status] ?? status ?? '不明';
}

function sumActivityStories(activity) {
  return (activity.steps ?? []).reduce((sum, step) => sum + (step.story_ids?.length ?? 0), 0);
}

function sumActivityEnablers(activity) {
  return (activity.steps ?? []).reduce((sum, step) => sum + (step.enabler_story_ids?.length ?? 0), 0);
}

function buildStoryLabelIndex(activities) {
  const labels = {};
  for (const activity of activities ?? []) {
    for (const step of activity.steps ?? []) {
      Object.assign(labels, step.story_labels ?? {}, step.enabler_story_labels ?? {});
    }
  }
  return labels;
}

function selectStoryLabels(labels = {}, storyIds = []) {
  return Object.fromEntries(
    [...new Set(storyIds)]
      .map((storyId) => [storyId, labels[storyId] ?? formatStoryIdForHuman(storyId)])
  );
}

function summarizeStoryRefs(storyIds, { limit = 8, labels = {} } = {}) {
  if (!Array.isArray(storyIds) || storyIds.length === 0) return '-';
  const visible = storyIds.slice(0, limit).map((storyId) => formatStoryRefForHuman(storyId, labels));
  const hidden = storyIds.length - visible.length;
  return hidden > 0 ? `${visible.join(', ')} ほか${hidden}件` : visible.join(', ');
}

function formatStoryRefForHuman(storyId, labels = {}) {
  const label = labels[storyId];
  if (label && label !== storyId) return label;
  return formatStoryIdForHuman(storyId);
}

function formatStoryTitleForHuman(title, storyId) {
  const value = String(title ?? '').trim();
  if (!value || value === storyId) return formatStoryIdForHuman(storyId);
  return value.replace(/^["']|["']$/g, '');
}

function formatStoryIdForHuman(storyId) {
  return String(storyId)
    .replace(/^story-/, '')
    .replace(/^vibepro-/, '')
    .replace(/^product-/, '')
    .replace(/-/g, ' ');
}

function renderEvidenceBindings(activities) {
  const rows = [];
  for (const activity of activities) {
    for (const step of activity.steps ?? []) {
      const evidenceByType = new Map();
      for (const evidence of step.evidence ?? []) {
        if (!evidenceByType.has(evidence.type)) evidenceByType.set(evidence.type, []);
        evidenceByType.get(evidence.type).push(evidence.ref);
      }
      const summary = [...evidenceByType.entries()]
        .map(([type, refs]) => `${formatEvidenceType(type)}: ${[...new Set(refs)].slice(0, 6).join(', ')}`)
        .join('; ');
      rows.push(`| ${escapeMarkdownTableCell(`${activity.label}/${step.label}`)} | ${escapeMarkdownTableCell(summarizeStoryRefs(step.story_ids ?? [], { labels: step.story_labels ?? {} }))} | ${escapeMarkdownTableCell(summarizeStoryRefs(step.enabler_story_ids ?? [], { labels: step.enabler_story_labels ?? {} }))} | ${escapeMarkdownTableCell(summary || '-')} |`);
    }
  }
  if (rows.length === 0) return '-';
  return `| ステップ | Story | 補助Story | 証跡 |\n|------|-------|---------|------|\n${rows.join('\n')}`;
}

function formatEvidenceType(type) {
  const labels = {
    source_path: '正本',
    spec_clause: '仕様',
    surface: '対象面',
    gate_evidence: '検証',
    workflow_position: '工程',
    frontmatter: '明示設定'
  };
  return labels[type] ?? type;
}

function renderJourneyCell(activity, slice) {
  const sliceStoryIds = new Set(slice.story_ids ?? []);
  const items = activity.steps
    .map((step) => {
      const storyIds = (step.story_ids ?? []).filter((storyId) => sliceStoryIds.has(storyId));
      const enablerIds = (step.enabler_story_ids ?? []).filter((storyId) => sliceStoryIds.has(storyId));
      if (storyIds.length === 0 && enablerIds.length === 0) return null;
      const suffix = enablerIds.length > 0 ? ` / 補助: ${summarizeStoryRefs(enablerIds, { labels: step.enabler_story_labels ?? {}, limit: 3 })}` : '';
      return `${step.label}: ${summarizeStoryRefs(storyIds, { labels: step.story_labels ?? {}, limit: 3 })}${suffix}`;
    })
    .filter(Boolean);
  return items.length > 0 ? items.join('<br>') : '-';
}

function escapeMarkdownTableCell(value) {
  return String(value ?? '-').replace(/\|/g, '\\|').replace(/\n/g, '<br>');
}

function toPosix(value) {
  return String(value).split(path.sep).join('/');
}

function buildSourceDigest(stories) {
  const input = JSON.stringify(stories.map((story) => ({
    story_id: story.story_id,
    title: story.title,
    updated_at: story.updated_at,
    source_paths: story.source_paths,
    spec_clauses: story.spec_clauses,
    surfaces: story.surfaces,
    gate_evidence: story.gate_evidence
  })));
  return {
    algorithm: 'sha256',
    value: createHash('sha256').update(input).digest('hex')
  };
}

function storyText(story) {
  return [
    story.story_id,
    story.title,
    story.category,
    story.view,
    story.body,
    ...(story.acceptance_focus ?? [])
  ].filter(Boolean).join('\n').toLowerCase();
}

function combineConfidence(a, b) {
  const rank = { high: 3, medium: 2, low: 1, unknown: 0 };
  return (rank[b] ?? 0) < (rank[a] ?? 0) ? b : a;
}

function dedupeEvidence(items) {
  const seen = new Set();
  return items.filter((item) => {
    const key = `${item.type}:${item.ref}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function slugify(value) {
  return String(value ?? '')
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || null;
}
