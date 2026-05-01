import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { generateStoryCatalog, renderStoryCatalogMap } from './story-catalog-generator.js';
import { DEFAULT_BRAINBASE_STORIES, getWorkspaceDir, initWorkspace, readManifest, toWorkspaceRelative, writeManifest } from './workspace.js';
import { readStoryTasks } from './story-task-generator.js';

const STORY_FIELDS = [
  ['--id', 'story_id'],
  ['--title', 'title'],
  ['--horizon', 'horizon'],
  ['--view', 'view'],
  ['--period', 'period'],
  ['--started-at', 'started_at'],
  ['--due-at', 'due_at']
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
  return {
    story,
    latestRun,
    runs,
    findingCount: evidence?.findings?.length ?? 0,
    artifacts: latestRun?.artifacts ?? {}
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
  const storyDir = path.join(getWorkspaceDir(root), 'stories', story.story_id);
  await mkdir(storyDir, { recursive: true });
  const reportPath = path.join(storyDir, 'story-report.md');
  await writeFile(reportPath, renderStoryReport({ story, latestRun, runs, evidence, taskState }));
  manifest.stories = {
    ...(manifest.stories ?? {}),
    [story.story_id]: {
      ...(manifest.stories?.[story.story_id] ?? {}),
      latest_report: toWorkspaceRelative(root, reportPath),
      latest_report_run_id: latestRun.run_id,
      latest_report_generated_at: new Date().toISOString()
    }
  };
  await writeManifest(root, manifest);
  return { story, latestRun, reportPath };
}

export async function deriveStories(repoRoot, options = {}) {
  const root = path.resolve(repoRoot);
  const config = await readConfig(root);
  const manifest = await readManifest(root);
  const previousCatalog = await readExistingStoryCatalog(root);
  const catalog = await generateStoryCatalog(root, {
    config,
    manifest,
    fromRunId: options.fromRunId,
    preset: options.preset
  });
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
  const manifest = await readManifest(root);
  const { catalog, catalogPath } = await readStoryMap(root);
  const limit = Number.isInteger(options.limit) && options.limit > 0 ? options.limit : 5;
  const plan = buildStoryExecutionPlan(catalog, { limit });
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
`;
}

export function renderStoryReport({ story, latestRun, runs, evidence, taskState = null }) {
  const graphify = evidence?.graphify ?? {};
  const architectureProfile = evidence?.architecture_profile ?? {};
  const applicableChecks = evidence?.check_catalog?.applicable_checks ?? architectureProfile.applicable_checks ?? [];
  const apiBoundary = evidence?.api_boundary ?? null;
  const staticSite = evidence?.static_site ?? {};
  const findings = Array.isArray(evidence?.findings) ? evidence.findings : [];
  const findingReview = evidence?.finding_review ?? {};
  const actionCandidates = Array.isArray(evidence?.action_candidates) ? evidence.action_candidates : [];
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
    .map((community) => `${community.id}(route: ${community.route_count}, node: ${community.node_count}, edge: ${community.edge_count})`)
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

function buildStoryExecutionPlan(catalog, options = {}) {
  const stories = Array.isArray(catalog?.stories) ? catalog.stories : [];
  const scoredStories = stories
    .map((story) => scoreStoryForExecution(story, catalog))
    .sort((a, b) => b.score - a.score || a.story_id.localeCompare(b.story_id));
  const priorityStories = scoredStories.slice(0, options.limit ?? 5);
  const questions = buildPlanQuestions(catalog, priorityStories);
  const taskCandidates = [
    ...buildWarningTaskCandidates(catalog),
    ...priorityStories.flatMap((story) => buildTaskCandidatesForStory(story))
  ];
  const warnings = catalog.source?.warnings ?? [];
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
      warning_count: warnings.length
    },
    questions,
    priority_stories: priorityStories,
    task_candidates: taskCandidates,
    next_commands: buildStoryPlanNextCommands(priorityStories)
  };
}

function scoreStoryForExecution(story, catalog) {
  const fields = new Set((story.derived?.open_questions ?? []).map((item) => item.field));
  const meaning = story.derived?.meaning ?? {};
  const sourceType = story.source?.type ?? '';
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
  if (fields.has('period')) add(6, 'NocoDB Periodが未確定');
  if (meaning.confidence === 'low') add(18, 'Story意味づけの総合信頼度が低い');
  if (meaning.confidence === 'medium') add(8, 'Story意味づけに確認余地がある');
  if (sourceType === 'code_surface') add(8, 'コードから逆算したStoryで人間レビューが必要');
  if (story.view === 'business' && story.category === 'product') add(5, 'ユーザー価値と事業価値に近いproduct Story');
  score += workflowStageWeight(meaning.workflow_position?.stage);

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
    workflow_stage: meaning.workflow_position?.stage ?? 'unknown',
    target_files: resolveStoryPlanTargetFiles(story),
    read_first_files: resolveStoryPlanReadFirstFiles(story),
    acceptance_focus: story.derived?.story_definition?.acceptance_focus ?? [],
    reasons,
    next_command: `vibepro story select . --id ${story.story_id}`
  };
}

function resolveStoryPlanTargetFiles(story) {
  const meaning = story.derived?.meaning ?? {};
  const paths = [
    ...(meaning.code_scope?.evidence ?? []),
    ...(story.source?.paths ?? []).filter((item) => typeof item === 'string' && item.startsWith('src/'))
  ];
  return [...new Set(paths)].slice(0, 12);
}

function resolveStoryPlanReadFirstFiles(story) {
  const files = resolveStoryPlanTargetFiles(story);
  return files.slice(0, 6).map((file) => ({
    file,
    reason: `Story ${story.story_id} の根拠コード`
  }));
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

function buildPlanQuestions(catalog, priorityStories) {
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
  return [...warningQuestions, ...coverageQuestions, ...questions]
    .sort((a, b) => questionPriorityRank(a.priority) - questionPriorityRank(b.priority) || String(a.story_id ?? '').localeCompare(String(b.story_id ?? '')))
    .slice(0, 20);
}

function questionPriority(field) {
  if (field === 'coverage' || field === 'missing_spec' || field === 'missing_evidence') return 'high';
  if (field === 'business_metric' || field === 'business_context') return 'medium';
  return 'low';
}

function questionPriorityRank(priority) {
  return { high: 0, medium: 1, low: 2 }[priority] ?? 3;
}

function buildTaskCandidatesForStory(story) {
  const fields = new Set((story.reasons ?? []).flatMap((reason) => reason.includes('仕様/Story') ? ['missing_spec'] : []));
  const candidates = [];
  const push = (suffix, title, purpose, acceptance) => {
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
      recommended_strategy: {
        id: suffix,
        reason: purpose
      },
      implementation_steps: buildPlanCandidateSteps(suffix),
      suggested_command: `vibepro story select . --id ${story.story_id}`
    });
  };

  if (fields.has('missing_spec') || story.source_type === 'code_surface') {
    push('spec-recovery', '仕様/Story根拠を復元する', 'コードから逆算したStoryの根拠文書、対象ユーザー、成功条件を確認する', [
      'missing_spec が残る理由を確認済みにする',
      'Storyのwho/problem/outcomeが人間レビュー済みになる',
      '必要なら仕様書またはNocoDB Storyを作る'
    ]);
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
      { id: 'recover-source', title: '根拠を復元する', detail: '仕様書、NocoDB Story、議事録、コード根拠のどれを正本にするか決める' },
      { id: 'update-story', title: 'Storyを更新する', detail: 'who/problem/outcome/acceptanceを人間レビュー済みの形にする' }
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
    firstStory ? `vibepro story diagnose . --id ${firstStory.story_id} --run-graphify` : null
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
- 理由:
${story.reasons.map((reason) => `  - ${reason}`).join('\n') || '  - -'}
- 次コマンド: \`${story.next_command}\``).join('\n\n');
  const tasks = plan.task_candidates.length === 0
    ? '| Story | Task | Purpose |\n|-------|------|---------|\n| - | - | - |'
    : `| Story | Task | Purpose |
|-------|------|---------|
${plan.task_candidates.map((task) => `| ${task.story_id} | ${task.title} | ${task.purpose} |`).join('\n')}`;
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

## まず確認する質問

${questions}

## 優先Story

${stories}

## タスク候補

${tasks}

## 次コマンド

${plan.next_commands.map((command) => `- \`${command}\``).join('\n') || '-'}
`;
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
