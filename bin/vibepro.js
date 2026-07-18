#!/usr/bin/env node
import { pathToFileURL } from 'node:url';
import { runCli } from '../src/cli.js';

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

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
