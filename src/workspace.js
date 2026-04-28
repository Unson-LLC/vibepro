import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

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

export async function initWorkspace(repoRoot) {
  const root = path.resolve(repoRoot);
  const workspaceDir = path.join(root, WORKSPACE_DIR);
  await mkdir(workspaceDir, { recursive: true });
  await mkdir(path.join(workspaceDir, 'graphify'), { recursive: true });
  await mkdir(path.join(workspaceDir, 'diagnostics'), { recursive: true });
  await mkdir(path.join(workspaceDir, 'raw'), { recursive: true });

  await writeJsonIfMissing(path.join(workspaceDir, 'config.json'), {
    schema_version: SCHEMA_VERSION,
    tool: 'vibepro',
    workspace: WORKSPACE_DIR,
    brainbase: {
      stories: DEFAULT_BRAINBASE_STORIES
    }
  });

  await writeJsonIfMissing(path.join(workspaceDir, MANIFEST_FILE), createManifest(root));
  await ensureIgnoreFile(root);
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

export async function writeManifest(repoRoot, manifest) {
  await writeFile(getManifestPath(repoRoot), `${JSON.stringify(manifest, null, 2)}\n`);
}

export function getWorkspaceDir(repoRoot) {
  return path.join(path.resolve(repoRoot), WORKSPACE_DIR);
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

async function writeJsonIfMissing(filePath, value) {
  try {
    await readFile(filePath, 'utf8');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
  }
}

async function ensureIgnoreFile(repoRoot) {
  const ignorePath = path.join(path.resolve(repoRoot), '.vibeproignore');
  const required = [
    '.vibepro/raw/',
    '.vibepro/**/raw/',
    '.vibepro/**/secrets*',
    '.vibepro/**/*.log'
  ];

  let existing = '';
  try {
    existing = await readFile(ignorePath, 'utf8');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }

  const missing = required.filter((line) => !existing.includes(line));
  if (missing.length === 0) return;

  const prefix = existing.trim().length > 0 ? `${existing.trimEnd()}\n` : '';
  await writeFile(ignorePath, `${prefix}${missing.join('\n')}\n`);
}

async function ensureGitIgnore(repoRoot) {
  const ignorePath = path.join(path.resolve(repoRoot), '.gitignore');
  const required = [
    '.vibepro/raw/',
    '.vibepro/**/raw/',
    '.vibepro/**/secrets*',
    '.vibepro/**/*.log'
  ];

  let existing = '';
  try {
    existing = await readFile(ignorePath, 'utf8');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }

  const missing = required.filter((line) => !existing.includes(line));
  if (missing.length === 0) return;

  const prefix = existing.trim().length > 0 ? `${existing.trimEnd()}\n` : '';
  await writeFile(ignorePath, `${prefix}${missing.join('\n')}\n`);
}
