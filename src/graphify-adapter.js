import { constants as fsConstants } from 'node:fs';
import { access, copyFile, mkdir, rm, stat } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';

import { getWorkspaceDir, initWorkspace, readManifest, toWorkspaceRelative, writeManifest } from './workspace.js';
import { assertArtifactWritePath, projectArtifact, resolveArtifactRoute } from './artifact-routing.js';
import { classifyTermination, createProgressDeadline } from './progress-deadline.js';

const GRAPHIFY_FILES = ['graph.json', 'GRAPH_REPORT.md', 'graph.html'];

// `graphify update` has no built-in bound: without these, a hung or looping subprocess can
// hang story diagnose forever. Named constants so a caller can override any of them (e.g. in
// tests) without touching the enforcement logic below.
export const GRAPHIFY_MAX_WALL_CLOCK_MS = 10 * 60 * 1000;
export const GRAPHIFY_NO_PROGRESS_DEADLINE_MS = 2 * 60 * 1000;
export const GRAPHIFY_TERMINATION_GRACE_MS = 5 * 1000;
export const GRAPHIFY_MAX_OUTPUT_BYTES = 4 * 1024 * 1024;
const GRAPHIFY_POLL_INTERVAL_MS = 250;
const TRUNCATION_MARKER = '\n...[truncated: output cap reached]';

export async function importGraphifyArtifacts(repoRoot, options = {}) {
  await initWorkspace(repoRoot);
  const root = path.resolve(repoRoot);
  const sourceArg = options.sourceDir ?? 'graphify-out';
  const sourceDir = await resolveGraphifySourceDir(root, sourceArg, Boolean(options.runGraphify));

  let execution = null;
  const cleanupGeneratedGraphifyOutput = Boolean(options.runGraphify);
  try {
    if (options.runGraphify) {
      execution = await runGraphify(root, sourceArg, options.env, options.graphifyProcessOptions);
    }

    const graphifyRoute = await resolveArtifactRoute(root, 'graphify', { storyId: options.storyId ?? 'story-default' });
    const graphifyDir = await assertArtifactWritePath(root, graphifyRoute.canonical.relative_path);
    await mkdir(graphifyDir, { recursive: true });

    await ensureFile(path.join(sourceDir, 'graph.json'));
    await ensureFile(path.join(sourceDir, 'GRAPH_REPORT.md'));

    for (const fileName of GRAPHIFY_FILES) {
      const sourceFile = path.join(sourceDir, fileName);
      const destinationFile = path.join(graphifyDir, fileName);
      try {
        if (path.resolve(sourceFile) !== path.resolve(destinationFile)) {
          await copyFile(sourceFile, destinationFile);
        }
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
    await projectArtifact(root, 'graphify', {
      storyId: options.storyId ?? 'story-default',
      content: { story_id: options.storyId ?? 'story-default', status: 'imported', artifacts: manifest.artifacts },
      canonicalFileName: 'graph.json'
    });

    return { graphifyDir, graphifyExecuted: Boolean(execution) };
  } finally {
    if (cleanupGeneratedGraphifyOutput) {
      await cleanupDefaultGraphifyOutput(root);
    }
  }
}

async function resolveGraphifySourceDir(repoRoot, sourceArg, runGraphifyRequested) {
  const sourcePath = path.resolve(repoRoot, sourceArg);
  if (runGraphifyRequested) return sourcePath;

  try {
    const sourceStat = await stat(sourcePath);
    if (!sourceStat.isFile()) return sourcePath;
    if (path.basename(sourcePath) !== 'graph.json') {
      throw new Error(`graphify --from file must be named graph.json: ${sourcePath}`);
    }
    return path.dirname(sourcePath);
  } catch (error) {
    if (error.code === 'ENOENT') return sourcePath;
    throw error;
  }
}

async function runGraphify(repoRoot, outputArg, env, processOptions) {
  const args = ['update', '.'];
  const command = `graphify ${args.join(' ')}`;
  const startedAt = new Date().toISOString();

  const result = await runProcess('graphify', args, {
    cwd: repoRoot,
    env: env ?? process.env,
    ...processOptions
  }).catch(async (error) => {
    if (error.code === 'ENOENT') {
      throw new Error(await buildGraphifyNotFoundMessage(env ?? process.env));
    }
    throw error;
  });

  if (result.stopReason) {
    const error = new Error(
      `graphify update was killed by policy after ${result.stopReason.code}: `
      + `${JSON.stringify(result.stopReason.details)}`
    );
    error.stop_reason = result.stopReason;
    error.termination = result.termination;
    throw error;
  }
  if (result.exitCode !== 0) {
    const externalSignal = result.termination?.kind === 'external_signal';
    const error = new Error(
      `graphify failed with exit code ${result.exitCode}`
      + `${externalSignal ? ` (terminated by external signal ${result.termination.signal})` : ''}`
      + `: ${result.stderr.trim()}`
    );
    if (externalSignal) {
      error.stop_reason = { code: 'external_signal', message: 'external_signal', details: { signal: result.termination.signal } };
    }
    error.termination = result.termination;
    throw error;
  }
  if (outputArg !== 'graphify-out') {
    await mirrorGraphifyOutput(repoRoot, outputArg);
  }

  return {
    command,
    started_at: startedAt,
    finished_at: new Date().toISOString(),
    exit_code: result.exitCode,
    ...(result.stdoutTruncated || result.stderrTruncated ? { output_truncated: true } : {})
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

// Bounds an otherwise-naive spawn with the shared progress-deadline kernel: cumulative bytes
// received across stdout+stderr is the monotonic progress token (a subprocess that is still
// producing output is making progress even without an application-level checkpoint), and the
// wall-clock cap is an independent hard ceiling progress can never extend. On a policy kill
// this sends SIGTERM to the process group, waits `terminationGraceMs`, then escalates to
// SIGKILL — the same "own process group, detached, SIGTERM then SIGKILL" contract used in
// src/managed-command-executor.js, reused here rather than reinvented.
// Exported for direct unit testing of the bounding behavior (progress extension, hard caps,
// output truncation, SIGTERM->grace->SIGKILL, external-kill attribution) without spawning the
// real `graphify` binary. importGraphifyArtifacts()/runGraphify() remain the public contract.
export function runProcess(command, args, options = {}) {
  const {
    maxWallClockMs = GRAPHIFY_MAX_WALL_CLOCK_MS,
    noProgressDeadlineMs = GRAPHIFY_NO_PROGRESS_DEADLINE_MS,
    terminationGraceMs = GRAPHIFY_TERMINATION_GRACE_MS,
    maxOutputBytes = GRAPHIFY_MAX_OUTPUT_BYTES,
    pollIntervalMs = GRAPHIFY_POLL_INTERVAL_MS,
    ...spawnOptions
  } = options;

  return new Promise((resolve, reject) => {
    const kernel = createProgressDeadline({
      no_progress_deadline_ms: noProgressDeadlineMs,
      max_wall_clock_ms: maxWallClockMs,
      started_at: Date.now(),
      now: () => Date.now()
    });

    let stdout = '';
    let stderr = '';
    let stdoutTruncated = false;
    let stderrTruncated = false;
    let totalBytes = 0;
    let settled = false;
    let policyKillReason = null;
    const sentSignals = [];
    let pollTimer;
    let escalationTimer;
    let child;

    try {
      child = spawn(command, args, { ...spawnOptions, detached: process.platform !== 'win32' });
    } catch (error) {
      reject(error);
      return;
    }

    child.stdout?.on('data', (chunk) => appendChunk(chunk, 'stdout'));
    child.stderr?.on('data', (chunk) => appendChunk(chunk, 'stderr'));

    function appendChunk(chunk, stream) {
      totalBytes += chunk.length;
      // Any output growth is progress, whether or not the deadline check runs before this
      // process ends — observing here (not only in the poll loop) means a burst of output
      // right before close() still counts.
      kernel.observe(totalBytes);
      if (stream === 'stdout') {
        if (stdoutTruncated) return;
        if (Buffer.byteLength(stdout) + chunk.length > maxOutputBytes) {
          stdout += `${chunk.toString()}${TRUNCATION_MARKER}`;
          stdoutTruncated = true;
        } else {
          stdout += chunk.toString();
        }
      } else {
        if (stderrTruncated) return;
        if (Buffer.byteLength(stderr) + chunk.length > maxOutputBytes) {
          stderr += `${chunk.toString()}${TRUNCATION_MARKER}`;
          stderrTruncated = true;
        } else {
          stderr += chunk.toString();
        }
      }
    }

    child.on('error', (error) => {
      if (settled) return;
      settled = true;
      clearInterval(pollTimer);
      clearTimeout(escalationTimer);
      reject(error);
    });

    child.on('close', (exitCode, signal) => {
      if (settled) return;
      settled = true;
      clearInterval(pollTimer);
      clearTimeout(escalationTimer);
      const termination = classifyTermination({ signal, sentSignals });
      resolve({
        exitCode,
        stdout,
        stderr,
        stdoutTruncated,
        stderrTruncated,
        stopReason: policyKillReason,
        termination
      });
    });

    pollTimer = setInterval(() => {
      if (settled || policyKillReason) return;
      const verdict = kernel.check();
      if (!verdict.ok) {
        policyKillReason = verdict.kill;
        killWithGrace();
      }
    }, pollIntervalMs);
    pollTimer.unref?.();

    function killWithGrace() {
      clearInterval(pollTimer);
      sendSignal('SIGTERM');
      escalationTimer = setTimeout(() => sendSignal('SIGKILL'), terminationGraceMs);
      escalationTimer.unref?.();
    }

    function sendSignal(signal) {
      if (!child.pid) return;
      sentSignals.push(signal);
      try {
        if (process.platform !== 'win32') process.kill(-child.pid, signal);
        else child.kill(signal);
      } catch {
        // ESRCH: the process already exited; nothing left to signal.
      }
    }
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
