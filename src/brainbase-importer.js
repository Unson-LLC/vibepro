import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
  getWorkspaceDir,
  initWorkspace,
  readManifest,
  toWorkspaceRelative,
  writeManifest
} from './workspace.js';
import { resolveStoryContext } from './story-manager.js';
import { readStoryTasks } from './story-task-generator.js';

export async function createBrainbaseImport(repoRoot) {
  await initWorkspace(repoRoot);
  const root = path.resolve(repoRoot);
  const manifest = await readManifest(root);
  const config = await readConfig(root);
  const storyContext = resolveStoryContext(config);
  const latestRun = findLatestRun(manifest, storyContext.currentStory.story_id);
  const evidence = await readLatestEvidence(root, latestRun);
  const taskState = await readStoryTasks(root, latestRun.artifacts?.story_tasks_json);

  const brainbaseDir = path.join(getWorkspaceDir(root), 'brainbase');
  await mkdir(brainbaseDir, { recursive: true });

  const importState = buildImportState({ manifest, storyContext, latestRun, evidence, taskState });
  const importStatePath = path.join(brainbaseDir, 'import-state.json');
  const importSummaryPath = path.join(brainbaseDir, 'import-summary.md');

  await writeFile(importStatePath, `${JSON.stringify(importState, null, 2)}\n`);
  await writeFile(importSummaryPath, renderImportSummary(importState));

  manifest.artifacts = {
    ...(manifest.artifacts ?? {}),
    brainbase_import_state: toWorkspaceRelative(root, importStatePath),
    brainbase_import_summary: toWorkspaceRelative(root, importSummaryPath)
  };
  manifest.brainbase = {
    ...(manifest.brainbase ?? {}),
    last_export: {
      exported_at: importState.generated_at,
      story_id: importState.story.story_id,
      latest_run_id: importState.latest_run.run_id,
      latest_run_story_id: importState.latest_run.story_id,
      gate_status: importState.latest_run.gate_status,
      import_state: toWorkspaceRelative(root, importStatePath)
    }
  };
  await writeManifest(root, manifest);

  return { brainbaseDir, importStatePath, importSummaryPath, importState };
}

function findLatestRun(manifest, storyId) {
  const latestRunId = manifest.latest_run;
  const runs = Array.isArray(manifest.runs) ? manifest.runs : [];
  const latestStoryRunId = storyId ? manifest.latest_run_by_story?.[storyId] : null;
  const latestRun = runs.find((run) => run.run_id === latestStoryRunId)
    ?? runs.find((run) => run.story_id === storyId)
    ?? runs.find((run) => run.run_id === latestRunId)
    ?? runs[0];
  if (!latestRun) {
    throw new Error('VibePro diagnosis run not found. Run `vibepro diagnose` first.');
  }
  return latestRun;
}

async function readLatestEvidence(repoRoot, latestRun) {
  const evidencePath = latestRun.artifacts?.evidence;
  if (!evidencePath) {
    throw new Error(`evidence artifact is missing for run: ${latestRun.run_id}`);
  }
  return JSON.parse(await readFile(path.resolve(repoRoot, evidencePath), 'utf8'));
}

async function readConfig(repoRoot) {
  return JSON.parse(await readFile(path.join(getWorkspaceDir(repoRoot), 'config.json'), 'utf8'));
}

function buildImportState({ manifest, storyContext, latestRun, evidence, taskState }) {
  const graphify = evidence.graphify ?? {};
  const architectureProfile = evidence.architecture_profile ?? {};
  const checkCatalog = evidence.check_catalog ?? {};
  const apiBoundary = evidence.api_boundary ?? {};
  const staticSite = evidence.static_site ?? {};
  const findings = Array.isArray(evidence.findings) ? evidence.findings : [];
  const actionCandidates = Array.isArray(evidence.action_candidates) ? evidence.action_candidates : [];
  const stories = storyContext.stories;
  const primaryStory = storyContext.currentStory;

  return {
    schema_version: '0.1.0',
    generated_at: new Date().toISOString(),
    source: {
      tool: 'vibepro',
      manifest: '.vibepro/vibepro-manifest.json',
      repo: manifest.repo ?? { root: '.' }
    },
    story: primaryStory,
    stories,
    latest_run: {
      run_id: latestRun.run_id,
      story_id: latestRun.story_id ?? evidence.story_id ?? null,
      created_at: latestRun.created_at ?? null,
      gate_status: latestRun.gate_status ?? evidence.gates?.[0]?.status ?? 'unknown',
      artifacts: latestRun.artifacts ?? {}
    },
    signals: {
      graphify: {
        node_count: graphify.node_count ?? 0,
        edge_count: graphify.edge_count ?? 0,
        edge_source_key: graphify.edge_source_key ?? null,
        extracted_edges_count: graphify.extracted_edges?.length ?? 0,
        inferred_edges_count: graphify.inferred_edges?.length ?? 0,
        ambiguous_edges_count: graphify.ambiguous_edges?.length ?? 0
      },
      architecture_profile: {
        app_type: architectureProfile.app_type ?? 'unknown',
        system_type: architectureProfile.system_type ?? 'unknown',
        rendering: architectureProfile.rendering ?? null,
        frameworks: architectureProfile.frameworks ?? [],
        package_manager: architectureProfile.package_manager ?? null,
        languages: architectureProfile.languages ?? [],
        views: architectureProfile.views ?? {},
        has_api_routes: Boolean(architectureProfile.has_api_routes),
        has_database: Boolean(architectureProfile.has_database),
        database: architectureProfile.database ?? [],
        has_auth: Boolean(architectureProfile.has_auth),
        auth: architectureProfile.auth ?? [],
        deployment: architectureProfile.deployment ?? []
      },
      check_catalog: {
        selected_views: checkCatalog.selected_views ?? architectureProfile.selected_views ?? [],
        applicable_checks: checkCatalog.applicable_checks ?? architectureProfile.applicable_checks ?? []
      },
      api_boundary: {
        route_count: apiBoundary.route_count ?? 0,
        summary: apiBoundary.summary ?? {},
        protection_summary: apiBoundary.protection_summary ?? {},
        risk_hint_count: Array.isArray(apiBoundary.routes)
          ? apiBoundary.routes.reduce((count, route) => count + (route.risk_hints?.length ?? 0), 0)
          : 0
      },
      static_site: {
        has_index_html: Boolean(staticSite.has_index_html),
        scanned_files: staticSite.scanned_files ?? 0,
        secret_hits_count: staticSite.secret_hits?.length ?? 0,
        secret_hits_gate_summary: staticSite.risk_summary?.secret_hits ?? summarizeGateEffects(staticSite.secret_hits),
        xss_risk_hits_count: staticSite.xss_risk_hits?.length ?? 0,
        xss_risk_hits_gate_summary: staticSite.risk_summary?.xss_risk_hits ?? summarizeGateEffects(staticSite.xss_risk_hits),
        external_resources_count: staticSite.external_resources?.length ?? 0,
        non_static_files_count: staticSite.non_static_files?.length ?? 0
      },
      tasks: Array.isArray(taskState?.tasks) ? taskState.tasks : [],
      action_candidates: actionCandidates.map((candidate) => ({
        id: candidate.id,
        finding_id: candidate.finding_id,
        scope: candidate.scope,
        title: candidate.title,
        target_count: candidate.target_count,
        execution_policy: candidate.execution_policy,
        mutates_repository: candidate.mutates_repository,
        confidence: candidate.confidence,
        recommendation: candidate.recommendation,
        route_examples: candidate.route_examples ?? [],
        graph_context: candidate.graph_context ?? emptyGraphContext(),
        implementation_plan: candidate.implementation_plan ?? emptyImplementationPlan()
      }))
    },
    gates: evidence.gates ?? [],
    findings: findings.map((finding) => ({
      id: finding.id,
      severity: finding.severity,
      category: finding.category,
      title: finding.title,
      graph_context: finding.graph_context ?? null
    }))
  };
}

function renderImportSummary(importState) {
  return `# Brainbase 取り込み状態

| 項目 | 内容 |
|------|------|
| Story | ${importState.story.title} |
| Story ID | ${importState.story.story_id} |
| Story数 | ${importState.stories.length} |
| Run ID | ${importState.latest_run.run_id} |
| Run Story ID | ${importState.latest_run.story_id ?? '-'} |
| Gate | ${importState.latest_run.gate_status} |
| 種別 | ${importState.signals.architecture_profile.app_type} |
| System type | ${importState.signals.architecture_profile.system_type} |
| 描画方式 | ${importState.signals.architecture_profile.rendering ?? '-'} |
| 選択View | ${importState.signals.check_catalog.selected_views.join(', ') || '-'} |
| 適用チェック | ${importState.signals.check_catalog.applicable_checks.join(', ') || '-'} |
| graphify nodes | ${importState.signals.graphify.node_count} |
| graphify edges | ${importState.signals.graphify.edge_count} |
| API route | ${importState.signals.api_boundary.route_count}件 |
| API境界risk hints | ${importState.signals.api_boundary.risk_hint_count}件 |
| 共通スキャン対象 | ${importState.signals.static_site.scanned_files}件 |
| 秘密情報候補 | ${formatRiskCount(importState.signals.static_site.secret_hits_count, importState.signals.static_site.secret_hits_gate_summary)} |
| XSSリスク候補 | ${formatRiskCount(importState.signals.static_site.xss_risk_hits_count, importState.signals.static_site.xss_risk_hits_gate_summary)} |
| 検出事項 | ${importState.findings.length}件 |

## API境界

${renderApiBoundaryImportSummary(importState.signals.api_boundary)}

## 成果物

${Object.entries(importState.latest_run.artifacts).map(([key, value]) => `- ${key}: ${value}`).join('\n')}

## 対象Story

${importState.stories.map((story) => `- ${story.title} (${story.story_id}) / Horizon: ${story.horizon ?? '-'} / View: ${story.view ?? '-'} / Period: ${story.period ?? '-'} / ${story.started_at ?? '-'} - ${story.due_at ?? '-'}`).join('\n')}

## 検出事項

${importState.findings.length === 0 ? '- なし' : importState.findings.map((finding) => `- ${finding.id}: ${finding.title}（${finding.severity}）`).join('\n')}

## 次アクション候補

${renderActionCandidates(importState.signals.action_candidates)}

## 生成タスク

${renderGeneratedTasks(importState.signals.tasks)}
`;
}

function renderApiBoundaryImportSummary(apiBoundary) {
  const classificationRows = Object.entries(apiBoundary.summary ?? {})
    .map(([classification, count]) => `| ${classification} | ${count} |`)
    .join('\n');
  const protectionRows = Object.entries(apiBoundary.protection_summary ?? {})
    .map(([status, count]) => `| ${status} | ${count} |`)
    .join('\n');
  return `### 分類別

| 分類 | 件数 |
|------|------|
${classificationRows || '| - | 0 |'}

### 保護状態別

| 保護状態 | 件数 |
|----------|------|
${protectionRows || '| - | 0 |'}`;
}

function renderActionCandidates(candidates) {
  if (!Array.isArray(candidates) || candidates.length === 0) return '- なし';
  return `| ID | 対応する検出事項 | 候補 | 対象 | Impact | Community | 読むファイル | 方針 |
|----|------------------|------|------|--------|-----------|------------|------|
${candidates.map((candidate) => `| ${candidate.id} | ${candidate.finding_id} | ${candidate.title} | ${candidate.target_count}件 | ${formatGraphImpact(candidate.graph_context)} | ${formatGraphCommunities(candidate.graph_context)} | ${formatReadFirstFiles(candidate.implementation_plan)} | ${candidate.execution_policy} / mutates_repository=${candidate.mutates_repository} |`).join('\n')}

${renderImplementationPlans(candidates)}`;
}

function renderGeneratedTasks(tasks) {
  if (!Array.isArray(tasks) || tasks.length === 0) return '- なし';
  return `| ID | 対応する検出事項 | 優先度 | 対象 | グループ | 方針 |
|----|------------------|--------|------|----------|------|
${tasks.map((task) => `| ${task.id} | ${task.finding_id ?? '-'} | ${task.priority} | ${task.target_count ?? task.target_files?.length ?? 0}件 | ${formatTargetGroups(task.target_groups)} | ${task.recommended_strategy?.id ?? '-'} |`).join('\n')}`;
}

function formatTargetGroups(groups = []) {
  if (!Array.isArray(groups) || groups.length === 0) return '-';
  return groups.map((group) => `${group.id}(${group.route_count})`).join(', ');
}

function emptyGraphContext() {
  return {
    matched_route_count: 0,
    matched_node_count: 0,
    affected_communities: [],
    hub_nodes: [],
    related_edge_count: 0,
    impact_score: 0
  };
}

function emptyImplementationPlan() {
  return {
    priority: 'low',
    rationale: '',
    read_first_files: [],
    steps: [],
    acceptance_criteria: [],
    pre_fix_briefing: null
  };
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

function summarizeGateEffects(hits = []) {
  const summary = { block: 0, review: 0, info: 0 };
  for (const hit of hits ?? []) {
    if (hit.gate_effect === 'block') summary.block += 1;
    else if (hit.gate_effect === 'review') summary.review += 1;
    else summary.info += 1;
  }
  return summary;
}

function formatRiskCount(count, summary = {}) {
  return `${count}件 (block: ${summary.block ?? 0}件, review: ${summary.review ?? 0}件, info: ${summary.info ?? 0}件)`;
}
