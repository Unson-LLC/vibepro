import { access, readFile } from 'node:fs/promises';
import path from 'node:path';

import { runDoctor } from './doctor.js';
import { DEFAULT_BRAINBASE_STORIES, getWorkspaceDir, MANIFEST_FILE } from './workspace.js';

export async function getRepoStatus(repoRoot) {
  const root = path.resolve(repoRoot);
  const workspaceDir = getWorkspaceDir(root);
  const configPath = path.join(workspaceDir, 'config.json');
  const manifestPath = path.join(workspaceDir, MANIFEST_FILE);
  const initialized = await exists(configPath) && await exists(manifestPath);

  if (!initialized) {
    return {
      initialized: false,
      repo_root: root,
      workspace: '.vibepro',
      current_story_id: null,
      active_stories: [],
      latest_run: null,
      selected_story_latest_run: null,
      gate_status: null,
      finding_count: 0,
      artifacts: {},
      next_commands: [`vibepro init ${root}`]
    };
  }

  const configRead = await readJsonWithStatus(configPath, 'config');
  const manifestRead = await readJsonWithStatus(manifestPath, 'manifest');
  if (!configRead.ok || !manifestRead.ok) {
    const issues = [configRead, manifestRead]
      .filter((item) => !item.ok)
      .map((item) => ({
        id: `VP-STATUS-${item.label.toUpperCase()}-INVALID`,
        severity: 'block',
        file: toWorkspacePath(root, item.filePath),
        detail: `${item.label} JSON is invalid: ${item.error}`
      }));
    return {
      initialized: true,
      repo_root: root,
      workspace: '.vibepro',
      workspace_status: 'needs_repair',
      current_story_id: null,
      active_stories: [],
      latest_run: null,
      selected_story_latest_run: null,
      gate_status: 'blocked',
      finding_count: issues.length,
      artifacts: {},
      doctor: {
        overall_status: 'needs_repair',
        check_count: issues.length,
        blocking_check_ids: issues.map((issue) => issue.id),
        next_actions: [{
          command: `repair ${toWorkspacePath(root, configRead.ok ? manifestPath : configPath)}`,
          reason: 'VibePro workspace JSON must be valid before status, diagnose, or PR gates can be trusted.'
        }]
      },
      issues,
      next_commands: [
        `repair ${toWorkspacePath(root, configRead.ok ? manifestPath : configPath)}`,
        `vibepro status ${root} --json`
      ]
    };
  }

  const config = configRead.value;
  const manifest = manifestRead.value;
  const currentStoryId = config.brainbase?.current_story_id ?? null;
  const activeStories = prioritizeStory(normalizeStatusStories(config.brainbase?.stories), currentStoryId);
  const selectedStory = activeStories.find((story) => story.story_id === currentStoryId) ?? null;
  const runs = Array.isArray(manifest.runs) ? manifest.runs : [];
  const latestRun = findRun(runs, manifest.latest_run) ?? runs[0] ?? null;
  const selectedStoryLatestRun = selectedStory
    ? findLatestStoryRun(manifest, runs, selectedStory.story_id)
    : null;
  const primaryRun = selectedStoryLatestRun ?? latestRun;
  const evidence = primaryRun ? await readRunEvidence(root, primaryRun) : null;
  const findings = Array.isArray(evidence?.findings) ? evidence.findings : [];
  const doctor = await runDoctor(root, { writeArtifacts: false });

  return {
    initialized: true,
    repo_root: root,
    workspace: '.vibepro',
    current_story_id: currentStoryId,
    active_stories: activeStories,
    latest_run: latestRun,
    selected_story_latest_run: selectedStoryLatestRun,
    gate_status: primaryRun?.gate_status ?? evidence?.gates?.[0]?.status ?? null,
    finding_count: findings.length,
    artifacts: primaryRun?.artifacts ?? {},
    doctor: {
      overall_status: doctor.overall_status,
      check_count: doctor.checks.length,
      blocking_check_ids: doctor.checks
        .filter((check) => ['fixable', 'manual'].includes(check.status))
        .map((check) => check.id),
      next_actions: doctor.next_actions
    },
    next_commands: buildNextCommands(root, {
      activeStories,
      selectedStory,
      latestRun,
      selectedStoryLatestRun,
      doctor
    })
  };
}

export function renderRepoStatus(status) {
  const latestRun = status.latest_run;
  const selectedStoryRun = status.selected_story_latest_run;
  return `# VibePro Status

| 項目 | 内容 |
|------|------|
| Initialized | ${status.initialized ? 'yes' : 'no'} |
| Workspace | ${status.workspace} |
| Workspace Status | ${status.workspace_status ?? 'ok'} |
| Selected Story | ${status.current_story_id ?? '-'} |
| Active Stories | ${status.active_stories.length} |
| Latest Run | ${latestRun?.run_id ?? '-'} |
| Selected Story Latest Run | ${selectedStoryRun?.run_id ?? '-'} |
| Gate | ${status.gate_status ?? '-'} |
| Findings | ${status.finding_count} |
| Doctor | ${status.doctor?.overall_status ?? '-'} |

## Active Stories

${status.active_stories.length === 0 ? '- なし' : status.active_stories.map((story) => `- ${story.story_id}: ${story.title} / view:${story.view ?? '-'} / period:${story.period ?? '-'}`).join('\n')}

## Artifacts

${Object.entries(status.artifacts).length === 0 ? '- なし' : Object.entries(status.artifacts).map(([key, value]) => `- ${key}: ${value}`).join('\n')}

## Doctor

${renderDoctorStatus(status.doctor)}

## Next Commands

${status.next_commands.map((command) => `- ${command}`).join('\n')}
`;
}

async function exists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

async function readJsonWithStatus(filePath, label) {
  try {
    return {
      ok: true,
      label,
      filePath,
      value: JSON.parse(await readFile(filePath, 'utf8'))
    };
  } catch (error) {
    if (error instanceof SyntaxError) {
      return {
        ok: false,
        label,
        filePath,
        error: error.message
      };
    }
    throw error;
  }
}

function toWorkspacePath(repoRoot, filePath) {
  return path.relative(repoRoot, filePath).split(path.sep).join('/');
}

function findRun(runs, runId) {
  if (!runId) return null;
  return runs.find((run) => run.run_id === runId) ?? null;
}

function prioritizeStory(stories, storyId) {
  if (!storyId) return stories;
  const selected = stories.find((story) => story.story_id === storyId);
  if (!selected) return stories;
  return [selected, ...stories.filter((story) => story.story_id !== storyId)];
}

function normalizeStatusStories(stories) {
  const sourceStories = Array.isArray(stories) ? stories : DEFAULT_BRAINBASE_STORIES;
  return sourceStories
    .filter((story) => story.status !== 'archived')
    .map((story) => ({
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

function findLatestStoryRun(manifest, runs, storyId) {
  const latestStoryRunId = manifest.latest_run_by_story?.[storyId] ?? null;
  return findRun(runs, latestStoryRunId)
    ?? runs.find((run) => run.story_id === storyId)
    ?? null;
}

async function readRunEvidence(repoRoot, run) {
  const evidencePath = run.artifacts?.evidence;
  if (!evidencePath) return null;
  try {
    return JSON.parse(await readFile(path.resolve(repoRoot, evidencePath), 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

function buildNextCommands(repoRoot, { activeStories, selectedStory, latestRun, selectedStoryLatestRun, doctor = null }) {
  if (doctor && ['needs_maintenance', 'fixed'].includes(doctor.overall_status)) {
    return doctor.next_commands?.length > 0
      ? doctor.next_commands
      : [`vibepro doctor ${repoRoot}`, `vibepro doctor ${repoRoot} --fix`];
  }
  if (activeStories.length === 0) {
    return [`vibepro story add ${repoRoot} --id <story-id> --title "<title>"`];
  }
  if (!selectedStory) {
    return [`vibepro story select ${repoRoot} --id ${activeStories[0].story_id}`];
  }
  if (!latestRun && !selectedStoryLatestRun) {
    return [`vibepro story diagnose ${repoRoot} --id ${selectedStory.story_id} --run-graphify`];
  }
  return [
    `vibepro story report ${repoRoot} --id ${selectedStory.story_id}`,
    `vibepro brainbase ${repoRoot}`
  ];
}

function renderDoctorStatus(doctor) {
  if (!doctor) return '- なし';
  const checks = doctor.blocking_check_ids?.length > 0
    ? doctor.blocking_check_ids.join(', ')
    : '-';
  const actions = doctor.next_actions?.length > 0
    ? doctor.next_actions.map((action) => `  - ${action.command}: ${action.reason}`).join('\n')
    : '  - なし';
  return `- overall: ${doctor.overall_status}
- checks: ${doctor.check_count}
- needs action: ${checks}
- next actions:
${actions}`;
}
