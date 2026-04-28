import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
  DEFAULT_BRAINBASE_STORIES,
  getWorkspaceDir,
  initWorkspace,
  readManifest,
  toWorkspaceRelative,
  writeManifest
} from './workspace.js';

export async function createBrainbaseImport(repoRoot) {
  await initWorkspace(repoRoot);
  const root = path.resolve(repoRoot);
  const manifest = await readManifest(root);
  const config = await readConfig(root);
  const latestRun = findLatestRun(manifest);
  const evidence = await readLatestEvidence(root, latestRun);

  const brainbaseDir = path.join(getWorkspaceDir(root), 'brainbase');
  await mkdir(brainbaseDir, { recursive: true });

  const importState = buildImportState({ manifest, config, latestRun, evidence });
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
      latest_run_id: importState.latest_run.run_id,
      gate_status: importState.latest_run.gate_status,
      import_state: toWorkspaceRelative(root, importStatePath)
    }
  };
  await writeManifest(root, manifest);

  return { brainbaseDir, importStatePath, importSummaryPath, importState };
}

function findLatestRun(manifest) {
  const latestRunId = manifest.latest_run;
  const runs = Array.isArray(manifest.runs) ? manifest.runs : [];
  const latestRun = runs.find((run) => run.run_id === latestRunId) ?? runs[0];
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

function buildImportState({ manifest, config, latestRun, evidence }) {
  const graphify = evidence.graphify ?? {};
  const staticSite = evidence.static_site ?? {};
  const findings = Array.isArray(evidence.findings) ? evidence.findings : [];
  const stories = normalizeStories(config.brainbase?.stories);
  const primaryStory = stories[0];

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
      static_site: {
        has_index_html: Boolean(staticSite.has_index_html),
        scanned_files: staticSite.scanned_files ?? 0,
        secret_hits_count: staticSite.secret_hits?.length ?? 0,
        xss_risk_hits_count: staticSite.xss_risk_hits?.length ?? 0,
        external_resources_count: staticSite.external_resources?.length ?? 0,
        non_static_files_count: staticSite.non_static_files?.length ?? 0
      }
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

function normalizeStories(stories) {
  const sourceStories = Array.isArray(stories) && stories.length > 0 ? stories : DEFAULT_BRAINBASE_STORIES;
  return sourceStories.map((story) => ({
    story_id: story.story_id,
    title: story.title,
    ssot: story.ssot ?? 'NocoDB',
    view: {
      view_id: story.view?.view_id ?? story.view_id ?? null,
      view_name: story.view?.view_name ?? story.view_name ?? null
    },
    period: {
      from: story.period?.from ?? null,
      to: story.period?.to ?? null
    }
  }));
}

function renderImportSummary(importState) {
  return `# Brainbase 取り込み状態

| 項目 | 内容 |
|------|------|
| Story | ${importState.story.title} |
| Story ID | ${importState.story.story_id} |
| Story数 | ${importState.stories.length} |
| Run ID | ${importState.latest_run.run_id} |
| Gate | ${importState.latest_run.gate_status} |
| graphify nodes | ${importState.signals.graphify.node_count} |
| graphify edges | ${importState.signals.graphify.edge_count} |
| 静的サイト走査ファイル | ${importState.signals.static_site.scanned_files}件 |
| 秘密情報候補 | ${importState.signals.static_site.secret_hits_count}件 |
| XSSリスク候補 | ${importState.signals.static_site.xss_risk_hits_count}件 |
| 検出事項 | ${importState.findings.length}件 |

## 成果物

${Object.entries(importState.latest_run.artifacts).map(([key, value]) => `- ${key}: ${value}`).join('\n')}

## 対象Story

${importState.stories.map((story) => `- ${story.title} (${story.story_id}) / ${story.view.view_name ?? '-'} / ${story.period.from ?? '-'} - ${story.period.to ?? '-'}`).join('\n')}

## 検出事項

${importState.findings.length === 0 ? '- なし' : importState.findings.map((finding) => `- ${finding.id}: ${finding.title}（${finding.severity}）`).join('\n')}
`;
}
