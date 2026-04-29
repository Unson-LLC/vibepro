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

export async function createBrainbaseImport(repoRoot) {
  await initWorkspace(repoRoot);
  const root = path.resolve(repoRoot);
  const manifest = await readManifest(root);
  const config = await readConfig(root);
  const storyContext = resolveStoryContext(config);
  const latestRun = findLatestRun(manifest, storyContext.currentStory.story_id);
  const evidence = await readLatestEvidence(root, latestRun);

  const brainbaseDir = path.join(getWorkspaceDir(root), 'brainbase');
  await mkdir(brainbaseDir, { recursive: true });

  const importState = buildImportState({ manifest, storyContext, latestRun, evidence });
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

function buildImportState({ manifest, storyContext, latestRun, evidence }) {
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
        route_examples: candidate.route_examples ?? []
      }))
    },
    gates: evidence.gates ?? [],
    findings: findings.map((finding) => ({
      id: finding.id,
      severity: finding.severity,
      category: finding.category,
      title: finding.title
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
  return `| ID | 対応する検出事項 | 候補 | 対象 | 方針 |
|----|------------------|------|------|------|
${candidates.map((candidate) => `| ${candidate.id} | ${candidate.finding_id} | ${candidate.title} | ${candidate.target_count}件 | ${candidate.execution_policy} / mutates_repository=${candidate.mutates_repository} |`).join('\n')}`;
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
