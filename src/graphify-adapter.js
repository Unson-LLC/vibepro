import { copyFile, mkdir, stat } from 'node:fs/promises';
import path from 'node:path';

import { getWorkspaceDir, initWorkspace, readManifest, toWorkspaceRelative, writeManifest } from './workspace.js';

const GRAPHIFY_FILES = ['graph.json', 'GRAPH_REPORT.md', 'graph.html'];

export async function importGraphifyArtifacts(repoRoot, options = {}) {
  await initWorkspace(repoRoot);
  const root = path.resolve(repoRoot);
  const sourceDir = path.resolve(root, options.sourceDir ?? 'graphify-out');
  const graphifyDir = path.join(getWorkspaceDir(root), 'graphify');
  await mkdir(graphifyDir, { recursive: true });

  await ensureFile(path.join(sourceDir, 'graph.json'));
  await ensureFile(path.join(sourceDir, 'GRAPH_REPORT.md'));

  for (const fileName of GRAPHIFY_FILES) {
    const sourceFile = path.join(sourceDir, fileName);
    try {
      await copyFile(sourceFile, path.join(graphifyDir, fileName));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }

  const manifest = await readManifest(root);
  manifest.artifacts = {
    ...manifest.artifacts,
    graphify_json: toWorkspaceRelative(root, path.join(graphifyDir, 'graph.json')),
    graphify_report: toWorkspaceRelative(root, path.join(graphifyDir, 'GRAPH_REPORT.md'))
  };
  await writeManifest(root, manifest);

  return { graphifyDir };
}

async function ensureFile(filePath) {
  try {
    const fileStat = await stat(filePath);
    if (!fileStat.isFile()) throw new Error(`${filePath} is not a file`);
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new Error(`graphify artifact not found: ${filePath}`);
    }
    throw error;
  }
}
