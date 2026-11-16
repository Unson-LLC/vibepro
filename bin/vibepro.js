#!/usr/bin/env node
import path from 'node:path';
import { realpathSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { runCli } from '../src/cli.js';
import { createCodexSubagentHost } from '../src/codex-subagent-host.js';
import { createDevelopmentProgressSender } from '../src/brainbase-development-progress.js';

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

/**
 * Create the optional Brainbase progress sender only when the operator has
 * supplied an explicit endpoint/token pair. No local or inferred identity is
 * added here; the host still requires the caller's canonical task mapping.
 */
export function resolveDevelopmentProgressSender(env) {
  const configured = [env?.BRAINBASE_DEVELOPMENT_API_URL, env?.BRAINBASE_DEVELOPMENT_API_TOKEN]
    .some((value) => typeof value === 'string' && value.trim() !== '');
  if (!configured) return null;
  try {
    return createDevelopmentProgressSender({ env });
  } catch {
    // Invalid optional integration settings must not prevent local execution.
    // Keep a visible failure receipt without retaining the URL or token.
    return {
      configurationError: 'development_progress_configuration_invalid',
      send: async () => false,
      readback: async () => false,
    };
  }
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
  const developmentProgressSender = resolveDevelopmentProgressSender(runtime.env);
  if (!moduleSpecifier) {
    io.codexSubagentHost = await createCodexSubagentHost({ env: runtime.env, cwd, developmentProgressSender });
    return io;
  }
  const moduleUrl = moduleSpecifier.startsWith('file:')
    ? moduleSpecifier
    : pathToFileURL(path.resolve(shellCwd, moduleSpecifier)).href;
  const hostModule = await import(moduleUrl);
  const factory = hostModule.createCodexSubagentHost ?? hostModule.default;
  const host = typeof factory === 'function'
    ? await factory({ env: runtime.env, cwd, developmentProgressSender })
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
