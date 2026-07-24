import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { DEFAULT_PR_ARTIFACT_BYTES } from './pr-artifact-budget.js';

export const SCHEMA_VERSION = '0.1.0';
export const WORKSPACE_DIR = '.vibepro';
export const MANIFEST_FILE = 'vibepro-manifest.json';
export const DEFAULT_BRAINBASE_STORIES = [{
  story_id: 'story-vibepro-diagnosis-commercialization-roadmap',
  title: 'M1: VibePro 診断→商用化ロードマップ',
  ssot: 'NocoDB',
  horizon: null,
  view: null,
  period: null,
  started_at: null,
  due_at: null
}];

export async function initWorkspace(repoRoot, options = {}) {
  const root = path.resolve(repoRoot);
  const workspaceDir = path.join(root, WORKSPACE_DIR);
  const outputLanguage = options.language === 'en' ? 'en' : 'ja';
  await mkdir(workspaceDir, { recursive: true });
  await mkdir(path.join(workspaceDir, 'diagnostics'), { recursive: true });
  await mkdir(path.join(workspaceDir, 'raw'), { recursive: true });
  await mkdir(path.join(workspaceDir, 'spec'), { recursive: true });
  await mkdir(path.join(workspaceDir, 'playbook'), { recursive: true });

  await writeJsonIfMissing(path.join(workspaceDir, 'config.json'), {
    schema_version: SCHEMA_VERSION,
    tool: 'vibepro',
    workspace: WORKSPACE_DIR,
    output: {
      language: outputLanguage
    },
    execution: {
      managed_worktree: 'preferred'
    },
    budgets: {
      // Per-artifact byte budget for `pr prepare`. Emitted JSON artifacts larger
      // than this get a bounded `<name>.summary.json` sibling that LLM handoff
      // surfaces reference by default; gate evaluation always reads full artifacts.
      pr_artifact_bytes: DEFAULT_PR_ARTIFACT_BYTES
    },
    brainbase: {
      stories: DEFAULT_BRAINBASE_STORIES
    }
  }, 'VibePro config');

  await writeJsonIfMissing(path.join(workspaceDir, MANIFEST_FILE), createManifest(root), 'VibePro manifest');
  await ensureGitIgnore(root);

  return { repoRoot: root, workspaceDir };
}

export async function readManifest(repoRoot) {
  const manifestPath = getManifestPath(repoRoot);
  try {
    return JSON.parse(await readFile(manifestPath, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') {
      await initWorkspace(repoRoot);
      return JSON.parse(await readFile(manifestPath, 'utf8'));
    }
    throw error;
  }
}

export async function writeManifest(repoRoot, manifest, options = {}) {
  await writeFile(getManifestPath(repoRoot), `${JSON.stringify(manifest, null, 2)}\n`, options);
}

export function getWorkspaceDir(repoRoot) {
  return path.join(path.resolve(repoRoot), WORKSPACE_DIR);
}

// Story-list normalization lives here (not in story-manager.js) because it is
// a pure, side-effect-free transform over plain brainbase.stories config data
// that workspace-infra-level callers (guard.js's release-surface classifier,
// performance-evidence.js, pr-manager.js) need without depending on the story
// module's SSOT/catalog machinery.
export function isArchived(story) {
  return story.status === 'archived' || story.status === 'アーカイブ';
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

export function toWorkspaceRelative(repoRoot, filePath) {
  return path.relative(path.resolve(repoRoot), filePath).split(path.sep).join('/');
}

function getManifestPath(repoRoot) {
  return path.join(getWorkspaceDir(repoRoot), MANIFEST_FILE);
}

function createManifest(repoRoot) {
  return {
    schema_version: SCHEMA_VERSION,
    tool: 'vibepro',
    repo: {
      root: '.',
      git_remote: null,
      commit: null
    },
    latest_run: null,
    artifacts: {},
    runs: []
  };
}

async function writeJsonIfMissing(filePath, value, label = 'VibePro JSON') {
  try {
    JSON.parse(await readFile(filePath, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') {
      if (error instanceof SyntaxError) {
        throw new Error(`${label} is invalid JSON: ${filePath}. Repair or remove it before running vibepro init.`);
      }
      throw error;
    }
    await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
  }
}

async function ensureGitIgnore(repoRoot) {
  const ignorePath = path.join(path.resolve(repoRoot), '.gitignore');
  const required = [
    '.vibepro/*',
    '!.vibepro/config.json',
    '.worktrees/vibepro/'
  ];

  let existing = '';
  try {
    existing = await readFile(ignorePath, 'utf8');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }

  existing = existing
    .split('\n')
    .filter((line) => line.trim() !== '.vibepro/')
    .join('\n');
  const missing = required.filter((line) => !existing.split('\n').includes(line));
  if (missing.length === 0) return;

  const prefix = existing.trim().length > 0 ? `${existing.trimEnd()}\n` : '';
  await writeFile(ignorePath, `${prefix}${missing.join('\n')}\n`);
}
