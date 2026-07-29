#!/usr/bin/env node
import path from 'node:path';
import { realpathSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { runCli } from '../src/cli.js';
import { createCodexSubagentHost } from '../src/codex-subagent-host.js';

export function isDirectExecution(moduleUrl, argvEntry) {
  if (!argvEntry) return false;

  try {
    return realpathSync(fileURLToPath(moduleUrl)) === realpathSync(argvEntry);
  } catch {
    return false;
  }
}

export function createEntrypointIo(runtime = process) {
  return {
    stdout: runtime.stdout,
    stderr: runtime.stderr,
    env: runtime.env
  };
}

export async function resolveEntrypointIo(runtime = process, argv = []) {
  const io = createEntrypointIo(runtime);
  if (runtime.guardedRunDependencies) io.guardedRunDependencies = runtime.guardedRunDependencies;
  if (runtime.codexSubagentHost) {
    io.codexSubagentHost = runtime.codexSubagentHost;
    return io;
  }
  const moduleSpecifier = runtime.env?.VIBEPRO_CODEX_HOST_MODULE;
  const shellCwd = typeof runtime.cwd === 'function' ? runtime.cwd() : process.cwd();
  const cwd = resolveRuntimeRepoRoot(argv, shellCwd);
  if (!moduleSpecifier) {
    io.codexSubagentHost = await createCodexSubagentHost({ env: runtime.env, cwd });
    return io;
  }
  const moduleUrl = moduleSpecifier.startsWith('file:')
    ? moduleSpecifier
    : pathToFileURL(path.resolve(shellCwd, moduleSpecifier)).href;
  const hostModule = await import(moduleUrl);
  const factory = hostModule.createCodexSubagentHost ?? hostModule.default;
  const host = typeof factory === 'function'
    ? await factory({ env: runtime.env, cwd })
    : factory;
  if (!host || typeof host !== 'object') {
    throw new TypeError('VIBEPRO_CODEX_HOST_MODULE must export createCodexSubagentHost or a default host object');
  }
  io.codexSubagentHost = host;
  return io;
}

export async function main(argv = process.argv.slice(2), runtime = process) {
  const result = await runCli(argv, await resolveEntrypointIo(runtime, argv));
  runtime.exitCode = result.exitCode;
  return result;
}

function resolveRuntimeRepoRoot(argv, cwd) {
  if (argv[0] === 'execute' && String(argv[1] ?? '').startsWith('runtime-') && argv[2] && !argv[2].startsWith('-')) {
    return path.resolve(cwd, argv[2]);
  }
  return cwd;
}

if (isDirectExecution(import.meta.url, process.argv[1])) {
  await main();
}
