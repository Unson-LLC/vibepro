import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { DEFAULT_BRAINBASE_STORIES, getWorkspaceDir, initWorkspace, readManifest, toWorkspaceRelative, writeManifest } from './workspace.js';

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
  const storyDir = path.join(getWorkspaceDir(root), 'stories', story.story_id);
  await mkdir(storyDir, { recursive: true });
  const reportPath = path.join(storyDir, 'story-report.md');
  await writeFile(reportPath, renderStoryReport({ story, latestRun, runs, evidence }));
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

export function parseStoryOptions(args) {
  const options = {};
  for (const [flag, key] of STORY_FIELDS) {
    const value = getOption(args, flag);
    if (value !== null) options[key] = value;
  }
  return options;
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

export function renderStoryReport({ story, latestRun, runs, evidence }) {
  const graphify = evidence?.graphify ?? {};
  const architectureProfile = evidence?.architecture_profile ?? {};
  const applicableChecks = evidence?.check_catalog?.applicable_checks ?? architectureProfile.applicable_checks ?? [];
  const staticSite = evidence?.static_site ?? {};
  const findings = Array.isArray(evidence?.findings) ? evidence.findings : [];
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
| 描画方式 | ${architectureProfile.rendering ?? '-'} |
| API route | ${architectureProfile.has_api_routes ? 'あり' : 'なし'} |
| DB | ${architectureProfile.has_database ? (architectureProfile.database ?? []).join(', ') || 'あり' : 'なし'} |
| 認証 | ${architectureProfile.has_auth ? (architectureProfile.auth ?? []).join(', ') || 'あり' : 'なし'} |
| 適用チェック | ${applicableChecks.join(', ') || '-'} |

## ${scanHeading}

| 項目 | 内容 |
|------|------|
| index.html | ${staticSite.has_index_html ? 'あり' : 'なし'} |
| scanned files | ${staticSite.scanned_files ?? 0} |
| secret hits | ${staticSite.secret_hits?.length ?? 0} |
| XSS risk hits | ${staticSite.xss_risk_hits?.length ?? 0} |
| external resources | ${staticSite.external_resources?.length ?? 0} |
| non static files | ${staticSite.non_static_files?.length ?? 0} |

## 検出事項

${findings.length === 0 ? '- なし' : findings.map((finding) => `- ${finding.id}: ${finding.title}（${finding.severity}）`).join('\n')}

## Artifacts

${Object.entries(artifacts).length === 0 ? '- なし' : Object.entries(artifacts).map(([key, value]) => `- ${key}: ${value}`).join('\n')}

## 次に見るファイル

- ${artifacts.summary ?? '-'}
- ${artifacts.risk_register ?? '-'}
- ${artifacts.evidence ?? '-'}
`;
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
    due_at: story.due_at ?? null
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
