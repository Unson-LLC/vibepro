import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const FLOW_MAP_SCHEMA_VERSION = '0.1.0';

const ARCHETYPES = [
  ['marketing_landing_page', /\b(marketing|landing|lp|hero|pricing|signup|conversion|lead)\b|ランディング|価格|資料請求|問い合わせ/i],
  ['onboarding_flow', /\b(onboarding|setup|activation|first run|初期設定|導入|オンボーディング)\b/i],
  ['mobile_discovery_flow', /\b(mobile|discovery|search|map|location|find|explore|スマホ|検索|地図|発見)\b/i],
  ['operational_cockpit', /\b(cockpit|dashboard|admin|ops|operation|monitoring|queue|workflow|ダッシュボード|管理|運用)\b/i]
];

export async function createUiuxIaFlowMap(repoRoot, options = {}) {
  const root = path.resolve(repoRoot);
  const storyId = requireStoryId(options);
  const outDir = path.join(root, '.vibepro', 'uiux', storyId);
  const mapPath = path.join(outDir, 'ia-flow-map.json');
  const context = await readFlowMapContext(root, { ...options, storyId });
  const map = buildUiuxIaFlowMap({ storyId, ...context });

  await mkdir(outDir, { recursive: true });
  await writeFile(mapPath, `${JSON.stringify(map, null, 2)}\n`);
  await writeFile(path.join(outDir, 'ia-flow-map.md'), renderUiuxIaFlowMapMarkdown(map));

  return {
    outDir,
    artifact: toRepoPath(root, mapPath),
    markdown_artifact: toRepoPath(root, path.join(outDir, 'ia-flow-map.md')),
    map
  };
}

export async function resolveUiuxIaFlowMapForPlan(repoRoot, options = {}) {
  const result = await createUiuxIaFlowMap(repoRoot, options);
  return {
    map: result.map,
    sourcePath: result.artifact,
    markdownPath: result.markdown_artifact
  };
}

export async function readUiuxIaFlowMapForPr(repoRoot, storyId) {
  const root = path.resolve(repoRoot);
  const candidates = [
    path.join(root, '.vibepro', 'uiux', storyId, 'ia-flow-map.json'),
    path.join(root, '.vibepro', 'design-modernize', storyId, 'ia-flow-map.json')
  ];
  for (const candidate of candidates) {
    try {
      const map = JSON.parse(await readFile(candidate, 'utf8'));
      return summarizeIaFlowMapForPr(map, toRepoPath(root, candidate));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  return {
    status: 'missing',
    artifact: `.vibepro/uiux/${storyId}/ia-flow-map.json`,
    reason: 'Run `vibepro uiux map <repo> --id <story-id>` for UI-heavy stories before PR evidence is finalized.'
  };
}

export function renderUiuxIaFlowMapSummary({ outDir, artifact, map }) {
  return `# UI/UX IA Flow Map

| Item | Value |
|------|-------|
| Story | ${map.story_id} |
| Status | ${map.status} |
| Archetype | ${map.flow_archetype} |
| Structure | ${map.flow_structure} |
| Screens | ${map.screens.length} |
| Artifact | ${artifact} |
| Output | ${outDir} |

## Route Evidence

- Status: ${map.route_evidence.status}
- Source: ${map.route_evidence.source ?? '-'}

## Unknown Flow

${map.unknown_flow.length === 0 ? '- none' : map.unknown_flow.map((item) => `- ${item}`).join('\n')}
`;
}

export function renderUiuxIaFlowMapMarkdown(map) {
  return `# ${map.story_id} IA Flow Map

## Summary

- Status: ${map.status}
- Flow archetype: ${map.flow_archetype}
- Flow structure: ${map.flow_structure}
- Current IA: ${map.current_ia.status}
- Target IA: ${map.target_ia.status}

## Current IA

${map.current_ia.routes.length === 0 ? '- missing route evidence' : map.current_ia.routes.map((route) => `- ${route.route}: ${route.evidence_status}`).join('\n')}

## Target IA

${map.target_ia.sequence.length === 0 ? '- no target sequence confirmed' : map.target_ia.sequence.map((step) => `- ${step.route}: ${step.evidence_status} (${step.role})`).join('\n')}

## Screens

${map.screens.length === 0 ? '- no screens invented without route evidence' : map.screens.map((screen) => `### ${screen.route}

- Purpose: ${screen.purpose}
- Primary decision: ${screen.primary_user_decision}
- Primary CTA: ${screen.primary_cta.label} (${screen.primary_cta.evidence_status})
- Secondary CTA: ${screen.secondary_cta.label} (${screen.secondary_cta.evidence_status})
- Required data: ${screen.required_data.length === 0 ? '-' : screen.required_data.join(', ')}
- States: loading=${screen.states.loading}, empty=${screen.states.empty}, error=${screen.states.error}
- Next screen: ${screen.next_screen ?? '-'}
`).join('\n')}

## Unknown Flow

${map.unknown_flow.length === 0 ? '- none' : map.unknown_flow.map((item) => `- ${item}`).join('\n')}

## Non-goals

${map.non_goals.length === 0 ? '- none declared' : map.non_goals.map((item) => `- ${item}`).join('\n')}
`;
}

function buildUiuxIaFlowMap({ storyId, storyText, storyPath, brief, intake, intakePath, routes, routeSource, journeyContext }) {
  const normalizedRoutes = normalizeRoutes(routes);
  const routeEvidenceStatus = normalizedRoutes.length > 0 ? 'available' : 'missing';
  const routeEvidence = {
    status: routeEvidenceStatus,
    source: normalizedRoutes.length > 0 ? routeSource ?? 'explicit_routes' : null,
    missing_sources: normalizedRoutes.length > 0 ? [] : ['route_list', 'route_discovery_or_explicit_route'],
    routes: normalizedRoutes.map((route) => ({ route, evidence_status: 'confirmed' }))
  };
  const contextText = [
    storyText,
    brief,
    JSON.stringify(intake ?? {}),
    normalizedRoutes.join(' '),
    JSON.stringify(journeyContext ?? {})
  ].join('\n');
  const flowArchetype = inferFlowArchetype(contextText);
  const flowStructure = inferFlowStructure(flowArchetype, contextText);
  const screens = normalizedRoutes.map((route, index) => buildScreen(route, {
    index,
    routes: normalizedRoutes,
    flowArchetype,
    intake,
    storyText
  }));
  const targetSequence = normalizedRoutes.map((route, index) => ({
    route,
    order: index + 1,
    role: inferScreenRole(route, flowArchetype),
    evidence_status: 'proposed',
    reason: 'Target IA is a planning hypothesis until implementation or runtime evidence confirms it.'
  }));
  const unknownFlow = buildUnknownFlow({ normalizedRoutes, storyText, intake, journeyContext });

  return {
    schema_version: FLOW_MAP_SCHEMA_VERSION,
    workflow: 'uiux-ia-flow-map',
    story_id: storyId,
    generated_at: new Date().toISOString(),
    status: normalizedRoutes.length > 0 ? 'ready_for_design_flow' : 'needs_route_evidence',
    flow_archetype: flowArchetype,
    flow_structure: flowStructure,
    source_evidence: {
      story: storyPath,
      uiux_intake: intakePath,
      journey_context: journeyContext?.artifact ?? journeyContext?.artifacts?.context_pack ?? null
    },
    route_evidence: routeEvidence,
    current_ia: {
      status: normalizedRoutes.length > 0 ? 'confirmed_from_route_evidence' : 'missing_route_evidence',
      routes: routeEvidence.routes,
      note: 'Current IA is limited to routes that have explicit or discovered evidence.'
    },
    target_ia: {
      status: normalizedRoutes.length > 0 ? 'proposed_from_story_and_intake' : 'unknown_without_route_evidence',
      evidence_status: normalizedRoutes.length > 0 ? 'proposed' : 'unknown',
      flow_structure: flowStructure,
      sequence: targetSequence,
      target_only_claim_policy: 'target-only claims are proposed until backed by route, runtime, or implementation evidence'
    },
    unknown_flow: unknownFlow,
    non_goals: extractNonGoals(storyText),
    screens
  };
}

async function readFlowMapContext(repoRoot, options) {
  const story = await readStory(repoRoot, options.storyId);
  const intake = await readJsonOptional(repoRoot, options.uiuxIntake ?? path.join('.vibepro', 'uiux', options.storyId, 'uiux-intake.json'));
  const journeyContext = options.journeyContext ?? await readJsonOptional(repoRoot, path.join('.vibepro', 'journey', 'latest-journey.json'));
  return {
    storyText: story.content,
    storyPath: story.path,
    brief: options.brief ?? null,
    intake: intake.value,
    intakePath: intake.path,
    routes: normalizeRoutes(options.routes),
    routeSource: normalizeRoutes(options.routes).length > 0 ? 'explicit_or_discovered_routes' : null,
    journeyContext: journeyContext.value
  };
}

async function readStory(repoRoot, storyId) {
  const candidates = [
    path.join('docs', 'management', 'stories', 'active', `${storyId}.md`),
    path.join('docs', 'management', 'stories', 'backlog', `${storyId}.md`),
    path.join('docs', 'management', 'stories', `${storyId}.md`)
  ];
  for (const candidate of candidates) {
    try {
      return {
        path: candidate,
        content: await readFile(path.join(repoRoot, candidate), 'utf8')
      };
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  return { path: null, content: '' };
}

async function readJsonOptional(repoRoot, artifactPath) {
  const absolutePath = path.isAbsolute(artifactPath) ? artifactPath : path.join(repoRoot, artifactPath);
  try {
    return {
      path: toRepoPath(repoRoot, absolutePath),
      value: JSON.parse(await readFile(absolutePath, 'utf8'))
    };
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return {
      path: toRepoPath(repoRoot, absolutePath),
      value: null
    };
  }
}

function buildScreen(route, { index, routes, flowArchetype, intake, storyText }) {
  return {
    route,
    evidence_status: 'confirmed',
    purpose: inferPurpose(route, flowArchetype),
    primary_user_decision: inferPrimaryDecision(route, flowArchetype),
    primary_cta: {
      label: inferPrimaryCta(route, flowArchetype),
      evidence_status: hasIntakeField(intake, 'component_policy') || storyText ? 'proposed' : 'unknown'
    },
    secondary_cta: {
      label: inferSecondaryCta(route, flowArchetype),
      evidence_status: 'proposed'
    },
    required_data: inferRequiredData(route, flowArchetype),
    states: {
      loading: 'required_unknown_until_screen_evidence',
      empty: 'required_unknown_until_screen_evidence',
      error: 'required_unknown_until_screen_evidence'
    },
    next_screen: routes[index + 1] ?? null
  };
}

function inferFlowArchetype(text) {
  for (const [archetype, pattern] of ARCHETYPES) {
    if (pattern.test(text)) return archetype;
  }
  return 'product_app';
}

function inferFlowStructure(archetype, text) {
  if (/\b(product marketing|marketing.*app|app.*marketing|mixed)\b|プロダクト.*マーケ|マーケ.*プロダクト/i.test(text)) {
    return 'mixed_product_marketing_structure';
  }
  if (archetype === 'marketing_landing_page') return 'landing_page_block_sequence';
  return 'app_task_flow';
}

function inferScreenRole(route, archetype) {
  if (archetype === 'marketing_landing_page') {
    if (/pricing|price|料金|価格/.test(route)) return 'pricing_or_offer';
    if (/contact|signup|register|問い合わせ|申込/.test(route)) return 'conversion';
    return 'landing_information_block';
  }
  if (/settings|config|設定/.test(route)) return 'configuration';
  if (/dashboard|admin|cockpit|管理/.test(route)) return 'overview_and_prioritization';
  if (/detail|\[[^\]]+\]/.test(route)) return 'detail_decision';
  return 'task_step';
}

function inferPurpose(route, archetype) {
  const role = inferScreenRole(route, archetype);
  return role.replace(/_/g, ' ');
}

function inferPrimaryDecision(route, archetype) {
  if (archetype === 'marketing_landing_page') return 'whether_to_continue_to_conversion';
  if (inferScreenRole(route, archetype) === 'overview_and_prioritization') return 'which_item_or_workflow_needs_attention';
  if (inferScreenRole(route, archetype) === 'detail_decision') return 'whether_to_act_on_this_item';
  return 'what_the_next_task_step_should_be';
}

function inferPrimaryCta(route, archetype) {
  if (archetype === 'marketing_landing_page') return /pricing|price/.test(route) ? 'compare_plan' : 'continue_to_conversion';
  if (/settings|config|設定/.test(route)) return 'save_or_continue_setup';
  if (/detail|\[[^\]]+\]/.test(route)) return 'act_on_detail';
  return 'continue_task';
}

function inferSecondaryCta(route, archetype) {
  if (archetype === 'marketing_landing_page') return 'learn_more';
  if (/settings|config|設定/.test(route)) return 'cancel_or_back';
  return 'review_context';
}

function inferRequiredData(route, archetype) {
  if (archetype === 'marketing_landing_page') return ['offer_content', 'trust_or_proof_points'];
  if (/detail|\[[^\]]+\]/.test(route)) return ['record_detail', 'available_actions'];
  if (/dashboard|admin|cockpit|管理/.test(route)) return ['prioritized_items', 'status_counts'];
  return ['task_context'];
}

function buildUnknownFlow({ normalizedRoutes, storyText, intake, journeyContext }) {
  const unknown = [];
  if (normalizedRoutes.length === 0) {
    unknown.push('No route evidence is available; current IA and screen sequence are not inferred.');
  }
  if (!storyText) {
    unknown.push('Story document was not found, so target flow intent is limited.');
  }
  if (!intake) {
    unknown.push('Structured UI/UX intake is missing; target decisions and CTAs remain proposed.');
  }
  if (!journeyContext) {
    unknown.push('Journey context artifact is missing or not readable; cross-screen continuity is not confirmed.');
  }
  return unknown;
}

function extractNonGoals(text) {
  const lines = String(text ?? '').split(/\r?\n/);
  const nonGoals = [];
  let inSection = false;
  for (const line of lines) {
    if (/^##?\s+Non-goals/i.test(line) || /^##?\s+非目標/.test(line)) {
      inSection = true;
      continue;
    }
    if (inSection && /^##?\s+/.test(line)) break;
    if (inSection && /^\s*-\s+/.test(line)) {
      nonGoals.push(line.replace(/^\s*-\s+/, '').trim());
    }
  }
  return nonGoals;
}

function summarizeIaFlowMapForPr(map, artifact) {
  return {
    status: map.status ?? 'available',
    artifact,
    flow_archetype: map.flow_archetype ?? null,
    flow_structure: map.flow_structure ?? null,
    current_ia_status: map.current_ia?.status ?? null,
    target_ia_status: map.target_ia?.status ?? null,
    target_evidence_status: map.target_ia?.evidence_status ?? null,
    route_evidence_status: map.route_evidence?.status ?? null,
    screen_count: Array.isArray(map.screens) ? map.screens.length : 0
  };
}

function hasIntakeField(intake, fieldId) {
  const field = intake?.fields?.[fieldId];
  return field && field.status !== 'missing' && field.value !== null && field.value !== '';
}

function normalizeRoutes(routes = []) {
  if (!Array.isArray(routes)) return [];
  return [...new Set(routes.map((route) => String(route).trim()).filter(Boolean))];
}

function requireStoryId(options) {
  const storyId = options.storyId ?? options.id;
  if (!storyId) throw new Error('UI/UX IA flow map requires --id <story-id>.');
  return storyId;
}

function toRepoPath(repoRoot, absolutePath) {
  return path.relative(repoRoot, absolutePath).split(path.sep).join('/');
}
