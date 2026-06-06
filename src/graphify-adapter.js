import { constants as fsConstants } from 'node:fs';
import { access, copyFile, mkdir, rm, stat } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import os from 'node:os';
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
  }).catch(async (error) => {
    if (error.code === 'ENOENT') {
      throw new Error(await buildGraphifyNotFoundMessage(env ?? process.env));
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

async function buildGraphifyNotFoundMessage(env) {
  const candidates = await findGraphifyPathCandidates(env);
  const pathValue = env?.PATH ?? '';
  const lines = [
    'graphify command was not found on PATH. Graphify is optional but recommended for impact-scope discovery.',
    `Current PATH: ${pathValue || '(empty)'}`,
    'You can continue without --run-graphify.'
  ];
  if (candidates.length > 0) {
    lines.push(`Found graphify outside PATH: ${candidates.join(', ')}`);
    lines.push('Retry by adding the directory to PATH, for example: PATH="$HOME/.local/bin:$PATH" <your vibepro command> --run-graphify');
  } else {
    lines.push('No graphify executable was found in common install locations.');
    lines.push('Install it with: uv tool install graphifyy');
  }
  return lines.join(' ');
}

async function findGraphifyPathCandidates(env) {
  const homeDir = env?.HOME || os.homedir();
  const candidateDirs = [
    homeDir ? path.join(homeDir, '.local', 'bin') : null,
    homeDir ? path.join(homeDir, '.cargo', 'bin') : null,
    '/opt/homebrew/bin',
    '/usr/local/bin'
  ].filter(Boolean);
  const pathDirs = new Set(String(env?.PATH ?? '').split(path.delimiter).filter(Boolean).map((dir) => path.resolve(dir)));
  const candidates = [];
  for (const dir of candidateDirs) {
    const resolvedDir = path.resolve(dir);
    if (pathDirs.has(resolvedDir)) continue;
    const candidate = path.join(resolvedDir, graphifyExecutableName());
    try {
      await access(candidate, fsConstants.X_OK);
      candidates.push(candidate);
    } catch (error) {
      if (!['ENOENT', 'EACCES', 'ENOTDIR'].includes(error.code)) throw error;
    }
  }
  return [...new Set(candidates)];
}

function graphifyExecutableName() {
  return process.platform === 'win32' ? 'graphify.exe' : 'graphify';
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
