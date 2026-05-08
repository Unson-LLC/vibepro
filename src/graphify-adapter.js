import { copyFile, mkdir, rm, stat } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';

import { getWorkspaceDir, initWorkspace, readManifest, toWorkspaceRelative, writeManifest } from './workspace.js';

const GRAPHIFY_FILES = ['graph.json', 'GRAPH_REPORT.md', 'graph.html'];

export async function importGraphifyArtifacts(repoRoot, options = {}) {
  await initWorkspace(repoRoot);
  const root = path.resolve(repoRoot);
  const sourceArg = options.sourceDir ?? 'graphify-out';
  const sourceDir = path.resolve(root, sourceArg);

  let execution = null;
  const cleanupGeneratedGraphifyOutput = Boolean(options.runGraphify);
  try {
    if (options.runGraphify) {
      execution = await runGraphify(root, sourceArg, options.env);
    }

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
    if (execution) {
      manifest.graphify = {
        ...(manifest.graphify ?? {}),
        last_execution: execution
      };
    }
    await writeManifest(root, manifest);

    return { graphifyDir, graphifyExecuted: Boolean(execution) };
  } finally {
    if (cleanupGeneratedGraphifyOutput) {
      await cleanupDefaultGraphifyOutput(root);
    }
  }
}

async function runGraphify(repoRoot, outputArg, env) {
  const args = ['update', '.'];
  const command = `graphify ${args.join(' ')}`;
  const startedAt = new Date().toISOString();

  const result = await runProcess('graphify', args, {
    cwd: repoRoot,
    env: env ?? process.env
  }).catch((error) => {
    if (error.code === 'ENOENT') {
      throw new Error('graphify is not installed. Install with: uv tool install graphifyy');
    }
    throw error;
  });

  if (result.exitCode !== 0) {
    throw new Error(`graphify failed with exit code ${result.exitCode}: ${result.stderr.trim()}`);
  }
  if (outputArg !== 'graphify-out') {
    await mirrorGraphifyOutput(repoRoot, outputArg);
  }

  return {
    command,
    started_at: startedAt,
    finished_at: new Date().toISOString(),
    exit_code: result.exitCode
  };
}

async function mirrorGraphifyOutput(repoRoot, outputArg) {
  const defaultOutputDir = path.join(repoRoot, 'graphify-out');
  const requestedOutputDir = path.resolve(repoRoot, outputArg);
  await mkdir(requestedOutputDir, { recursive: true });
  await ensureFile(path.join(defaultOutputDir, 'graph.json'));
  await ensureFile(path.join(defaultOutputDir, 'GRAPH_REPORT.md'));
  for (const fileName of GRAPHIFY_FILES) {
    const sourceFile = path.join(defaultOutputDir, fileName);
    try {
      await copyFile(sourceFile, path.join(requestedOutputDir, fileName));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
}

async function cleanupDefaultGraphifyOutput(repoRoot) {
  await rm(path.join(repoRoot, 'graphify-out'), {
    recursive: true,
    force: true
  });
}

function runProcess(command, args, options) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, options);
    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', reject);
    child.on('close', (exitCode) => {
      resolve({ exitCode, stdout, stderr });
    });
  });
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
