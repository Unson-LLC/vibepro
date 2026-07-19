import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
  buildGraphContextForFiles,
  buildGraphIndex,
  normalizeGraphEdges
} from './graph-context.js';
import { generateStoryCatalog, renderStoryCatalogMap } from './story-catalog-generator.js';
import { bindStoryTraceability } from './traceability.js';
import { renderStoryReportHtml } from './story-html.js';
import { getJourneyStatus } from './journey-map.js';
import { DEFAULT_BRAINBASE_STORIES, getWorkspaceDir, initWorkspace, readManifest, toWorkspaceRelative, writeManifest, WORKSPACE_DIR } from './workspace.js';
import { readStoryTasks } from './story-task-generator.js';
import { resolveArtifactRoute, resolveGraphifyArtifactFile } from './artifact-routing.js';

const STORY_FIELDS = [
  ['--id', 'story_id'],
  ['--title', 'title'],
  ['--horizon', 'horizon'],
  ['--view', 'view'],
  ['--period', 'period'],
  ['--started-at', 'started_at'],
  ['--due-at', 'due_at']
];

const DEFAULT_STORY_JOURNEY_ID = 'default-product-journey';

const STORY_DOCUMENT_DIRS = [
  path.join('docs', 'management', 'stories', 'active'),
  path.join('docs', 'user_stories', 'active'),
  path.join('docs', 'stories')
];

const STORY_JOURNEY_PATTERNS = [
  ['UI', /\bui\b/i],
  ['UX', /\bux\b/i],
  ['screen', /\bscreens?\b/i],
  ['page', /\bpages?\b/i],
  ['navigation', /\bnavigation\b/i],
  ['touchpoint', /\btouchpoints?\b/i],
  ['user flow', /\buser\s+flows?\b/i],
  ['user journey', /\buser\s+journey\b/i],
  ['customer journey', /\bcustomer\s+journey\b/i],
  ['operation path', /\boperation\s+paths?\b/i],
  ['primary operation', /\bprimary\s+operation\b/i],
  ['CTA', /\bcta\b/i],
  ['interaction', /\binteractions?\b/i],
  ['画面', /画面/],
  ['導線', /導線/],
  ['ナビゲーション', /ナビゲーション/],
  ['タッチポイント', /タッチポイント/],
  ['ユーザーフロー', /ユーザーフロー/],
  ['ユーザーの流れ', /ユーザーの流れ/],
  ['操作導線', /操作導線/],
  ['操作パス', /操作パス/],
  ['UI体験', /UI体験/i],
  ['ユーザー体験', /ユーザー体験/],
  ['対応面', /対応面/],
  ['Journey', /Journey/i],
  ['ジャーニー', /ジャーニー/]
];

export async function addStory(repoRoot, options = {}) {
  const root = path.resolve(repoRoot);
  const config = await readConfig(root);
  const story = buildStory(options);
  const stories = getStories(config);
  if (stories.some((item) => item.story_id === story.story_id)) {
    throw new Error(`Story already exists: ${story.story_id}`);
  }
  config.brainbase = {
    ...(config.brainbase ?? {}),
    stories: [...stories, story]
  };
  await writeConfig(root, config);
  await bindStoryTraceability(root, {
    storyId: story.story_id,
    source: 'story_add',
    lifecycle: 'declared_not_started'
  });
  return story;
}

export async function listStories(repoRoot, options = {}) {
  const config = await readConfig(path.resolve(repoRoot));
  const stories = getStories(config);
  const visibleStories = options.includeArchived ? stories : stories.filter((story) => !isArchived(story));
  return {
    current_story_id: config.brainbase?.current_story_id ?? null,
    stories: visibleStories
  };
}

export async function selectStory(repoRoot, storyId) {
  if (!storyId) throw new Error('--id is required');
  const root = path.resolve(repoRoot);
  const config = await readConfig(root);
  const story = getStories(config).find((item) => item.story_id === storyId);
  if (!story) throw new Error(`Story not found: ${storyId}`);
  if (isArchived(story)) throw new Error(`Archived story cannot be selected: ${storyId}`);
  config.brainbase = {
    ...(config.brainbase ?? {}),
    current_story_id: storyId
  };
  await writeConfig(root, config);
  return story;
}

export async function archiveStory(repoRoot, storyId) {
  if (!storyId) throw new Error('--id is required');
  const root = path.resolve(repoRoot);
  const config = await readConfig(root);
  const stories = getStories(config);
  const story = stories.find((item) => item.story_id === storyId);
  if (!story) throw new Error(`Story not found: ${storyId}`);
  story.status = 'archived';
  if (config.brainbase?.current_story_id === storyId) {
    config.brainbase.current_story_id = null;
  }
  await writeConfig(root, config);
  return story;
}

export async function getStoryRuns(repoRoot, storyId = null) {
  const root = path.resolve(repoRoot);
  const config = await readConfig(root);
  const manifest = await readManifest(root);
  const story = resolveStory(config, storyId);
  const runs = getRunsForStory(manifest, story.story_id);
  return { story, runs };
}

export async function getStoryStatus(repoRoot, storyId = null) {
  const root = path.resolve(repoRoot);
  const config = await readConfig(root);
  const manifest = await readManifest(root);
  const story = resolveStory(config, storyId);
  const runs = getRunsForStory(manifest, story.story_id);
  const latestRun = findLatestStoryRun(manifest, story.story_id, runs);
  const evidence = latestRun ? await readRunEvidence(root, latestRun) : null;
  const journeyContext = await buildStoryJourneyContext(root, story);
  return {
    story,
    latestRun,
    runs,
    findingCount: evidence?.findings?.length ?? 0,
    artifacts: latestRun?.artifacts ?? {},
    journey_context: journeyContext
  };
}

export async function createStoryReport(repoRoot, storyId = null) {
  const root = path.resolve(repoRoot);
  const config = await readConfig(root);
  const manifest = await readManifest(root);
  const story = resolveStory(config, storyId);
  const runs = getRunsForStory(manifest, story.story_id);
  const latestRun = findLatestStoryRun(manifest, story.story_id, runs);
  if (!latestRun) throw new Error(`Story diagnosis run not found: ${story.story_id}`);
  const evidence = await readRunEvidence(root, latestRun);
  const taskState = await readStoryTasks(root, latestRun.artifacts?.story_tasks_json);
  const journeyContext = await buildStoryJourneyContext(root, story);
  const storyDir = path.join(getWorkspaceDir(root), 'stories', story.story_id);
  await mkdir(storyDir, { recursive: true });
  const reportPath = path.join(storyDir, 'story-report.md');
  await writeFile(reportPath, renderStoryReport({ story, latestRun, runs, evidence, taskState, journeyContext }));
  const htmlPath = path.join(storyDir, 'index.html');
  const graphHtmlRel = toWorkspaceRelative(root, await resolveGraphifyArtifactFile(root, story.story_id, 'graph.html'));
  await writeFile(htmlPath, renderStoryReportHtml({
    story,
    latestRun,
    runs,
    evidence,
    repoRoot: root,
    storyDir,
    graphHtmlPath: graphHtmlRel,
    storyReportMdPath: reportPath,
    storyTasksMdPath: latestRun.artifacts?.story_tasks_markdown ?? null,
    journeyContext
  }));
  manifest.stories = {
    ...(manifest.stories ?? {}),
    [story.story_id]: {
      ...(manifest.stories?.[story.story_id] ?? {}),
      latest_report: toWorkspaceRelative(root, reportPath),
      latest_report_html: toWorkspaceRelative(root, htmlPath),
      latest_report_run_id: latestRun.run_id,
      latest_report_generated_at: new Date().toISOString()
    }
  };
  await writeManifest(root, manifest);
  return { story, latestRun, reportPath, htmlPath, journeyContext };
}

export async function deriveStories(repoRoot, options = {}) {
  const root = path.resolve(repoRoot);
  const config = await readConfig(root);
  const manifest = await readManifest(root);
  const previousCatalog = await readExistingStoryCatalog(root);
  let catalog;
  try {
    catalog = await generateStoryCatalog(root, {
      config,
      manifest,
      fromRunId: options.fromRunId,
      preset: options.preset
    });
  } catch (error) {
    await writeStoryDeriveFailure(root, error, {
      fromRunId: options.fromRunId,
      preset: options.preset
    });
    throw error;
  }
  const storyDir = path.join(getWorkspaceDir(root), 'stories');
  await mkdir(storyDir, { recursive: true });
  const catalogPath = path.join(storyDir, 'story-catalog.json');
  const mapPath = path.join(storyDir, 'story-map.md');
  const mergeResult = mergeDerivedStories(config, catalog.stories, previousCatalog);

  await writeFile(catalogPath, `${JSON.stringify(catalog, null, 2)}\n`);
  await writeFile(mapPath, renderStoryCatalogMap(catalog));
  await writeConfig(root, config);

  manifest.artifacts = {
    ...(manifest.artifacts ?? {}),
    story_catalog: toWorkspaceRelative(root, catalogPath),
    story_map: toWorkspaceRelative(root, mapPath)
  };
  manifest.story_catalog = {
    generated_at: catalog.generated_at,
    story_count: catalog.story_count,
    added_count: mergeResult.added_count,
    archived_count: mergeResult.archived_count,
    updated_count: mergeResult.updated_count,
    skipped_count: mergeResult.skipped_count,
    artifact: toWorkspaceRelative(root, catalogPath)
  };
  await writeManifest(root, manifest);

  return {
    catalog,
    catalogPath,
    mapPath,
    added_count: mergeResult.added_count,
    archived_count: mergeResult.archived_count,
    updated_count: mergeResult.updated_count,
    skipped_count: mergeResult.skipped_count
  };
}

async function writeStoryDeriveFailure(root, error, options = {}) {
  const runId = `story-derive-failure-${new Date().toISOString().replace(/\.\d{3}Z$/, 'Z').replace(/:/g, '')}`;
  const runDir = path.join(getWorkspaceDir(root), 'diagnostics', runId);
  await mkdir(runDir, { recursive: true });
  const graphStats = await readGraphStatsForFailure(root, options.storyId ?? options.id ?? 'story-default');
  const failure = {
    schema_version: '0.1.0',
    run_id: runId,
    command: 'story derive',
    status: 'failed',
    created_at: new Date().toISOString(),
    options,
    error: {
      name: error?.name ?? 'Error',
      message: error?.message ?? String(error),
      stack: error?.stack ?? null
    },
    graphify: graphStats
  };
  const jsonPath = path.join(runDir, 'failure.json');
  const markdownPath = path.join(runDir, 'failure.md');
  await writeFile(jsonPath, `${JSON.stringify(failure, null, 2)}\n`);
  await writeFile(markdownPath, renderStoryDeriveFailure(failure));
}

async function readGraphStatsForFailure(root, storyId) {
  try {
    const graph = JSON.parse(await readFile(await resolveGraphifyArtifactFile(root, storyId), 'utf8'));
    const edges = Array.isArray(graph?.edges) ? graph.edges : Array.isArray(graph?.links) ? graph.links : [];
    return {
      available: true,
      node_count: Array.isArray(graph?.nodes) ? graph.nodes.length : 0,
      edge_count: edges.length,
      edge_source_key: Array.isArray(graph?.edges) ? 'edges' : Array.isArray(graph?.links) ? 'links' : null
    };
  } catch (graphError) {
    return {
      available: false,
      reason: graphError.code === 'ENOENT' ? 'graphify graph.json not found' : graphError.message
    };
  }
}

function renderStoryDeriveFailure(failure) {
  return `# Story Derive Failure

- run_id: ${failure.run_id}
- status: ${failure.status}
- error: ${failure.error.message}
- graph nodes: ${failure.graphify?.node_count ?? '-'}
- graph edges: ${failure.graphify?.edge_count ?? '-'}

## Next Actions

- Re-run \`vibepro story derive\` after fixing the reported error.
- If this happened on a graphify graph with cycles or many nodes, attach this failure directory to the issue.
`;
}

export async function readStoryMap(repoRoot) {
  const root = path.resolve(repoRoot);
  await initWorkspace(root);
  const catalogPath = path.join(getWorkspaceDir(root), 'stories', 'story-catalog.json');
  try {
    const catalog = JSON.parse(await readFile(catalogPath, 'utf8'));
    return { catalog, catalogPath };
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new Error('Story catalog not found. Run `vibepro story derive` first.');
    }
    throw error;
  }
}

export async function createStoryPlan(repoRoot, options = {}) {
  const root = path.resolve(repoRoot);
  const config = await readConfig(root);
  const manifest = await readManifest(root);
  const { catalog, catalogPath } = await readStoryMap(root);
  const graphIndex = await readStoryPlanGraphIndex(root, config.brainbase?.current_story_id ?? 'story-default');
  const limit = Number.isInteger(options.limit) && options.limit > 0 ? options.limit : 5;
  const explicitStoryTasks = await readExplicitStoryTasks(root, catalog);
  const plan = buildStoryExecutionPlan(catalog, { limit, graphIndex, explicitStoryTasks });
  const storyDir = path.join(getWorkspaceDir(root), 'stories');
  await mkdir(storyDir, { recursive: true });
  const planPath = path.join(storyDir, 'story-plan.json');
  const markdownPath = path.join(storyDir, 'story-plan.md');
  await writeFile(planPath, `${JSON.stringify(plan, null, 2)}\n`);
  await writeFile(markdownPath, renderStoryPlan(plan));
  manifest.artifacts = {
    ...(manifest.artifacts ?? {}),
    story_plan: toWorkspaceRelative(root, planPath),
    story_plan_markdown: toWorkspaceRelative(root, markdownPath)
  };
  manifest.story_plan = {
    generated_at: plan.generated_at,
    source_catalog: toWorkspaceRelative(root, catalogPath),
    priority_story_count: plan.priority_stories.length,
    question_count: plan.questions.length,
    artifact: toWorkspaceRelative(root, planPath)
  };
  await writeManifest(root, manifest);
  return { plan, planPath, markdownPath };
}

async function readStoryPlanGraphIndex(root, storyId) {
  try {
    const graph = JSON.parse(await readFile(await resolveGraphifyArtifactFile(root, storyId), 'utf8'));
    const nodes = Array.isArray(graph.nodes) ? graph.nodes : [];
    const { edges } = normalizeGraphEdges(graph);
    return buildGraphIndex({ nodes, edges });
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

export function parseStoryOptions(args) {
  const options = {};
  for (const [flag, key] of STORY_FIELDS) {
    const value = getOption(args, flag);
    if (value !== null) options[key] = value;
  }
  return options;
}

export function renderStoryDeriveSummary(result) {
  return `# Story Derive

| 項目 | 内容 |
|------|------|
| Story候補 | ${result.catalog.story_count} |
| 追加 | ${result.added_count} |
| 意味づけ更新 | ${result.updated_count} |
| 不要化してアーカイブ | ${result.archived_count} |
| 既存のためスキップ | ${result.skipped_count} |
| Catalog | ${toWorkspaceRelativeFromAny(result.catalogPath)} |
| Map | ${toWorkspaceRelativeFromAny(result.mapPath)} |

${renderStoryDeriveWarnings(result.catalog)}

${renderStoryMapCatalog(result.catalog)}`;
}

function renderStoryDeriveWarnings(catalog) {
  const warnings = catalog.source?.warnings ?? [];
  if (warnings.length === 0) return 'Warnings: なし';
  return `Warnings:\n${warnings.map((warning) => `- ${warning.message ?? warning.code}`).join('\n')}`;
}

export function renderStoryMap(result) {
  return renderStoryMapCatalog(result.catalog);
}

export function renderStoryPlanSummary(result) {
  return `# Story Plan

| 項目 | 内容 |
|------|------|
| 生成日時 | ${result.plan.generated_at} |
| Story数 | ${result.plan.summary.story_count} |
| Coverage | ${result.plan.summary.coverage_status} (${formatPercent(result.plan.summary.coverage_ratio)}) |
| 確認質問 | ${result.plan.questions.length} |
| 優先Story | ${result.plan.priority_stories.length} |
| Plan | ${toWorkspaceRelativeFromAny(result.planPath)} |
| Markdown | ${toWorkspaceRelativeFromAny(result.markdownPath)} |

${renderStoryPlan(result.plan)}`;
}

export function renderStoryList(result) {
  if (result.stories.length === 0) return 'No active stories.\n';
  return `${result.stories.map((story) => {
    const marker = story.story_id === result.current_story_id ? '*' : '-';
    const status = story.status ?? 'active';
    const view = story.view ?? '-';
    const period = story.period ?? '-';
    return `${marker} ${story.story_id} | ${story.title} | ${status} | view:${view} | period:${period}`;
  }).join('\n')}\n`;
}

export function renderStoryRuns(result) {
  if (result.runs.length === 0) {
    return `# Story Runs\n\n| Story ID | ${result.story.story_id} |\n| Latest run | - |\n\nNo diagnosis runs.\n`;
  }
  return `# Story Runs

| Story ID | ${result.story.story_id} |
| Story | ${result.story.title} |

| Run ID | Created At | Gate | Evidence |
|--------|------------|------|----------|
${result.runs.map((run) => `| ${run.run_id} | ${run.created_at ?? '-'} | ${run.gate_status ?? '-'} | ${run.artifacts?.evidence ?? '-'} |`).join('\n')}
`;
}

export function renderStoryStatus(result) {
  const latestRun = result.latestRun;
  return `# Story Status

| 項目 | 内容 |
|------|------|
| Story ID | ${result.story.story_id} |
| Story | ${result.story.title} |
| Status | ${result.story.status ?? 'active'} |
| View | ${result.story.view ?? '-'} |
| Period | ${result.story.period ?? '-'} |
| Latest run | ${latestRun?.run_id ?? '-'} |
| Gate | ${latestRun?.gate_status ?? '-'} |
| Findings | ${result.findingCount} |
| Runs | ${result.runs.length} |

## Artifacts

${Object.entries(result.artifacts).length === 0 ? '- なし' : Object.entries(result.artifacts).map(([key, value]) => `- ${key}: ${value}`).join('\n')}

${renderStoryJourneyContext(result.journey_context)}
`;
}

export function renderStoryReport({ story, latestRun, runs, evidence, taskState = null, journeyContext = null }) {
  const graphify = evidence?.graphify ?? {};
  const architectureProfile = evidence?.architecture_profile ?? {};
  const applicableChecks = evidence?.check_catalog?.applicable_checks ?? architectureProfile.applicable_checks ?? [];
  const apiBoundary = evidence?.api_boundary ?? null;
  const staticSite = evidence?.static_site ?? {};
  const findings = Array.isArray(evidence?.findings) ? evidence.findings : [];
  const findingReview = evidence?.finding_review ?? {};
  const actionCandidates = Array.isArray(evidence?.action_candidates) ? evidence.action_candidates : [];
  const refactoringCampaigns = Array.isArray(evidence?.refactoring_campaigns) ? evidence.refactoring_campaigns : [];
  const tasks = Array.isArray(taskState?.tasks) ? taskState.tasks : [];
  const artifacts = latestRun.artifacts ?? {};
  const scanHeading = architectureProfile.app_type === 'static_site' ? '静的サイト診断' : '共通スキャン';
  return `# Story診断レポート

## Story

| 項目 | 内容 |
|------|------|
| Story ID | ${story.story_id} |
| Story | ${story.title} |
| Status | ${story.status ?? 'active'} |
| View | ${story.view ?? '-'} |
| Period | ${story.period ?? '-'} |

## 最新run

| 項目 | 内容 |
|------|------|
| Run ID | ${latestRun.run_id} |
| Gate | ${latestRun.gate_status ?? '-'} |
| Created At | ${latestRun.created_at ?? '-'} |
| Story run数 | ${runs.length} |

${renderStoryJourneyContext(journeyContext)}

## graphify集計

| 項目 | 内容 |
|------|------|
| graphify nodes | ${graphify.node_count ?? 0} |
| graphify edges | ${graphify.edge_count ?? 0} |
| extracted edges | ${graphify.extracted_edges?.length ?? 0} |
| inferred edges | ${graphify.inferred_edges?.length ?? 0} |
| ambiguous edges | ${graphify.ambiguous_edges?.length ?? 0} |

## 構造プロファイル

| 項目 | 内容 |
|------|------|
| 種別 | ${architectureProfile.app_type ?? 'unknown'} |
| System type | ${architectureProfile.system_type ?? 'unknown'} |
| 描画方式 | ${architectureProfile.rendering ?? '-'} |
| API route | ${architectureProfile.has_api_routes ? 'あり' : 'なし'} |
| DB | ${architectureProfile.has_database ? (architectureProfile.database ?? []).join(', ') || 'あり' : 'なし'} |
| 認証 | ${architectureProfile.has_auth ? (architectureProfile.auth ?? []).join(', ') || 'あり' : 'なし'} |
| 適用チェック | ${applicableChecks.join(', ') || '-'} |

### View

${renderStoryArchitectureViews(architectureProfile.views ?? {})}

## API境界

${renderStoryApiBoundary(apiBoundary)}

## ${scanHeading}

| 項目 | 内容 |
|------|------|
| index.html | ${staticSite.has_index_html ? 'あり' : 'なし'} |
| scanned files | ${staticSite.scanned_files ?? 0} |
| secret hits | ${formatRiskCount(staticSite.secret_hits?.length ?? 0, staticSite.risk_summary?.secret_hits)} |
| XSS risk hits | ${formatRiskCount(staticSite.xss_risk_hits?.length ?? 0, staticSite.risk_summary?.xss_risk_hits)} |
| external resources | ${staticSite.external_resources?.length ?? 0} |
| non static files | ${staticSite.non_static_files?.length ?? 0} |
| refactoring campaigns | ${refactoringCampaigns.length} |

## 検出事項

${findings.length === 0 ? '- なし' : findings.map((finding) => `- ${finding.id}: ${finding.title}（${finding.severity}）`).join('\n')}

## 診断レビュー

${renderStoryFindingReview(findingReview)}

## 次アクション候補

${renderStoryActionCandidates(actionCandidates)}

## 生成タスク

${renderGeneratedTasks(tasks)}

## Artifacts

${Object.entries(artifacts).length === 0 ? '- なし' : Object.entries(artifacts).map(([key, value]) => `- ${key}: ${value}`).join('\n')}

## 次に見るファイル

- ${artifacts.summary ?? '-'}
- ${artifacts.risk_register ?? '-'}
- ${artifacts.evidence ?? '-'}
`;
}

async function buildStoryJourneyContext(root, story) {
  const detection = await detectStoryJourneyImpact(root, story);
  if (!detection.required) {
    return {
      required: false,
      status: 'not_required',
      artifact_kind: null,
      curation_status: 'not_required',
      curated: false,
      handoff_available: false,
      journey_id: DEFAULT_STORY_JOURNEY_ID,
      reason: detection.reason,
      detection,
      next_actions: []
    };
  }

  const status = await getJourneyStatus(root, { journeyId: DEFAULT_STORY_JOURNEY_ID });
  return {
    required: true,
    status: status.status,
    artifact_kind: status.artifact_kind,
    curation_status: status.curation_status,
    curated: Boolean(status.curated),
    curated_journey_path: status.curated_journey_path ?? null,
    handoff_available: Boolean(status.handoff_available),
    journey_id: status.journey_id ?? DEFAULT_STORY_JOURNEY_ID,
    reason: status.reason ?? null,
    detection,
    next_actions: buildStoryJourneyNextActions(status)
  };
}

async function detectStoryJourneyImpact(root, story) {
  const documents = await readStoryJourneyDocuments(root, story);
  const haystack = [
    story.story_id,
    story.title,
    story.view,
    story.horizon,
    story.period,
    story.journey_activity,
    story.journey_step,
    ...documents.map((document) => document.content)
  ].filter(Boolean).join('\n');
  const matchedTerms = STORY_JOURNEY_PATTERNS
    .filter(([, pattern]) => pattern.test(haystack))
    .map(([term]) => term);

  if (matchedTerms.length === 0) {
    return {
      required: false,
      reason: 'No UI/Journey signals were found in the Story metadata or tracked Story docs.',
      matched_terms: [],
      source_paths: documents.map((document) => document.path)
    };
  }

  return {
    required: true,
    reason: `UI/Journey signals found: ${matchedTerms.join(', ')}`,
    matched_terms: matchedTerms,
    source_paths: documents.map((document) => document.path)
  };
}

async function readStoryJourneyDocuments(root, story) {
  const candidates = await buildStoryDocumentCandidates(root, story.story_id);
  const documents = [];
  for (const candidate of candidates) {
    try {
      documents.push({
        path: toWorkspaceRelative(root, candidate),
        content: await readFile(candidate, 'utf8')
      });
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  return documents;
}

async function buildStoryDocumentCandidates(root, storyId) {
  const names = storyId.startsWith('story-') ? [storyId] : [storyId, `story-${storyId}`];
  const canonical = (await resolveArtifactRoute(root, 'story', { storyId })).canonical.absolute_path;
  return [...new Set([
    canonical,
    ...names.flatMap((name) => STORY_DOCUMENT_DIRS.map((dir) => path.join(root, dir, `${name}.md`)))
  ])];
}

function buildStoryJourneyNextActions(status) {
  const journeyId = status.journey_id ?? DEFAULT_STORY_JOURNEY_ID;
  if (status.status === 'missing') {
    return [
      `vibepro journey derive . --id ${journeyId}`,
      `vibepro journey handoff . --id ${journeyId}`,
      `vibepro journey curate . --id ${journeyId} --input <judgments.json>`
    ];
  }
  if (status.status === 'needs_curated_journey') {
    const actions = [];
    if (!status.handoff_available) actions.push(`vibepro journey handoff . --id ${journeyId}`);
    actions.push(`vibepro journey curate . --id ${journeyId} --input <judgments.json>`);
    return actions;
  }
  return [];
}

function renderStoryJourneyContext(journeyContext) {
  if (!journeyContext) return '## Journey Context\n\n- 未評価';
  const detection = journeyContext.detection ?? {};
  const sourcePaths = Array.isArray(detection.source_paths) ? detection.source_paths : [];
  const matchedTerms = Array.isArray(detection.matched_terms) ? detection.matched_terms : [];
  return `## Journey Context

| 項目 | 内容 |
|------|------|
| Required | ${formatYesNo(journeyContext.required)} |
| Status | ${formatNullable(journeyContext.status)} |
| Artifact kind | ${formatNullable(journeyContext.artifact_kind)} |
| Curated | ${formatYesNo(journeyContext.curated)} |
| Curation status | ${formatNullable(journeyContext.curation_status)} |
| Handoff | ${formatYesNo(journeyContext.handoff_available)} |
| Journey ID | ${formatNullable(journeyContext.journey_id)} |
| Detection | ${matchedTerms.join(', ') || '-'} |
| Source docs | ${sourcePaths.join('<br>') || '-'} |
| Reason | ${formatNullable(journeyContext.reason ?? detection.reason)} |

### Journey Next Actions

${journeyContext.next_actions?.length ? journeyContext.next_actions.map((action) => `- ${action}`).join('\n') : '- なし'}`;
}

function formatYesNo(value) {
  return value ? 'yes' : 'no';
}

function formatNullable(value) {
  if (value === null || value === undefined || value === '') return '-';
  return String(value);
}

function renderStoryFindingReview(findingReview) {
  const summary = findingReview?.summary ?? {};
  const items = Array.isArray(findingReview?.items) ? findingReview.items : [];
  return `- Status: ${findingReview?.status ?? 'unknown'}
- 未レビュー: ${summary.unreviewed ?? 0}件
- suggested implementation_gap: ${summary.implementation_gap ?? 0}件
- suggested detector_gap: ${summary.detector_gap ?? 0}件

| Finding | Status | Suggested |
|---------|--------|-----------|
${items.length === 0 ? '| - | - | - |' : items.map((item) => `| ${item.finding_id} | ${item.review_status} | ${item.suggested_classification} |`).join('\n')}`;
}

function renderStoryApiBoundary(apiBoundary) {
  if (!apiBoundary) return '- api-boundary は適用されていない';
  const rows = Object.entries(apiBoundary.summary ?? {})
    .map(([classification, count]) => `| ${classification} | ${count} |`)
    .join('\n');
  const protectionRows = Object.entries(apiBoundary.protection_summary ?? {})
    .map(([status, count]) => `| ${status} | ${count} |`)
    .join('\n');
  return `### 分類別

| 分類 | 件数 |
|------|------|
${rows || '| - | 0 |'}

### 保護状態別

| 保護状態 | 件数 |
|----------|------|
${protectionRows || '| - | 0 |'}`;
}

function renderStoryActionCandidates(candidates) {
  if (candidates.length === 0) return '- なし';
  return `| ID | 対応する検出事項 | 候補 | 対象 | Impact | Community | 読むファイル | 方針 |
|----|------------------|------|------|--------|-----------|------------|------|
${candidates.map((candidate) => `| ${candidate.id} | ${candidate.finding_id} | ${candidate.title} | ${candidate.target_count}件 | ${formatGraphImpact(candidate.graph_context)} | ${formatGraphCommunities(candidate.graph_context)} | ${formatReadFirstFiles(candidate.implementation_plan)} | ${candidate.execution_policy} / mutates_repository=${candidate.mutates_repository} |`).join('\n')}

${renderImplementationPlans(candidates)}`;
}

function renderGeneratedTasks(tasks) {
  if (tasks.length === 0) return '- なし';
  return `| ID | 対応する検出事項 | 優先度 | 対象 | グループ | 方針 |
|----|------------------|--------|------|----------|------|
${tasks.map((task) => `| ${task.id} | ${task.finding_id ?? '-'} | ${task.priority} | ${task.target_count ?? task.target_files?.length ?? 0}件 | ${formatTargetGroups(task.target_groups)} | ${task.recommended_strategy?.id ?? '-'} |`).join('\n')}`;
}

function formatTargetGroups(groups = []) {
  if (!Array.isArray(groups) || groups.length === 0) return '-';
  return groups.map((group) => `${group.id}(${group.route_count})`).join(', ');
}

function formatRiskCount(count, summary = {}) {
  return `${count}件 (block: ${summary.block ?? 0}件, review: ${summary.review ?? 0}件, info: ${summary.info ?? 0}件)`;
}

function formatGraphImpact(graphContext) {
  if (!graphContext) return '-';
  return `${graphContext.impact_score ?? 0} (${graphContext.related_edge_count ?? 0} edges)`;
}

function formatGraphCommunities(graphContext) {
  const communities = graphContext?.affected_communities ?? [];
  if (communities.length === 0) return '-';
  return communities
    .slice(0, 3)
    .map((community) => {
      const scope = (community.route_count ?? 0) > 0
        ? `route: ${community.route_count}`
        : `file: ${community.file_count ?? 0}`;
      return `${community.id}(${scope}, node: ${community.node_count}, edge: ${community.edge_count})`;
    })
    .join(', ');
}

function formatReadFirstFiles(implementationPlan) {
  const files = implementationPlan?.read_first_files ?? [];
  if (files.length === 0) return '-';
  return selectRepresentativeReadFirstFiles(files, implementationPlan?.pre_fix_briefing).map((item) => item.file).join('<br>');
}

function selectRepresentativeReadFirstFiles(files, briefing) {
  const selected = [];
  const seen = new Set();
  const add = (item) => {
    if (!item || seen.has(item.file)) return;
    seen.add(item.file);
    selected.push(item);
  };
  const helpers = briefing?.auth_helpers ?? [];
  const helperFiles = new Set(helpers.map((helper) => helper.file));
  const hasSignatureHelper = helpers.some((helper) => helper.category === 'signature');
  add(files[0]);
  add(files.find((item) => helperFiles.has(item.file)));
  add(files.find((item) => item.reason.includes('graphify hub') && helperFiles.has(item.file)));
  if (!hasSignatureHelper) add(files.find((item) => item.reason.includes('middleware')));
  for (const item of files) add(item);
  return selected.slice(0, 3);
}

function renderImplementationPlans(candidates) {
  const items = candidates.filter((candidate) => candidate.implementation_plan);
  if (items.length === 0) return '';
  return `### 実装手順

${items.map((candidate) => renderImplementationPlan(candidate)).join('\n\n')}`;
}

function renderImplementationPlan(candidate) {
  const plan = candidate.implementation_plan;
  return `#### ${candidate.id}: ${candidate.title}

- 優先度: ${plan.priority}
- 理由: ${plan.rationale}
- 読むファイル: ${plan.read_first_files.length === 0 ? '-' : plan.read_first_files.map((item) => `${item.file}（${item.reason}）`).join(', ')}

${renderPreFixBriefing(plan.pre_fix_briefing)}

${plan.steps.map((step, index) => `${index + 1}. ${step.title}: ${step.detail}`).join('\n')}

完了条件:
${plan.acceptance_criteria.map((item) => `- ${item}`).join('\n')}`;
}

function renderPreFixBriefing(briefing) {
  if (!briefing) return '';
  if (briefing.opportunity) {
    return `修正前ブリーフィング:
- リファクタリング機会: ${briefing.opportunity.id} / ${briefing.opportunity.refactoring_intent}
- Campaign: ${briefing.campaign?.id ?? '-'} / rank=${briefing.campaign?.rank ?? '-'}
- 推奨抽象化: ${briefing.opportunity.suggested_abstraction?.label ?? '-'}
- 対象ファイル: ${briefing.target_files?.slice(0, 5).join(', ') || '-'}
- 推奨方針: ${briefing.recommended_strategy?.id ?? '-'} - ${briefing.recommended_strategy?.reason ?? '-'}
- 方針: ${briefing.strategy_options?.map((option) => option.label).join(' / ') || '-'}`;
  }
  return `修正前ブリーフィング:
- 現在の境界: middleware excludes_api=${briefing.current_boundary?.middleware?.excludes_api ?? false}, route protection=${formatInlineSummary(briefing.current_boundary?.route_protection ?? {})}
- 認証/署名候補: ${formatAuthHelpers(briefing.auth_helpers)}
- 対象route: ${briefing.target_routes?.slice(0, 5).map((route) => `${route.route_path} (${route.methods.join(', ') || '-'})`).join(', ') || '-'}
- 推奨方針: ${briefing.recommended_strategy?.id ?? '-'} - ${briefing.recommended_strategy?.reason ?? '-'}
- 方針: ${briefing.strategy_options?.map((option) => option.label).join(' / ') || '-'}`;
}

function formatAuthHelpers(helpers = []) {
  if (helpers.length === 0) return '-';
  return helpers
    .slice(0, 5)
    .map((helper) => `${formatHelperCategory(helper.category)}${helper.file}${helper.functions.length > 0 ? `:${helper.functions.slice(0, 3).join(',')}` : ''}`)
    .join(', ');
}

function formatHelperCategory(category) {
  const labels = {
    auth: '認証:',
    signature: '署名:',
    environment: '環境:'
  };
  return labels[category] ?? '';
}

function formatInlineSummary(summary = {}) {
  const entries = Object.entries(summary);
  if (entries.length === 0) return '-';
  return entries.map(([key, count]) => `${key}: ${count}件`).join(', ');
}

async function readExplicitStoryTasks(root, catalog) {
  const tasks = [];
  for (const story of catalog?.stories ?? []) {
    const docs = story.derived?.meaning?.evidence_by_type?.docs_evidence ?? [];
    const storyDocs = docs.filter((file) => /^docs\/management\/stories\//.test(file));
    for (const file of storyDocs) {
      try {
        const content = await readFile(path.join(root, file), 'utf8');
        tasks.push(...extractExplicitStoryTasks(content, { story, file }));
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
    }
  }
  return tasks;
}

function extractExplicitStoryTasks(content, { story, file }) {
  const section = extractRawMarkdownSection(content, [
    '初期タスク',
    '実装タスク',
    'タスク',
    'Initial Tasks',
    'Implementation Tasks',
    'Tasks'
  ]);
  if (!section) return [];
  const items = [];
  let current = null;
  const flush = () => {
    if (!current) return;
    const title = cleanMarkdownInline(current.title);
    if (!title) return;
    const acceptance = current.details
      .map((line) => cleanMarkdownInline(line.replace(/^[-*]\s+/, '').trim()))
      .filter(Boolean);
    const id = `${story.story_id}-${String(items.length + 1).padStart(2, '0')}-${slugifyTaskId(title)}`;
    items.push({
      id,
      story_id: story.story_id,
      title,
      purpose: acceptance[0] ?? `${title}を実装可能なタスクとして進める`,
      acceptance,
      priority: 'medium',
      source_type: 'story_explicit_task',
      source_file: file,
      target_files: [],
      read_first_files: [{ file, reason: 'Story本文の明示タスク定義' }],
      graph_context: null,
      recommended_strategy: {
        id: 'story-explicit-task',
        reason: 'Story本文の明示タスクとして定義されている'
      },
      implementation_steps: acceptance.length === 0
        ? [{ id: 'implement-task', title, detail: `${title}を実装し、Storyの受け入れ基準と対応させる` }]
        : acceptance.map((detail, index) => ({
            id: `step-${index + 1}`,
            title: detail,
            detail
          })),
      suggested_command: `vibepro task create . --from-plan --id ${story.story_id} --task ${id}`,
      execution_policy: 'proposal_only',
      mutates_repository: false
    });
    current = null;
  };
  for (const line of section.split(/\r?\n/)) {
    const ordered = line.match(/^\s*(\d+)[.)]\s+(.+?)\s*$/);
    if (ordered) {
      flush();
      current = { title: ordered[2], details: [] };
      continue;
    }
    const bullet = line.match(/^\s{1,}[-*]\s+(.+?)\s*$/);
    if (bullet && current) {
      current.details.push(bullet[1]);
    }
  }
  flush();
  return dedupeBy(items, (item) => item.id);
}

function extractRawMarkdownSection(content, headings) {
  const body = content.replace(/^---\n[\s\S]*?\n---\n?/, '');
  const escaped = headings.map(escapeRegExp).join('|');
  const pattern = new RegExp(`^#{2,4}\\s+(?:${escaped})\\s*\\n([\\s\\S]*?)(?=^#{2,4}\\s+|(?![\\s\\S]))`, 'im');
  const match = body.match(pattern);
  return match?.[1]?.trim() ?? null;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function cleanMarkdownInline(value) {
  return String(value ?? '')
    .replace(/\*\*/g, '')
    .replace(/`/g, '')
    .replace(/^\[[ xX]\]\s+/, '')
    .trim();
}

function slugifyTaskId(value) {
  const ascii = String(value ?? '')
    .replace(/`/g, '')
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (ascii) return ascii;
  let hash = 0;
  for (const char of String(value ?? 'task')) {
    hash = ((hash << 5) - hash + char.codePointAt(0)) | 0;
  }
  return `task-${Math.abs(hash).toString(36)}`;
}

function dedupeBy(items, keyFn) {
  const seen = new Set();
  const result = [];
  for (const item of items) {
    const key = keyFn(item);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}

function buildStoryExecutionPlan(catalog, options = {}) {
  const stories = Array.isArray(catalog?.stories) ? catalog.stories : [];
  const scoredStories = stories
    .map((story) => scoreStoryForExecution(story, catalog, options.graphIndex))
    .sort((a, b) => b.score - a.score || a.story_id.localeCompare(b.story_id));
  const priorityStories = scoredStories.slice(0, options.limit ?? 5);
  const baseTaskCandidates = [
    ...buildWarningTaskCandidates(catalog),
    ...priorityStories.flatMap((story) => buildTaskCandidatesForStory(story)),
    ...selectExplicitStoryTasks(options.explicitStoryTasks ?? [], scoredStories)
  ];
  const warnings = catalog.source?.warnings ?? [];
  const sourceConsistency = summarizeSourceConsistency(scoredStories);
  const sourceRecoveryMap = buildSourceRecoveryMap(scoredStories, baseTaskCandidates);
  const sourceAlignmentFindings = buildSourceAlignmentFindings(scoredStories);
  const taskCandidates = [
    ...baseTaskCandidates,
    ...buildSourceAlignmentTaskCandidates(sourceAlignmentFindings.items, scoredStories)
  ];
  const questions = buildPlanQuestions(catalog, priorityStories, sourceAlignmentFindings);
  return {
    schema_version: '0.1.0',
    generated_at: new Date().toISOString(),
    source: {
      tool: 'vibepro',
      catalog_generated_at: catalog.generated_at ?? null,
      run_id: catalog.source?.run_id ?? null,
      warnings
    },
    summary: {
      story_count: stories.length,
      coverage_status: catalog.coverage?.status ?? 'unavailable',
      coverage_ratio: catalog.coverage?.totals?.coverage_ratio ?? null,
      uncovered_files: catalog.coverage?.totals?.uncovered_files ?? 0,
      open_question_count: Array.isArray(catalog.open_questions) ? catalog.open_questions.length : 0,
      warning_count: warnings.length,
      source_consistency_status: sourceConsistency.status,
      source_recovery_story_count: sourceConsistency.needs_recovery_story_count,
      source_missing_spec_count: sourceRecoveryMap.counts.missing_spec,
      source_missing_architecture_count: sourceRecoveryMap.counts.missing_architecture,
      source_alignment_finding_count: sourceAlignmentFindings.counts.total,
      source_alignment_high_count: sourceAlignmentFindings.counts.high
    },
    source_consistency: sourceConsistency,
    source_recovery_map: sourceRecoveryMap,
    source_alignment_findings: sourceAlignmentFindings,
    questions,
    priority_stories: priorityStories,
    task_candidates: taskCandidates,
    next_commands: buildStoryPlanNextCommands(priorityStories)
  };
}

function scoreStoryForExecution(story, catalog, graphIndex = null) {
  const fields = new Set((story.derived?.open_questions ?? []).map((item) => item.field));
  const meaning = story.derived?.meaning ?? {};
  const storyContract = story.derived?.story_contract ?? null;
  const sourceType = story.source?.type ?? '';
  const targetFiles = resolveStoryPlanTargetFiles(story, graphIndex);
  const graphContext = buildGraphContextForFiles(targetFiles, graphIndex);
  const reasons = [];
  let score = 0;

  const add = (points, reason) => {
    score += points;
    reasons.push(reason);
  };

  if (sourceType === 'diagnosis') add(40, '診断Finding由来で短期修正候補');
  if (story.category === 'security') add(30, 'security Storyは公開前リスクに直結');
  if (catalog.coverage?.status === 'warn') add(15, 'Graph CoverageがwarnでStory根拠の見直しが必要');
  if (fields.has('missing_spec')) add(24, 'コード由来だが仕様/Story根拠が不足');
  if (fields.has('business_metric')) add(14, 'KPIまたは効果測定指標が未定');
  if (fields.has('business_context')) add(10, 'biz視点の意味づけが不足');
  if (fields.has('story_contract_source_role')) add(32, 'Story Contractでsource roleの誤読リスクが未解決');
  if (storyContract?.status === 'needs_clarification') add(18, 'Story Contractが開発可能な契約として未解決');
  if (fields.has('period')) add(6, 'NocoDB Periodが未確定');
  if (meaning.confidence === 'low') add(18, 'Story意味づけの総合信頼度が低い');
  if (meaning.confidence === 'medium') add(8, 'Story意味づけに確認余地がある');
  if (sourceType === 'code_surface') add(8, 'コードから逆算したStoryで人間レビューが必要');
  if (story.view === 'business' && story.category === 'product') add(5, 'ユーザー価値と事業価値に近いproduct Story');
  score += workflowStageWeight(meaning.workflow_position?.stage);
  const sourceRecovery = buildSourceRecoveryForStory(story, graphContext);
  if (sourceRecovery.status !== 'aligned') add(18, 'Story/Spec/Architecture正本の復元または確認が必要');

  return {
    story_id: story.story_id,
    title: story.title,
    score,
    category: story.category ?? null,
    view: story.view ?? null,
    horizon: story.horizon ?? null,
    period: story.period ?? null,
    source_type: sourceType,
    confidence: meaning.confidence ?? story.derived?.confidence ?? 'unknown',
    story_type: storyContract?.story_type ?? null,
    story_contract: storyContract,
    workflow_stage: meaning.workflow_position?.stage ?? 'unknown',
    target_files: targetFiles,
    read_first_files: resolveStoryPlanReadFirstFiles(story, graphContext),
    graph_context: graphContext,
    acceptance_focus: story.derived?.story_definition?.acceptance_focus ?? [],
    derived: {
      open_questions: story.derived?.open_questions ?? [],
      story_contract: storyContract
    },
    source_recovery: sourceRecovery,
    reasons,
    next_command: `vibepro story select . --id ${story.story_id}`
  };
}

function buildSourceRecoveryForStory(story, graphContext = null) {
  const meaning = story.derived?.meaning ?? {};
  const docs = meaning.evidence_by_type?.docs_evidence ?? [];
  const codeFiles = [
    ...(meaning.evidence_by_type?.code_evidence ?? []),
    ...(story.source?.paths ?? []).filter((item) => typeof item === 'string' && item.startsWith('src/'))
  ];
  const definition = story.derived?.story_definition ?? {};
  const openQuestions = story.derived?.open_questions ?? [];
  const storyDocs = docs.filter(isStoryDocPath);
  const specDocs = docs.filter(isSpecDocPath);
  const architectureDocs = docs.filter(isArchitectureDocPath);
  const hasMissingSpec = openQuestions.some((item) => item.field === 'missing_spec');
  const boundarySignals = inferArchitectureBoundarySignals(story, codeFiles);
  const requiresDesignFirstSources = isDesignFirstStory(story);
  const storyStatus = storyDocs.length > 0 ? 'present' : story.source?.type === 'code_surface' ? 'derived' : 'implicit';
  const specStatus = specDocs.length > 0
    ? 'present'
    : storyDocs.length > 0 && !hasMissingSpec && !requiresDesignFirstSources
      ? 'story_backed'
      : 'needs_recovery';
  const architectureStatus = architectureDocs.length > 0
    ? 'present'
    : boundarySignals.length > 0 || requiresDesignFirstSources
      ? 'needs_decision'
      : 'implicit';
  const status = specStatus === 'needs_recovery' || architectureStatus === 'needs_decision'
    ? 'needs_recovery'
    : storyStatus === 'derived'
      ? 'needs_review'
      : 'aligned';
  const drafts = [];
  if (specStatus === 'needs_recovery') {
    drafts.push(buildSpecRecoveryDraft({ story, definition, codeFiles, graphContext }));
  }
  if (architectureStatus === 'needs_decision') {
    drafts.push(buildArchitectureRecoveryDraft({ story, codeFiles, boundarySignals, graphContext }));
  }
  return {
    status,
    graph_context: graphContext,
    sources: {
      story: {
        status: storyStatus,
        refs: storyDocs
      },
      spec: {
        status: specStatus,
        refs: specDocs
      },
      architecture: {
        status: architectureStatus,
        refs: architectureDocs,
        signals: boundarySignals
      }
    },
    drafts,
    checks: [
      'Storyのwho/problem/outcomeが人間レビュー済みか',
      'Specの受け入れ基準がコード分岐と対応しているか',
      'Architecture/ADRの境界判断がGraphと変更範囲に対応しているか',
      ...(requiresDesignFirstSources ? ['設計変更Storyでは、実装前にArchitecture判断とSpec契約を正本化しているか'] : [])
    ]
  };
}

function isDesignFirstStory(story) {
  const text = [
    story.story_id,
    story.title,
    story.category,
    story.source?.type,
    ...(story.derived?.story_definition?.acceptance_focus ?? []),
    ...(story.derived?.meaning?.counter_evidence ?? []),
    ...(story.derived?.open_questions ?? []).map((item) => item.question)
  ]
    .filter(Boolean)
    .join('\n')
    .toLowerCase();
  if (story.category === 'architecture') return true;
  if (/(architecture|adr|spec|contract|gate|preset|story derive|repo profile|applicability|boundary|design[-_ ]?first)/i.test(text)) return true;
  return false;
}

function buildSpecRecoveryDraft({ story, definition, codeFiles, graphContext }) {
  return {
    kind: 'spec',
    status: 'draft_from_code',
    suggested_path: `docs/specs/${slugifyStoryId(story.story_id)}.md`,
    title: `${story.title} Spec`,
    must_include: [
      `対象ユーザー: ${definition.who ?? 'TODO'}`,
      `課題: ${definition.problem ?? 'TODO'}`,
      `成功状態: ${definition.outcome ?? definition.want ?? 'TODO'}`,
      ...(definition.acceptance_focus ?? []).map((item) => `受け入れ基準: ${item}`)
    ].slice(0, 12),
    evidence_files: buildRecoveryEvidenceFiles(codeFiles, graphContext),
    graph_evidence: buildRecoveryGraphEvidence(graphContext),
    unresolved_questions: [
      'このSpecをStory正本から確定できるか',
      'コードから逆算した条件のうち、意図ではなく偶然の実装はどれか',
      'Graphify上の関連ファイルも同じ受け入れ基準に含めるべきか',
      '成功指標または運用上の完了条件は何か'
    ]
  };
}

function buildArchitectureRecoveryDraft({ story, codeFiles, boundarySignals, graphContext }) {
  return {
    kind: 'architecture',
    status: 'decision_needed',
    suggested_path: `docs/architecture/ADR-${slugifyStoryId(story.story_id)}.md`,
    title: `${story.title} Architecture Decision`,
    decision_needed: [
      '既存Architecture内の変更として扱えるか、新しいADRが必要か',
      `境界シグナル: ${boundarySignals.join(', ')}`,
      '変更対象の責務境界、データ境界、外部連携境界をどこに置くか'
    ],
    evidence_files: buildRecoveryEvidenceFiles(codeFiles, graphContext),
    graph_evidence: buildRecoveryGraphEvidence(graphContext),
    unresolved_questions: [
      'Graph上のhubやcommunityと変更範囲が一致しているか',
      'API/DB/Auth/外部連携の境界をどの層で守るか',
      'ADR不要とする場合、その理由をStory frontmatterに残せるか'
    ]
  };
}

function buildRecoveryEvidenceFiles(codeFiles, graphContext) {
  return [
    ...(codeFiles ?? []),
    ...(graphContext?.related_files ?? []),
    ...(graphContext?.hub_nodes ?? []).map((node) => node.source_file).filter(Boolean)
  ]
    .filter(Boolean)
    .filter((file, index, files) => files.indexOf(file) === index)
    .slice(0, 12);
}

function buildRecoveryGraphEvidence(graphContext) {
  if (!graphContext) return null;
  return {
    matched_files: graphContext.matched_files ?? [],
    related_files: graphContext.related_files ?? [],
    hub_nodes: graphContext.hub_nodes ?? [],
    affected_communities: graphContext.affected_communities ?? [],
    related_edge_count: graphContext.related_edge_count ?? 0,
    impact_score: graphContext.impact_score ?? 0,
    cross_community: Boolean(graphContext.cross_community)
  };
}

function summarizeSourceConsistency(stories) {
  const items = stories.map((story) => ({
    story_id: story.story_id,
    title: story.title,
    status: story.source_recovery?.status ?? 'unknown',
    story_status: story.source_recovery?.sources?.story?.status ?? 'unknown',
    spec_status: story.source_recovery?.sources?.spec?.status ?? 'unknown',
    architecture_status: story.source_recovery?.sources?.architecture?.status ?? 'unknown'
  }));
  const counts = countBy(items, (item) => item.status);
  const needsRecovery = items.filter((item) => item.status === 'needs_recovery');
  return {
    schema_version: '0.1.0',
    status: needsRecovery.length > 0 ? 'needs_recovery' : counts.needs_review > 0 ? 'needs_review' : 'aligned',
    counts,
    needs_recovery_story_count: needsRecovery.length,
    top_needs_recovery: needsRecovery.slice(0, 10),
    stories: items
  };
}

function buildSourceRecoveryMap(stories, taskCandidates = []) {
  const taskIds = new Set(taskCandidates.map((candidate) => candidate.id));
  const rows = stories
    .map((story) => buildSourceRecoveryMapRow(story, taskIds))
    .sort((a, b) => sourceRecoveryMapRank(a) - sourceRecoveryMapRank(b) || b.score - a.score || a.story_id.localeCompare(b.story_id));
  const missingRows = rows.filter((row) => row.spec.status === 'needs_recovery' || row.architecture.status === 'needs_decision');
  return {
    schema_version: '0.1.0',
    status: missingRows.length > 0 ? 'needs_recovery' : rows.some((row) => row.status === 'needs_review') ? 'needs_review' : 'aligned',
    counts: {
      stories: rows.length,
      needs_recovery: missingRows.length,
      missing_spec: rows.filter((row) => row.spec.status === 'needs_recovery').length,
      missing_architecture: rows.filter((row) => row.architecture.status === 'needs_decision').length,
      aligned: rows.filter((row) => row.status === 'aligned').length
    },
    missing: missingRows,
    rows
  };
}

function buildSourceRecoveryMapRow(story, taskIds) {
  const recovery = story.source_recovery ?? {};
  const specDraft = (recovery.drafts ?? []).find((draft) => draft.kind === 'spec');
  const architectureDraft = (recovery.drafts ?? []).find((draft) => draft.kind === 'architecture');
  const graph = story.graph_context ?? recovery.graph_context ?? {};
  const specTaskId = `${story.story_id}-spec-recovery`;
  const architectureTaskId = `${story.story_id}-architecture-recovery`;
  return {
    story_id: story.story_id,
    title: story.title,
    score: story.score,
    status: recovery.status ?? 'unknown',
    story_source: {
      status: recovery.sources?.story?.status ?? 'unknown',
      refs: recovery.sources?.story?.refs ?? []
    },
    spec: {
      status: recovery.sources?.spec?.status ?? 'unknown',
      refs: recovery.sources?.spec?.refs ?? [],
      suggested_path: specDraft?.suggested_path ?? null,
      draft_title: specDraft?.title ?? null,
      suggested_task_id: specDraft ? specTaskId : null,
      task_candidate_id: taskIds.has(specTaskId) ? specTaskId : null
    },
    architecture: {
      status: recovery.sources?.architecture?.status ?? 'unknown',
      refs: recovery.sources?.architecture?.refs ?? [],
      signals: recovery.sources?.architecture?.signals ?? [],
      suggested_path: architectureDraft?.suggested_path ?? null,
      draft_title: architectureDraft?.title ?? null,
      suggested_task_id: architectureDraft ? architectureTaskId : null,
      task_candidate_id: taskIds.has(architectureTaskId) ? architectureTaskId : null
    },
    graph: {
      matched_file_count: graph.matched_file_count ?? 0,
      matched_files: (graph.matched_files ?? []).slice(0, 12),
      related_edge_count: graph.related_edge_count ?? 0,
      related_files: (graph.related_files ?? []).slice(0, 8),
      hub_files: (graph.hub_nodes ?? []).map((node) => node.source_file).filter(Boolean).slice(0, 5),
      affected_communities: graph.affected_communities ?? [],
      cross_community: Boolean(graph.cross_community)
    }
  };
}

function sourceRecoveryMapRank(row) {
  if (row.spec.status === 'needs_recovery' && row.architecture.status === 'needs_decision') return 0;
  if (row.architecture.status === 'needs_decision') return 1;
  if (row.spec.status === 'needs_recovery') return 2;
  if (row.status === 'needs_review') return 3;
  return 4;
}

function buildSourceAlignmentFindings(stories) {
  const items = stories
    .flatMap((story) => buildSourceAlignmentFindingsForStory(story))
    .sort((a, b) => sourceAlignmentSeverityRank(a.severity) - sourceAlignmentSeverityRank(b.severity)
      || (b.graph?.impact_score ?? 0) - (a.graph?.impact_score ?? 0)
      || (b.graph?.related_edge_count ?? 0) - (a.graph?.related_edge_count ?? 0)
      || a.story_id.localeCompare(b.story_id)
      || a.type.localeCompare(b.type));
  const countsBySeverity = countBy(items, (item) => item.severity);
  const countsByType = countBy(items, (item) => item.type);
  return {
    schema_version: '0.1.0',
    status: items.some((item) => item.severity === 'high')
      ? 'needs_review'
      : items.length > 0
        ? 'watch'
        : 'aligned',
    counts: {
      total: items.length,
      high: countsBySeverity.high ?? 0,
      medium: countsBySeverity.medium ?? 0,
      low: countsBySeverity.low ?? 0,
      by_type: countsByType
    },
    top: items.slice(0, 10),
    items: items.slice(0, 50)
  };
}

function buildSourceAlignmentFindingsForStory(story) {
  const recovery = story.source_recovery ?? {};
  const storyContract = story.story_contract ?? story.derived?.story_contract ?? null;
  const sourceStatus = recovery.sources?.story?.status ?? 'unknown';
  const specStatus = recovery.sources?.spec?.status ?? 'unknown';
  const architectureStatus = recovery.sources?.architecture?.status ?? 'unknown';
  const graph = story.graph_context ?? recovery.graph_context ?? {};
  const fields = new Set((story.derived?.open_questions ?? []).map((item) => item.field));
  const refs = {
    story: recovery.sources?.story?.refs ?? [],
    spec: recovery.sources?.spec?.refs ?? [],
    architecture: recovery.sources?.architecture?.refs ?? []
  };
  const findings = [];
  const add = (type, severity, reason, potentialBug, recommendedReview, extra = {}) => {
    findings.push({
      id: `${story.story_id}-${type}`,
      story_id: story.story_id,
      title: story.title,
      type,
      severity,
      reason,
      potential_bug: potentialBug,
      recommended_review: recommendedReview,
      evidence: buildSourceAlignmentEvidence(story, graph, refs, extra.evidence),
      refs,
      graph: buildRecoveryGraphEvidence(graph),
      execution_policy: 'proposal_only',
      mutates_repository: false
    });
  };

  if (fields.has('story_contract_source_role') || storyContractCheckStatus(storyContract, 'source_role_integrity') === 'needs_clarification') {
    add(
      'story_contract_source_role_mismatch',
      'high',
      'Story Contractがsource roleの不一致を検出している。',
      '内部ツールや開発運用の文書を、ユーザー向けproduct storyとして誤読し、不要または誤った実装へ進む可能性がある。',
      '根拠文書が本当にproduct要求か、開発者向け内部仕様かを確認し、必要ならStory ID、category、preset、または根拠文書を修正する。',
      {
        evidence: {
          open_question: 'story_contract_source_role',
          story_contract: summarizeStoryContractForEvidence(storyContract)
        }
      }
    );
  }

  if (specStatus === 'needs_recovery') {
    add(
      'missing_spec_source',
      'high',
      'Spec正本が未復元のため、受け入れ基準がコード由来の仮説に留まっている。',
      '実装上の分岐や表示が、そのまま本来の要件だと誤認されている可能性がある。',
      'Spec草案を作り、コード由来条件と人間が承認する受け入れ基準を分ける。'
    );
  }

  if (architectureStatus === 'needs_decision') {
    add(
      'missing_architecture_decision',
      'high',
      'Architecture/ADR判断が未確定のまま境界シグナルが検出されている。',
      'API/Auth/Billing/Data/外部連携の責務境界が曖昧で、要件外の副作用を作る可能性がある。',
      'ADRが必要か、Story内のADR不要理由で足りるかをGraphify影響範囲と照合して判断する。'
    );
  }

  if ((sourceStatus === 'derived' || sourceStatus === 'implicit') && specStatus === 'present') {
    add(
      'spec_from_unreviewed_story',
      sourceStatus === 'derived' ? 'medium' : 'low',
      `Spec正本はあるが、Story正本は${sourceStatus}のため意図が人間承認済みとは限らない。`,
      'コードから逆算した画面/分岐を、ユーザー要求として誤って固定している可能性がある。',
      'Specの受け入れ基準ごとに、Storyのwho/problem/outcomeと一致するか確認する。'
    );
  }

  if ((sourceStatus === 'derived' || sourceStatus === 'implicit') && architectureStatus === 'present') {
    add(
      'adr_from_unreviewed_story',
      sourceStatus === 'derived' ? 'medium' : 'low',
      `Architecture/ADRはあるが、Story正本は${sourceStatus}のため設計判断の前提が未承認の可能性がある。`,
      'ADRの境界判断は正しくても、解こうとしている要件や運用制約が違う可能性がある。',
      'ADRの前提、非目標、境界判断がStoryの成果状態と対応しているか確認する。'
    );
  }

  if (graph.cross_community && architectureStatus !== 'present') {
    add(
      'cross_community_without_architecture',
      'high',
      'Graphify上で複数communityに跨るが、Architecture/ADR正本が未確定。',
      '局所変更のつもりで責務境界を跨ぎ、別flowや共有serviceの挙動を壊す可能性がある。',
      'hub/related fileを先に読み、ADRが必要な境界変更か、Storyをflow単位に分割すべきか判断する。'
    );
  }

  if (graph.cross_community && architectureStatus === 'present') {
    add(
      'cross_community_architecture_review',
      sourceStatus === 'present' ? 'medium' : 'high',
      'Graphify上で複数communityに跨り、ADRは存在するため、ADRと実依存の対応確認が必要。',
      'ADRで想定した境界より実コードの影響範囲が広く、要件上は無関係な画面/APIまで変える可能性がある。',
      'ADRの対象境界とGraphifyのaffected_communities/hub_nodesが一致しているか確認する。'
    );
  }

  if (isHighGraphImpact(graph) && sourceStatus !== 'present') {
    add(
      'high_graph_impact_unreviewed_source',
      'high',
      'Graphifyの影響度が高いが、Story正本が人間レビュー済みではない。',
      '大きな影響範囲を持つ実装を、コード由来の仮説だけで正しい要件として扱う可能性がある。',
      '変更前にStory正本をレビューし、影響範囲に含まれる各flowが同じ受け入れ基準でよいか確認する。'
    );
  }

  if (fields.has('business_context')) {
    add(
      'business_context_gap',
      story.category === 'product' ? 'high' : 'medium',
      'Storyの事業/利用文脈が未確定。',
      'コードとしては正しいUIやAPIでも、ユーザーが本当に達成したい成果とずれている可能性がある。',
      '対象ユーザー、利用場面、成功状態をStory正本に明記してからSpecを承認する。',
      { evidence: { open_question: 'business_context' } }
    );
  }

  if (fields.has('business_metric')) {
    add(
      'business_metric_gap',
      'medium',
      'Storyの成功指標または観測観点が未確定。',
      '受け入れ基準を満たしても、プロダクト上の改善を検知できない可能性がある。',
      '少なくとも1つのKPI、ログ、運用確認観点をSpecまたはStoryへ紐づける。',
      { evidence: { open_question: 'business_metric' } }
    );
  }

  if ((story.acceptance_focus ?? []).length === 0 && specStatus !== 'present') {
    add(
      'acceptance_criteria_gap',
      'medium',
      '受け入れ基準の焦点が薄く、Spec正本も未確定。',
      '実装完了の判定がコード差分や見た目確認に寄り、要件バグを見逃す可能性がある。',
      'Spec草案に「何ができれば完了か」「何を壊してはいけないか」を追加する。'
    );
  }

  return findings;
}

function buildSourceAlignmentEvidence(story, graph, refs, extra = {}) {
  return {
    story_source_status: story.source_recovery?.sources?.story?.status ?? 'unknown',
    spec_status: story.source_recovery?.sources?.spec?.status ?? 'unknown',
    architecture_status: story.source_recovery?.sources?.architecture?.status ?? 'unknown',
    source_type: story.source_type ?? null,
    confidence: story.confidence ?? null,
    open_questions: (story.derived?.open_questions ?? []).map((item) => item.field).slice(0, 8),
    story_contract: summarizeStoryContractForEvidence(story.story_contract ?? story.derived?.story_contract ?? null),
    docs: [...refs.story, ...refs.spec, ...refs.architecture].slice(0, 12),
    files: [
      ...(graph?.matched_files ?? []),
      ...(graph?.related_files ?? []),
      ...(graph?.hub_nodes ?? []).map((node) => node.source_file).filter(Boolean)
    ].filter((file, index, files) => file && files.indexOf(file) === index).slice(0, 12),
    ...extra
  };
}

function storyContractCheckStatus(storyContract, checkId) {
  return (storyContract?.checks ?? []).find((check) => check.id === checkId)?.status ?? null;
}

function summarizeStoryContractForEvidence(storyContract) {
  if (!storyContract) return null;
  return {
    status: storyContract.status ?? null,
    story_type: storyContract.story_type ?? null,
    unresolved_checks: (storyContract.checks ?? [])
      .filter((check) => check.status === 'needs_clarification')
      .map((check) => check.id)
  };
}

function isHighGraphImpact(graph = {}) {
  return (graph.impact_score ?? 0) >= 20
    || (graph.related_edge_count ?? 0) >= 20
    || (graph.matched_file_count ?? 0) >= 6
    || (graph.community_span ?? 0) >= 3;
}

function sourceAlignmentSeverityRank(severity) {
  return { high: 0, medium: 1, low: 2 }[severity] ?? 3;
}

function buildSourceAlignmentTaskCandidates(findings, stories) {
  const storyById = new Map(stories.map((story) => [story.story_id, story]));
  return [...groupSourceAlignmentFindingsByStory(findings).entries()]
    .filter(([, items]) => items.some((item) => item.severity === 'high' || item.severity === 'medium'))
    .slice(0, 10)
    .map(([storyId, items]) => {
      const story = storyById.get(storyId) ?? {};
      const topFinding = items[0];
      const files = topFinding.evidence?.files ?? [];
      return {
        id: `${storyId}-source-alignment-review`,
        story_id: storyId,
        title: 'Story/Spec/ADR不整合をレビューする',
        purpose: 'Story、Spec、Architecture/ADR、Graphify影響範囲を照合し、要件として間違っている可能性を潰す',
        acceptance: [
          '各潜在バグ候補について、Story/Spec/ADR/コードのどれを修正するか判断している',
          'Graphifyのhub/communityを読んだ上で影響範囲を説明できる',
          '要件が正しい場合はレビュー済み理由を正本またはPR本文に残している'
        ],
        priority: topFinding.severity === 'high' ? 'high' : 'medium',
        source_type: 'source_alignment_finding',
        target_files: files.slice(0, 12),
        read_first_files: files.slice(0, 8).map((file) => ({
          file,
          reason: 'Source Alignment FindingのGraphify/コード証跡'
        })),
        graph_context: story.graph_context ?? topFinding.graph ?? null,
        source_alignment_findings: items,
        recommended_strategy: {
          id: 'source-alignment-review',
          reason: topFinding.potential_bug
        },
        implementation_steps: buildPlanCandidateSteps('source-alignment-review'),
        suggested_command: `vibepro story select . --id ${storyId}`,
        execution_policy: 'proposal_only',
        mutates_repository: false
      };
    });
}

function selectExplicitStoryTasks(explicitTasks, stories) {
  const storyIds = new Set(stories.map((story) => story.story_id));
  return explicitTasks
    .filter((task) => storyIds.has(task.story_id))
    .sort((a, b) => a.story_id.localeCompare(b.story_id) || a.id.localeCompare(b.id));
}

function groupSourceAlignmentFindingsByStory(findings) {
  const groups = new Map();
  for (const finding of findings) {
    const items = groups.get(finding.story_id) ?? [];
    items.push(finding);
    groups.set(finding.story_id, items);
  }
  return groups;
}

function inferArchitectureBoundarySignals(story, codeFiles) {
  const text = [story.story_id, story.title, ...codeFiles].join(' ').toLowerCase();
  const signals = [];
  if (/api|route\.ts|webhook/.test(text)) signals.push('api_boundary');
  if (/auth|session|user|identity|middleware/.test(text)) signals.push('auth_boundary');
  if (/billing|stripe|subscription|payment|premium/.test(text)) signals.push('billing_boundary');
  if (/prisma|database|db|repository|model/.test(text)) signals.push('data_boundary');
  if (/webhook|stripe|resend|external|oauth/.test(text)) signals.push('external_integration_boundary');
  return [...new Set(signals)];
}

function isStoryDocPath(filePath) {
  return /^docs\/management\/stories\//.test(filePath);
}

function isSpecDocPath(filePath) {
  return /^docs\/(specs|requirements|features|user_stories)\//.test(filePath);
}

function isArchitectureDocPath(filePath) {
  return /^docs\/(architecture|management\/architecture)\//.test(filePath);
}

function slugifyStoryId(storyId) {
  return String(storyId ?? 'story')
    .replace(/^story-/, '')
    .replace(/[^A-Za-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
}

function countBy(items, keyFn) {
  return items.reduce((acc, item) => {
    const key = keyFn(item);
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});
}

function resolveStoryPlanTargetFiles(story, graphIndex = null) {
  const meaning = story.derived?.meaning ?? {};
  const paths = [
    ...(meaning.code_scope?.evidence ?? []),
    ...(story.source?.paths ?? []).filter((item) => typeof item === 'string' && item.startsWith('src/'))
  ];
  const explicitFiles = [...new Set(paths)].slice(0, 12);
  if (explicitFiles.length > 0) return explicitFiles;
  return resolveStoryPlanGraphFallbackFiles(story, graphIndex);
}

function resolveStoryPlanReadFirstFiles(story, graphContext = null) {
  const files = graphContext?.matched_files?.length > 0
    ? graphContext.matched_files
    : resolveStoryPlanTargetFiles(story);
  const items = files.slice(0, 6).map((file) => ({
    file,
    reason: `Story ${story.story_id} の根拠コード`
  }));
  for (const file of graphContext?.related_files ?? []) {
    addReadFirstFile(items, file, 'Graphifyで対象Storyの周辺依存として検出');
  }
  for (const hub of graphContext?.hub_nodes ?? []) {
    if (hub.source_file) addReadFirstFile(items, hub.source_file, `Graphify hub: ${hub.label ?? hub.id} / degree=${hub.degree ?? 0}`);
  }
  return items.slice(0, 10);
}

function addReadFirstFile(items, file, reason) {
  if (!file || items.some((item) => item.file === file)) return;
  items.push({ file, reason });
}

function resolveStoryPlanGraphFallbackFiles(story, graphIndex) {
  if (!graphIndex?.nodesBySourceFile) return [];
  const storyText = [story.story_id, story.title, story.category, story.view].filter(Boolean).join(' ').toLowerCase();
  const tokens = [...new Set(storyText.split(/[^a-z0-9]+/).filter((token) => token.length >= 4))];
  const boundaryMatchers = buildStoryBoundaryGraphMatchers(storyText);
  return [...graphIndex.nodesBySourceFile.keys()]
    .filter((file) => file.startsWith('src/'))
    .map((file) => ({
      file,
      score: scoreGraphFallbackFile(file, tokens, boundaryMatchers)
    }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.file.localeCompare(b.file))
    .slice(0, 12)
    .map((item) => item.file);
}

function buildStoryBoundaryGraphMatchers(storyText) {
  const matchers = [];
  if (/auth|security|session|identity|user/.test(storyText)) matchers.push(/auth|session|identity|user|middleware/);
  if (/api|route|webhook|boundary/.test(storyText)) matchers.push(/\/api\/|route\.ts|webhook|middleware/);
  if (/billing|stripe|subscription|payment|premium/.test(storyText)) matchers.push(/billing|stripe|subscription|payment|premium/);
  if (/data|database|db|repository|model/.test(storyText)) matchers.push(/database|db|repository|model|prisma/);
  return matchers;
}

function scoreGraphFallbackFile(file, tokens, boundaryMatchers) {
  const text = file.toLowerCase();
  let score = 0;
  for (const matcher of boundaryMatchers) {
    if (matcher.test(text)) score += 10;
  }
  for (const token of tokens) {
    if (text.includes(token)) score += 2;
  }
  if (/\/api\/|route\.ts|middleware/.test(text)) score += 1;
  return score;
}

function workflowStageWeight(stage) {
  const weights = {
    risk_control: 16,
    decision: 12,
    activation: 10,
    monetization: 10,
    discovery: 8,
    entry: 7,
    acquisition: 6,
    personalization: 6,
    conversion_support: 6,
    retention: 4,
    operations: 4,
    architecture: 3,
    quality_gate: 3,
    knowledge_recovery: 2
  };
  return weights[stage] ?? 0;
}

function buildPlanQuestions(catalog, priorityStories, sourceAlignmentFindings = null) {
  const priorityIds = new Set(priorityStories.map((story) => story.story_id));
  const rawQuestions = Array.isArray(catalog.open_questions) ? catalog.open_questions : [];
  const warningQuestions = (catalog.source?.warnings ?? []).map((warning) => ({
    story_id: 'story-docs-story-ssot-recovery',
    field: warning.code ?? 'warning',
    question: warning.message ?? `Story Map生成時の警告を確認する: ${warning.code ?? 'warning'}`,
    priority: 'high'
  }));
  const coverageQuestions = (catalog.coverage?.uncovered ?? []).slice(0, 10).map((item) => ({
    story_id: null,
    field: 'coverage',
    question: `${item.path} はGraph上で主要コードだがStory根拠に未接続。既存Storyへ吸収するか、新Storyにするか確認する。`,
    priority: 'high'
  }));
  const questions = rawQuestions.map((item) => ({
    story_id: item.story_id,
    field: item.field,
    question: item.question,
    priority: priorityIds.has(item.story_id) ? questionPriority(item.field) : 'medium'
  }));
  const sourceQuestions = priorityStories.flatMap((story) => buildSourceRecoveryQuestions(story));
  const alignmentQuestions = (sourceAlignmentFindings?.top ?? [])
    .filter((finding) => finding.severity === 'high')
    .slice(0, 5)
    .map((finding) => ({
      story_id: finding.story_id,
      field: 'source_alignment',
      question: `${finding.reason} 潜在バグ: ${finding.potential_bug}`,
      priority: 'high'
    }));
  return [...warningQuestions, ...coverageQuestions, ...alignmentQuestions, ...sourceQuestions, ...questions]
    .sort((a, b) => questionPriorityRank(a.priority) - questionPriorityRank(b.priority) || String(a.story_id ?? '').localeCompare(String(b.story_id ?? '')))
    .slice(0, 20);
}

function buildSourceRecoveryQuestions(story) {
  const recovery = story.source_recovery;
  if (!recovery || recovery.status === 'aligned') return [];
  const questions = [];
  if (recovery.sources?.spec?.status === 'needs_recovery') {
    questions.push({
      story_id: story.story_id,
      field: 'source_spec_recovery',
      question: 'Spec正本が不足している。コードから逆算した受け入れ基準をSpecとして確定するか、既存Specへリンクする必要がある。',
      priority: 'high'
    });
  }
  if (recovery.sources?.architecture?.status === 'needs_decision') {
    questions.push({
      story_id: story.story_id,
      field: 'source_architecture_recovery',
      question: `Architecture/ADR判断が未確定。${recovery.sources.architecture.signals.join(', ')} の境界判断をStoryまたはADRに残す必要がある。`,
      priority: 'high'
    });
  }
  return questions;
}

function questionPriority(field) {
  if (String(field ?? '').startsWith('story_contract_')) return field === 'story_contract_source_role' ? 'high' : 'medium';
  if (field === 'coverage' || field === 'missing_spec' || field === 'missing_evidence' || field === 'source_spec_recovery' || field === 'source_architecture_recovery' || field === 'source_alignment') return 'high';
  if (field === 'business_metric' || field === 'business_context') return 'medium';
  return 'low';
}

function questionPriorityRank(priority) {
  return { high: 0, medium: 1, low: 2 }[priority] ?? 3;
}

function buildTaskCandidatesForStory(story) {
  const fields = new Set((story.reasons ?? []).flatMap((reason) => reason.includes('仕様/Story') ? ['missing_spec'] : []));
  const candidates = [];
  const push = (suffix, title, purpose, acceptance, extra = {}) => {
    candidates.push({
      id: `${story.story_id}-${suffix}`,
      story_id: story.story_id,
      title,
      purpose,
      acceptance,
      priority: story.score >= 90 ? 'critical' : story.score >= 80 ? 'high' : story.score >= 60 ? 'medium' : 'low',
      source_type: 'story_plan_candidate',
      target_files: story.target_files ?? [],
      read_first_files: story.read_first_files ?? [],
      graph_context: story.graph_context ?? null,
      recommended_strategy: {
        id: suffix,
        reason: purpose
      },
      implementation_steps: buildPlanCandidateSteps(suffix),
      suggested_command: `vibepro story select . --id ${story.story_id}`,
      ...extra
    });
  };

  if (fields.has('missing_spec') || story.source_type === 'code_surface' || story.source_recovery?.sources?.spec?.status === 'needs_recovery') {
    push('spec-recovery', 'Spec正本を復元する', 'コードから逆算したStoryの受け入れ基準をSpec正本として確定し、Storyとリンクする', [
      'missing_spec が残る理由を確認済みにする',
      'Storyのwho/problem/outcomeが人間レビュー済みになる',
      'Spec草案の受け入れ基準がコード分岐と対応する',
      '必要なら仕様書またはNocoDB Storyを作る'
    ], {
      source_recovery: story.source_recovery,
      recovery_drafts: (story.source_recovery?.drafts ?? []).filter((draft) => draft.kind === 'spec')
    });
  }
  if (story.story_contract?.status === 'needs_clarification') {
    push('story-contract-recovery', 'Story Contractを確定する', 'ビジネス意図、開発境界、source role、受け入れ例、検証方針を実装前に確認する', [
      'story_contract の未解決checkが説明できる',
      'source roleがproduct要求、内部開発仕様、運用変更のどれかに分類されている',
      '開発境界と検証方針がStory/Spec/Architectureのいずれかに残る',
      '誤読リスクがある場合はStory ID、category、preset、または根拠文書を修正する'
    ], {
      story_contract: story.story_contract,
      source_recovery: story.source_recovery
    });
  }
  if (story.source_recovery?.sources?.architecture?.status === 'needs_decision') {
    push('architecture-recovery', 'Architecture/ADR正本を復元する', 'Graphと変更対象コードから境界判断を復元し、ADR要否と理由をStoryまたはArchitecture文書に残す', [
      'Architecture/ADRが必要か、不要なら理由が明示されている',
      'API/Auth/Billing/Data/外部連携の境界判断がGraph文脈と対応する',
      'Requirement GateでArchitecture SourceまたはADR不要理由を追跡できる'
    ], {
      source_recovery: story.source_recovery,
      recovery_drafts: (story.source_recovery?.drafts ?? []).filter((draft) => draft.kind === 'architecture')
    });
  }
  if (story.category === 'security' || story.source_type === 'diagnosis') {
    push('risk-fix', '診断Findingを修正候補に落とす', 'security/diagnosis Storyの検出事項を修正可能なタスクに分解する', [
      '対象Findingと影響ファイルが特定される',
      '修正前ブリーフィングがある',
      'テストまたは手動確認のGateが定義される'
    ]);
  }
  if (story.view === 'business') {
    push('kpi-period', 'KPIとPeriodを確定する', 'biz価値と実行期をNocoDB同期可能な形にする', [
      '主要KPIまたは効果測定観点が1つ以上ある',
      'Periodを確定するか未定として扱う判断がある',
      '優先度の根拠が残る'
    ]);
  }
  if (candidates.length === 0) {
    push('review', 'Story仮説をレビューする', '意味づけ、根拠、反証を確認し次アクションを決める', [
      'meaning confidenceを確認する',
      '次に診断するか、仕様を補うか、実装するか決める'
    ]);
  }
  return candidates;
}

function buildWarningTaskCandidates(catalog) {
  return (catalog.source?.warnings ?? [])
    .filter((warning) => warning.code === 'missing_evidence')
    .map((warning) => ({
      id: 'story-docs-story-ssot-recovery-missing-evidence-cleanup',
      story_id: 'story-docs-story-ssot-recovery',
      title: '欠けた診断evidence参照を整理する',
      purpose: 'manifestが参照する診断evidenceの欠落を確認し、run成果物を復元するか不要なrun参照を整理する',
      acceptance: [
        '欠けているevidence参照のrun_idとpathが特定されている',
        'run成果物を復元するか、不要なrun参照を整理する判断が残っている',
        'story deriveを再実行してmissing_evidence警告が消えるか、残す理由が説明されている'
      ],
      priority: 'high',
      source_type: 'story_plan_warning',
      warning,
      target_files: ['.vibepro/vibepro-manifest.json'],
      read_first_files: [{
        file: '.vibepro/vibepro-manifest.json',
        reason: `欠けた診断evidence参照を確認する: ${warning.path ?? '-'}`
      }],
      recommended_strategy: {
        id: 'missing-evidence-cleanup',
        reason: warning.message ?? 'manifestが参照する診断evidenceが見つからないため'
      },
      implementation_steps: buildPlanCandidateSteps('missing-evidence-cleanup'),
      suggested_command: 'vibepro story plan .'
    }));
}

function buildPlanCandidateSteps(suffix) {
  const common = {
    'spec-recovery': [
      { id: 'review-meaning', title: 'Story意味づけを確認する', detail: 'derived.meaning の価値仮説、根拠、反証、不足情報を確認する' },
      { id: 'recover-spec', title: 'Spec草案を復元する', detail: 'source_recovery.drafts のspec草案を読み、コード由来条件と人間が確定すべき条件を分ける' },
      { id: 'link-source', title: 'StoryとSpecをリンクする', detail: 'Story frontmatterまたは本文にSpec参照を残し、Requirement Gateが正本として読めるようにする' },
      { id: 'rerun-gate', title: 'Requirement Gateを再実行する', detail: 'vibepro pr prepare または diagnose でSpec Sourceが拾われるか確認する' }
    ],
    'architecture-recovery': [
      { id: 'read-graph', title: 'Graph文脈を読む', detail: '対象ファイルのhub/community/依存方向を確認し、境界変更か局所変更かを判定する' },
      { id: 'decide-adr', title: 'ADR要否を決める', detail: 'API/Auth/Billing/Data/外部連携の境界判断が必要ならArchitecture/ADR草案に落とす' },
      { id: 'record-decision', title: '判断を正本へ記録する', detail: 'ADR文書を作るか、ADR不要理由をStory frontmatterへ明示する' },
      { id: 'rerun-gate', title: 'Requirement Gateを再実行する', detail: 'Architecture SourceまたはADR不要理由がPR本文とGate DAGに出るか確認する' }
    ],
    'risk-fix': [
      { id: 'read-finding', title: '診断Findingを読む', detail: '対象Finding、影響範囲、既存保護境界を確認する' },
      { id: 'define-fix', title: '修正方針を決める', detail: 'route単位、middleware、環境変数、署名検証のどれで直すか決める' },
      { id: 'define-gate', title: '検証Gateを決める', detail: '再診断、unit/API/E2Eのどれで完了確認するか決める' }
    ],
    'kpi-period': [
      { id: 'define-kpi', title: 'KPIを決める', detail: 'Storyの成果を測る指標または観測観点を1つ以上決める' },
      { id: 'define-period', title: 'Periodを決める', detail: 'NocoDB同期可能な実行期を確定するか、未定として扱う判断を残す' }
    ],
    'source-alignment-review': [
      { id: 'read-sources', title: '正本を読む', detail: 'Story、Spec、Architecture/ADRの参照を読み、要件・受け入れ基準・境界判断を並べる' },
      { id: 'read-graph', title: 'Graph影響範囲を読む', detail: 'Graphifyのmatched/related/hub/communityを読み、実際の影響範囲を確認する' },
      { id: 'classify-mismatch', title: '不整合を分類する', detail: 'Storyが誤り、Specが誤り、ADRが不足、コードが意図外のどれかを判定する' },
      { id: 'record-outcome', title: '判断を記録する', detail: '修正する場合はタスク化し、正しい場合はレビュー済み理由を正本またはPR本文へ残す' }
    ],
    review: [
      { id: 'review-story', title: 'Story仮説をレビューする', detail: 'meaning confidenceとcounter_evidenceを確認して次アクションを決める' }
    ],
    'missing-evidence-cleanup': [
      { id: 'inspect-manifest', title: 'manifest参照を確認する', detail: 'missing_evidence warningのrun_idとpathを .vibepro/vibepro-manifest.json で確認する' },
      { id: 'choose-policy', title: '復元か整理かを決める', detail: '診断runを残す必要があればevidenceを復元し、不要ならmanifestのrun参照を整理する' },
      { id: 'rerun-derive', title: 'Story Mapを再生成する', detail: 'vibepro story derive を再実行し、warningが消えたか、残す理由が説明できるか確認する' }
    ]
  };
  return common[suffix] ?? common.review;
}

function buildStoryPlanNextCommands(priorityStories) {
  const firstStory = priorityStories[0];
  return [
    'vibepro story map .',
    'vibepro story plan .',
    firstStory ? `vibepro story select . --id ${firstStory.story_id}` : null,
    firstStory ? `vibepro story diagnose . --id ${firstStory.story_id} --pre-architecture --run-graphify` : null
  ].filter(Boolean);
}

export function renderStoryPlan(plan) {
  const questions = plan.questions.length === 0
    ? '- なし'
    : plan.questions.map((item) => `- [${item.priority}] ${item.story_id ? `\`${item.story_id}\`: ` : ''}${item.question}`).join('\n');
  const stories = plan.priority_stories.length === 0
    ? '- なし'
    : plan.priority_stories.map((story, index) => `### ${index + 1}. ${story.title}

- Story ID: \`${story.story_id}\`
- Score: ${story.score}
- Stage: ${story.workflow_stage}
- Confidence: ${story.confidence}
- Source: ${story.source_type}
- Source Consistency: ${story.source_recovery?.status ?? '-'} (story=${story.source_recovery?.sources?.story?.status ?? '-'}, spec=${story.source_recovery?.sources?.spec?.status ?? '-'}, architecture=${story.source_recovery?.sources?.architecture?.status ?? '-'})
- 理由:
${story.reasons.map((reason) => `  - ${reason}`).join('\n') || '  - -'}
- 次コマンド: \`${story.next_command}\``).join('\n\n');
  const tasks = plan.task_candidates.length === 0
    ? '| Story | Task | Purpose |\n|-------|------|---------|\n| - | - | - |'
    : `| Story | Task | Purpose |
|-------|------|---------|
${plan.task_candidates.map((task) => `| ${task.story_id} | ${task.title} | ${task.purpose} |`).join('\n')}`;
  const sourceRecoveryMap = renderSourceRecoveryMap(plan.source_recovery_map);
  return `# Story実行計画

## サマリー

| 項目 | 内容 |
|------|------|
| 生成日時 | ${plan.generated_at} |
| Story数 | ${plan.summary.story_count} |
| Coverage | ${plan.summary.coverage_status} (${formatPercent(plan.summary.coverage_ratio)}) |
| 未カバー | ${plan.summary.uncovered_files} |
| 警告 | ${plan.summary.warning_count ?? 0} |
| 未決事項 | ${plan.summary.open_question_count} |
| Source Consistency | ${plan.summary.source_consistency_status ?? '-'} |
| 正本復元対象Story | ${plan.summary.source_recovery_story_count ?? 0} |
| Spec欠落 | ${plan.summary.source_missing_spec_count ?? 0} |
| Architecture/ADR判断欠落 | ${plan.summary.source_missing_architecture_count ?? 0} |
| 潜在バグ候補 | ${plan.summary.source_alignment_finding_count ?? 0} |
| 高リスク潜在バグ候補 | ${plan.summary.source_alignment_high_count ?? 0} |

## まず確認する質問

${questions}

## 優先Story

${stories}

## 正本欠落マップ

${sourceRecoveryMap}

## 潜在バグ候補

${renderSourceAlignmentFindings(plan.source_alignment_findings)}

## タスク候補

${tasks}

## 次コマンド

${plan.next_commands.map((command) => `- \`${command}\``).join('\n') || '-'}
`;
}

function renderSourceAlignmentFindings(findings) {
  const rows = findings?.top ?? [];
  if (rows.length === 0) return '- なし';
  return `| Severity | Story | Type | Potential Bug | Review |
|----------|-------|------|---------------|--------|
${rows.map((row) => `| ${escapeTableCell(row.severity)} | ${escapeTableCell(row.story_id)} | ${escapeTableCell(row.type)} | ${escapeTableCell(row.potential_bug)} | ${escapeTableCell(row.recommended_review)} |`).join('\n')}`;
}

function renderSourceRecoveryMap(map) {
  const rows = map?.missing ?? [];
  if (rows.length === 0) return '- なし';
  return `| Story | Spec | Spec復元先 | Architecture | ADR復元先 | Graph | Task |
|-------|------|------------|--------------|-----------|-------|------|
${rows.map((row) => `| ${escapeTableCell(row.story_id)} | ${escapeTableCell(row.spec.status)} | ${escapeTableCell(row.spec.suggested_path ?? '-')} | ${escapeTableCell(row.architecture.status)} | ${escapeTableCell(row.architecture.suggested_path ?? '-')} | ${escapeTableCell(formatSourceRecoveryMapGraph(row.graph))} | ${escapeTableCell(formatSourceRecoveryMapTasks(row))} |`).join('\n')}`;
}

function formatSourceRecoveryMapGraph(graph) {
  return `${graph?.matched_file_count ?? 0} files / ${graph?.related_edge_count ?? 0} edges${graph?.cross_community ? ' / cross-community' : ''}`;
}

function formatSourceRecoveryMapTasks(row) {
  return [
    row.spec.task_candidate_id ?? row.spec.suggested_task_id,
    row.architecture.task_candidate_id ?? row.architecture.suggested_task_id
  ].filter(Boolean).join(', ') || '-';
}

function escapeTableCell(value) {
  return String(value ?? '-').replace(/\|/g, '\\|').replace(/\n/g, '<br>');
}

function formatPercent(value) {
  if (typeof value !== 'number') return '-';
  return `${Math.round(value * 1000) / 10}%`;
}

function renderStoryArchitectureViews(views) {
  return `| View | 判定 |
|------|------|
| Structure | ${[
    ...(views.structure?.containers ?? []),
    ...(views.structure?.components ?? []),
    ...(views.structure?.frameworks ?? [])
  ].join(', ') || '-'} |
| Runtime | ${[
    `${views.runtime?.entrypoints?.length ?? 0} entrypoints`,
    ...(views.runtime?.server_boundaries ?? [])
  ].join(', ')} |
| Data | ${[
    ...(views.data?.stores ?? []),
    ...(views.data?.access_patterns ?? [])
  ].join(', ') || '-'} |
| Security | ${[
    `${views.security?.auth_boundaries?.length ?? 0} auth boundaries`,
    `${views.security?.secret_files?.length ?? 0} secret files`
  ].join(', ')} |
| Deployment | ${(views.deployment?.targets ?? []).join(', ') || '-'} |
| Quality | ${[
    ...(views.quality?.test_tools ?? []),
    ...(views.quality?.ci ?? [])
  ].join(', ') || '-'} |`;
}

export function resolveStoryContext(config) {
  const stories = normalizeActiveStories(config.brainbase?.stories);
  const currentStoryId = config.brainbase?.current_story_id ?? null;
  const currentStory = stories.find((story) => story.story_id === currentStoryId) ?? stories[0];
  return { stories, currentStory };
}

function resolveStory(config, storyId = null) {
  const stories = normalizeActiveStories(config.brainbase?.stories);
  const targetStoryId = storyId ?? config.brainbase?.current_story_id ?? null;
  const story = targetStoryId
    ? stories.find((item) => item.story_id === targetStoryId)
    : stories[0];
  if (!story) throw new Error(`Story not found: ${targetStoryId}`);
  return story;
}

function getRunsForStory(manifest, storyId) {
  const runs = Array.isArray(manifest.runs) ? manifest.runs : [];
  return runs.filter((run) => run.story_id === storyId);
}

function findLatestStoryRun(manifest, storyId, runs) {
  const latestRunId = manifest.latest_run_by_story?.[storyId] ?? null;
  return runs.find((run) => run.run_id === latestRunId) ?? runs[0] ?? null;
}

async function readRunEvidence(repoRoot, run) {
  const evidencePath = run.artifacts?.evidence;
  if (!evidencePath) return null;
  return JSON.parse(await readFile(path.resolve(repoRoot, evidencePath), 'utf8'));
}

export function normalizeActiveStories(stories) {
  const sourceStories = Array.isArray(stories) && stories.length > 0 ? stories : DEFAULT_BRAINBASE_STORIES;
  const activeStories = sourceStories.filter((story) => !isArchived(story));
  if (activeStories.length === 0) {
    throw new Error('At least one active story is required');
  }
  return activeStories.map((story) => ({
    story_id: story.story_id,
    title: story.title,
    ssot: story.ssot ?? 'NocoDB',
    status: story.status ?? 'active',
    horizon: story.horizon ?? null,
    view: typeof story.view === 'string' ? story.view : null,
    period: typeof story.period === 'string' ? story.period : null,
    started_at: story.started_at ?? null,
    due_at: story.due_at ?? null,
    category: story.category ?? null
  }));
}

async function readConfig(repoRoot) {
  await initWorkspace(repoRoot);
  return JSON.parse(await readFile(getConfigPath(repoRoot), 'utf8'));
}

async function writeConfig(repoRoot, config) {
  await writeFile(getConfigPath(repoRoot), `${JSON.stringify(config, null, 2)}\n`);
}

function getConfigPath(repoRoot) {
  return path.join(getWorkspaceDir(repoRoot), 'config.json');
}

function getStories(config) {
  return Array.isArray(config.brainbase?.stories) ? config.brainbase.stories : [];
}

async function readExistingStoryCatalog(repoRoot) {
  const catalogPath = path.join(getWorkspaceDir(repoRoot), 'stories', 'story-catalog.json');
  try {
    return JSON.parse(await readFile(catalogPath, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

function mergeDerivedStories(config, derivedStories, previousCatalog = null) {
  const stories = getStories(config);
  const existingIds = new Set(stories.map((story) => story.story_id));
  const derivedById = new Map(derivedStories.map((story) => [story.story_id, story]));
  const currentDerivedIds = new Set(derivedStories.map((story) => story.story_id));
  const previousDerivedIds = new Set((previousCatalog?.stories ?? []).map((story) => story.story_id));
  let archivedCount = 0;
  let updatedCount = 0;
  for (const story of stories) {
    const derivedStory = derivedById.get(story.story_id);
    if (derivedStory && shouldUpdateDerivedStory(story, previousDerivedIds)) {
      Object.assign(story, toConfigStory(derivedStory));
      updatedCount += 1;
      continue;
    }
    if (!shouldArchiveStaleDerivedStory(story, currentDerivedIds, previousDerivedIds)) continue;
    story.status = 'archived';
    archivedCount += 1;
  }
  const additions = derivedStories
    .filter((story) => !existingIds.has(story.story_id))
    .map(toConfigStory);
  config.brainbase = {
    ...(config.brainbase ?? {}),
    stories: [...stories, ...additions]
  };
  return {
    added_count: additions.length,
    archived_count: archivedCount,
    updated_count: updatedCount,
    skipped_count: derivedStories.length - additions.length - updatedCount
  };
}

function toConfigStory(story) {
  return {
    story_id: story.story_id,
    title: story.title,
    ssot: story.ssot ?? 'local',
    status: story.status ?? 'active',
    horizon: story.horizon ?? null,
    view: story.view ?? null,
    period: story.period ?? null,
    started_at: story.started_at ?? null,
    due_at: story.due_at ?? null,
    category: story.category ?? null,
    derived_by: 'vibepro-story-derive'
  };
}

function shouldArchiveStaleDerivedStory(story, currentDerivedIds, previousDerivedIds) {
  if (story.ssot !== 'local') return false;
  if (currentDerivedIds.has(story.story_id)) return false;
  if (story.derived_by === 'vibepro-story-derive') return true;
  if (previousDerivedIds.has(story.story_id)) return true;
  return isLikelyObsoleteDocumentStory(story);
}

function shouldUpdateDerivedStory(story, previousDerivedIds) {
  if (story.ssot !== 'local') return false;
  if (story.derived_by === 'vibepro-story-derive') return true;
  if (previousDerivedIds.has(story.story_id)) return true;
  return false;
}

function isLikelyObsoleteDocumentStory(story) {
  if (!/^story-(product|architecture)-/.test(story.story_id)) return false;
  return /(仕様|要件|REQ-\d+|US-\d+|アーキテクチャ|設計|ガイド|ロードマップ|システムドキュメント|現在の実装|セットアップチェックリスト|インターフェース|テクノロジースタック|シーケンス図|sequence diagram|関係図|バージョン情報|フロー|構造)/i.test(story.title ?? '');
}

function renderStoryMapCatalog(catalog) {
  return renderStoryCatalogMap(catalog);
}

function toWorkspaceRelativeFromAny(filePath) {
  const marker = `${path.sep}.vibepro${path.sep}`;
  const index = filePath.indexOf(marker);
  if (index === -1) return filePath;
  return `.vibepro/${filePath.slice(index + marker.length).split(path.sep).join('/')}`;
}

function buildStory(options) {
  if (!options.story_id) throw new Error('--id is required');
  if (!options.title) throw new Error('--title is required');
  return {
    story_id: options.story_id,
    title: options.title,
    ssot: 'local',
    status: 'active',
    horizon: options.horizon ?? null,
    view: options.view ?? null,
    period: options.period ?? null,
    started_at: options.started_at ?? null,
    due_at: options.due_at ?? null
  };
}

function getOption(args, name) {
  const index = args.indexOf(name);
  if (index === -1) return null;
  return args[index + 1] ?? null;
}

function isArchived(story) {
  return story.status === 'archived' || story.status === 'アーカイブ';
}
