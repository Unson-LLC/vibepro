#!/usr/bin/env node
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { runCli } from '../src/cli.js';

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

export async function main(argv = process.argv.slice(2), runtime = process) {
  const result = await runCli(argv, createEntrypointIo(runtime));
  runtime.exitCode = result.exitCode;
  return result;
}

if (isDirectExecution(import.meta.url, process.argv[1])) {
  await main();
}
