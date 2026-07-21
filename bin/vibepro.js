#!/usr/bin/env node
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { runCli } from '../src/cli.js';
import { createCodexSubagentHost } from '../src/codex-subagent-host.js';

export function createEntrypointIo(runtime = process) {
  return {
    stdout: runtime.stdout,
    stderr: runtime.stderr,
    env: runtime.env
  };
}

export async function resolveEntrypointIo(runtime = process) {
  const io = createEntrypointIo(runtime);
  if (runtime.guardedRunDependencies) io.guardedRunDependencies = runtime.guardedRunDependencies;
  if (runtime.codexSubagentHost) {
    io.codexSubagentHost = runtime.codexSubagentHost;
    return io;
  }
  const moduleSpecifier = runtime.env?.VIBEPRO_CODEX_HOST_MODULE;
  const cwd = typeof runtime.cwd === 'function' ? runtime.cwd() : process.cwd();
  if (!moduleSpecifier) {
    io.codexSubagentHost = await createCodexSubagentHost({ env: runtime.env, cwd });
    return io;
  }
  const moduleUrl = moduleSpecifier.startsWith('file:')
    ? moduleSpecifier
    : pathToFileURL(path.resolve(cwd, moduleSpecifier)).href;
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
  const result = await runCli(argv, await resolveEntrypointIo(runtime));
  runtime.exitCode = result.exitCode;
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
