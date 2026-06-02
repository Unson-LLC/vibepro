import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { getWorkspaceDir, initWorkspace, readManifest, toWorkspaceRelative, writeManifest } from './workspace.js';

const JOURNEY_SCHEMA_VERSION = '0.1.0';
const DEFAULT_JOURNEY_ID = 'default-product-journey';
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
      question: `${story.story_id} をJourney stepへ配置するか、enabler/cross-cuttingとして扱うか確認する。`,
      blocker: false,
      story_id: story.story_id
    }))
  ];
  const generatedAt = new Date().toISOString();
  const journey = {
    schema_version: JOURNEY_SCHEMA_VERSION,
    journey_id: options.journeyId ?? DEFAULT_JOURNEY_ID,
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

  const journeyDir = path.join(getWorkspaceDir(root), 'journey');
  const historyDir = path.join(journeyDir, 'history');
  await mkdir(historyDir, { recursive: true });
  const latestJsonPath = path.join(journeyDir, 'latest-journey.json');
  const latestMarkdownPath = path.join(journeyDir, 'latest-journey.md');
  const historyJsonPath = path.join(historyDir, `${generatedAt.replace(/\.\d{3}Z$/, 'Z').replace(/:/g, '')}.json`);
  const markdown = renderJourneyMapMarkdown(journey);
  await writeFile(latestJsonPath, `${JSON.stringify(journey, null, 2)}\n`);
  await writeFile(latestMarkdownPath, markdown);
  await writeFile(historyJsonPath, `${JSON.stringify(journey, null, 2)}\n`);

  manifest.artifacts = {
    ...(manifest.artifacts ?? {}),
    latest_journey: toWorkspaceRelative(root, latestJsonPath),
    latest_journey_markdown: toWorkspaceRelative(root, latestMarkdownPath)
  };
  manifest.journey = {
    schema_version: JOURNEY_SCHEMA_VERSION,
    latest_journey: toWorkspaceRelative(root, latestJsonPath),
    latest_journey_markdown: toWorkspaceRelative(root, latestMarkdownPath),
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

export async function getJourneyStatus(repoRoot) {
  const journey = await readLatestJourneyMap(repoRoot);
  if (!journey) {
    return {
      schema_version: JOURNEY_SCHEMA_VERSION,
      status: 'missing',
      reason: 'Journey Map is not generated. Run `vibepro journey derive <repo>`.',
      journey: null
    };
  }
  return {
    schema_version: JOURNEY_SCHEMA_VERSION,
    status: journey.conflicts?.length > 0
      ? 'conflict'
      : journey.walking_skeleton?.status === 'needs_evidence'
        ? 'needs_evidence'
        : 'available',
    generated_at: journey.generated_at,
    journey_id: journey.journey_id,
    source_story_count: journey.source_story_ids?.length ?? 0,
    activity_count: journey.backbone?.length ?? 0,
    walking_skeleton_status: journey.walking_skeleton?.status ?? 'unknown',
    conflict_count: journey.conflicts?.length ?? 0,
    open_question_count: journey.open_questions?.length ?? 0,
    journey
  };
}

export function summarizeJourneyForPr(journey, storyId = null) {
  if (!journey) {
    return {
      status: 'missing',
      reason: 'Journey Map is not generated. Run `vibepro journey derive <repo>` to surface latest user Journey context.',
      current_story: null
    };
  }
  const storyPlacement = findStoryPlacement(journey, storyId);
  return {
    status: journey.conflicts?.length > 0
      ? 'conflict'
      : journey.walking_skeleton?.status === 'needs_evidence'
        ? 'needs_evidence'
        : 'available',
    generated_at: journey.generated_at,
    journey_id: journey.journey_id,
    walking_skeleton_status: journey.walking_skeleton?.status ?? 'unknown',
    conflict_count: journey.conflicts?.length ?? 0,
    open_question_count: journey.open_questions?.length ?? 0,
    current_story: storyPlacement,
    affected_release_slices: storyPlacement
      ? (journey.release_slices ?? [])
        .filter((slice) => (slice.story_ids ?? []).includes(storyId))
        .map((slice) => ({ slice_id: slice.slice_id, kind: slice.kind, label: slice.label }))
      : []
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
- source stories: ${status.source_story_count}
- activities: ${status.activity_count}
- walking skeleton: ${status.walking_skeleton_status}
- conflicts: ${status.conflict_count}
- open questions: ${status.open_question_count}
`;
}

export function renderJourneyPrSection(summary) {
  if (!summary || summary.status === 'missing') {
    return `## Journey Map
- Status: missing
- Action: ${summary?.reason ?? 'Run `vibepro journey derive <repo>` to generate latest Journey context.'}`;
  }
  const current = summary.current_story;
  const slices = summary.affected_release_slices.length > 0
    ? summary.affected_release_slices.map((slice) => `${slice.slice_id} (${slice.kind})`).join(', ')
    : '-';
  return `## Journey Map
- Status: ${summary.status}
- Generated: ${summary.generated_at}
- Walking skeleton: ${summary.walking_skeleton_status}
- Current Story step: ${current ? `${current.activity_id}/${current.step_id} (${current.placement_kind})` : '-'}
- Affected release slices: ${slices}
- Conflicts: ${summary.conflict_count}
- Open questions: ${summary.open_question_count}`;
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
  const graphPath = path.join(getWorkspaceDir(root), 'graphify', 'graph.json');
  let graph;
  try {
    graph = JSON.parse(await readFile(graphPath, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
  const relativeGraphPath = toWorkspaceRelative(root, graphPath);
  const entries = [];
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
  return entries;
}

async function readGateEvidence(root) {
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
    ...Object.fromEntries(Object.entries(b).filter(([, value]) => value !== null && value !== undefined && value !== '')),
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
        enabler_story_ids: [],
        evidence: [],
        confidence: placement.confidence
      });
    }
    const step = activity.steps.get(placement.step_id);
    const target = placement.placement_kind === 'enabler' ? step.enabler_story_ids : step.story_ids;
    target.push(placement.story_id);
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
        enabler_story_ids: [...new Set(step.enabler_story_ids)],
        evidence: dedupeEvidence(step.evidence)
      }))
    }));
}

function buildReleaseSlices(placements, backbone) {
  return RELEASE_SLICE_ORDER.slice(0, 3).map((sliceId) => {
    const placed = placements.filter((placement) => placement.release_slice === sliceId);
    return {
      slice_id: sliceId,
      label: sliceId === 'walking_skeleton' ? 'Walking Skeleton' : sliceId === 'next_slice' ? 'Next Slice' : 'Hardening',
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

function renderJourneyMapMarkdown(journey) {
  const activities = journey.backbone ?? [];
  const slices = journey.release_slices ?? [];
  const header = ['Release Slice', ...activities.map((activity) => activity.label)].join(' | ');
  const divider = ['---', ...activities.map(() => '---')].join(' | ');
  const rows = slices.map((slice) => [
    `${slice.label} (${slice.status})`,
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
  return `# Latest Journey Map

| 項目 | 内容 |
|------|------|
| Journey ID | ${journey.journey_id} |
| Generated | ${journey.generated_at} |
| Source Stories | ${journey.source_story_ids?.length ?? 0} |
| Walking Skeleton | ${journey.walking_skeleton?.status ?? 'unknown'} |
| Conflicts | ${journey.conflicts?.length ?? 0} |
| Open Questions | ${journey.open_questions?.length ?? 0} |

## Patton-style Map

| ${header} |
| ${divider} |
${rows.map((row) => `| ${row} |`).join('\n')}

## Walking Skeleton

- Status: ${journey.walking_skeleton?.status ?? 'unknown'}
- Required steps: ${(journey.walking_skeleton?.required_step_ids ?? []).join(', ') || '-'}
- Covered steps: ${(journey.walking_skeleton?.covered_step_ids ?? []).join(', ') || '-'}
- Story IDs: ${(journey.walking_skeleton?.story_ids ?? []).join(', ') || '-'}

## Evidence Bindings

${evidenceBindings}

## Conflicts

${conflicts}

## Unplaced Stories

${unplaced}

## Open Questions

${questions}
`;
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
        .map(([type, refs]) => `${type}: ${[...new Set(refs)].slice(0, 6).join(', ')}`)
        .join('; ');
      rows.push(`| ${activity.activity_id}/${step.step_id} | ${(step.story_ids ?? []).join(', ') || '-'} | ${(step.enabler_story_ids ?? []).join(', ') || '-'} | ${summary || '-'} |`);
    }
  }
  if (rows.length === 0) return '-';
  return `| Step | Stories | Enablers | Evidence |\n|------|---------|----------|----------|\n${rows.join('\n')}`;
}

function renderJourneyCell(activity, slice) {
  const sliceStoryIds = new Set(slice.story_ids ?? []);
  const items = activity.steps
    .map((step) => {
      const storyIds = (step.story_ids ?? []).filter((storyId) => sliceStoryIds.has(storyId));
      const enablerIds = (step.enabler_story_ids ?? []).filter((storyId) => sliceStoryIds.has(storyId));
      if (storyIds.length === 0 && enablerIds.length === 0) return null;
      const suffix = enablerIds.length > 0 ? ` enabler:${enablerIds.join(',')}` : '';
      return `${step.label}: ${storyIds.join(',') || '-'}${suffix}`;
    })
    .filter(Boolean);
  return items.length > 0 ? items.join('<br>') : '-';
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
