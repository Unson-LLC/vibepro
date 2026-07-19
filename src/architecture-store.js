import { lstat, mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { WORKSPACE_DIR } from './workspace.js';
import { assertArtifactWritePath, preflightArtifactWrites, resolveArtifactRoute, writeArtifactProjections } from './artifact-routing.js';

export const ARCHITECTURE_SCHEMA_VERSION = '0.1.0';

export function getArchitectureDir(repoRoot, storyId) {
  if (!storyId) throw new Error('storyId is required');
  return path.join(path.resolve(repoRoot), WORKSPACE_DIR, 'architecture', storyId);
}

export function getArchitectureDraftFile(repoRoot, storyId) {
  return path.join(getArchitectureDir(repoRoot, storyId), 'draft.md');
}

export function getArchitectureReadinessFile(repoRoot, storyId) {
  return path.join(getArchitectureDir(repoRoot, storyId), 'architecture-readiness.json');
}

export function defaultArchitectureFinalPath(storyId) {
  return path.join('docs', 'architecture', `${slugifyStoryId(storyId)}.md`);
}

export async function ensureArchitectureDir(repoRoot, storyId) {
  const dir = getArchitectureDir(repoRoot, storyId);
  await mkdir(dir, { recursive: true });
  return dir;
}

export async function readArchitectureReadiness(repoRoot, storyId) {
  if (!storyId) return null;
  try {
    return JSON.parse(await readFile(getArchitectureReadinessFile(repoRoot, storyId), 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

export async function writeArchitectureReadiness(repoRoot, storyId, readiness) {
  await ensureArchitectureDir(repoRoot, storyId);
  const readinessPath = getArchitectureReadinessFile(repoRoot, storyId);
  await writeFile(readinessPath, `${JSON.stringify(readiness, null, 2)}\n`);
  return readinessPath;
}

export async function writeDraftArchitecture(repoRoot, storyId, markdown) {
  await ensureArchitectureDir(repoRoot, storyId);
  const draftPath = getArchitectureDraftFile(repoRoot, storyId);
  await writeFile(draftPath, ensureTrailingNewline(markdown));
  return draftPath;
}

export async function writeFinalArchitecture(repoRoot, storyId, markdown, options = {}) {
  const route = await resolveArtifactRoute(repoRoot, 'architecture', { storyId });
  const configuredPath = route.canonical.relative_path;
  if (route.configured && options.outputPath && normalizeRepoPath(options.outputPath) !== configuredPath) {
    throw new Error(`architecture write --output diverges from the canonical artifact route (${configuredPath})`);
  }
  const relativePath = options.outputPath ?? configuredPath;
  await preflightArtifactWrites(repoRoot, route);
  const finalPath = await assertArtifactWritePath(repoRoot, relativePath);
  await mkdir(path.dirname(finalPath), { recursive: true });
  const content = ensureTrailingNewline(markdown);
  await writeFile(finalPath, content);
  await writeArtifactProjections(repoRoot, route, content);
  return finalPath;
}

function normalizeRepoPath(value) {
  return String(value).split(path.sep).join('/').replace(/^\.\//, '');
}

async function resolveArchitectureOutputPath(repoRoot, relativePath) {
  if (path.isAbsolute(relativePath)) {
    throw new Error('architecture write --output must be repository-relative');
  }
  const root = path.resolve(repoRoot);
  const finalPath = path.resolve(root, relativePath);
  const relativeFromRoot = path.relative(root, finalPath);
  if (relativeFromRoot.startsWith('..') || path.isAbsolute(relativeFromRoot)) {
    throw new Error('architecture write --output must stay inside the repository');
  }
  const rootRealPath = await realpath(root);
  const existingParent = await findExistingAncestor(path.dirname(finalPath), root);
  await assertPathInsideRepo(await realpath(existingParent), rootRealPath);
  return { finalPath, rootRealPath };
}

async function findExistingAncestor(targetPath, root) {
  let cursor = targetPath;
  while (true) {
    try {
      await lstat(cursor);
      return cursor;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      if (cursor === root || path.dirname(cursor) === cursor) throw error;
      cursor = path.dirname(cursor);
    }
  }
}

async function assertExistingOutputTargetInsideRepo(finalPath, rootRealPath) {
  try {
    await lstat(finalPath);
  } catch (error) {
    if (error.code === 'ENOENT') return;
    throw error;
  }
  await assertPathInsideRepo(await realpath(finalPath), rootRealPath);
}

async function assertPathInsideRepo(targetRealPath, rootRealPath) {
  const relative = path.relative(rootRealPath, targetRealPath);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('architecture write --output must stay inside the repository');
  }
}

function ensureTrailingNewline(text) {
  return text.endsWith('\n') ? text : `${text}\n`;
}

function slugifyStoryId(storyId) {
  return String(storyId)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'architecture';
}
