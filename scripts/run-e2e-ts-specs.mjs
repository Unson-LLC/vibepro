#!/usr/bin/env node
// story-vibepro-node20-e2e-ts-ci-visibility
// `node --test` on Node < 22.6.0 never discovers test/e2e/*.spec.ts (default
// discovery excludes .ts and type stripping is unavailable), so those lanes
// pass with zero e2e acceptance replay coverage. This runner makes the specs
// an explicit required gate on Node >= 22.6.0 and an explicit, counted skip
// annotation everywhere else. It never fakes execution and it fails when the
// spec set is unexpectedly empty.

import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export const MIN_TYPE_STRIPPING_NODE_VERSION = 'v22.6.0';

export function listE2eTsSpecs(rootDir) {
  const specDir = join(rootDir, 'test', 'e2e');
  let entries;
  try {
    entries = readdirSync(specDir);
  } catch {
    return [];
  }
  return entries
    .filter((name) => name.endsWith('.spec.ts'))
    .sort()
    .map((name) => join('test', 'e2e', name));
}

export function supportsTypeStripping(nodeVersion) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)/.exec(String(nodeVersion));
  if (!match) {
    return false;
  }
  const [major, minor, patch] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const [minMajor, minMinor, minPatch] = MIN_TYPE_STRIPPING_NODE_VERSION
    .slice(1)
    .split('.')
    .map(Number);
  if (major !== minMajor) {
    return major > minMajor;
  }
  if (minor !== minMinor) {
    return minor > minMinor;
  }
  return patch >= minPatch;
}

export function runE2eTsSpecs({
  rootDir = process.cwd(),
  nodeVersion = process.version,
  log = (line) => process.stdout.write(`${line}\n`),
  spawn = (command, args, options) => spawnSync(command, args, options)
} = {}) {
  const specs = listE2eTsSpecs(rootDir);
  if (specs.length === 0) {
    log('::error::No test/e2e/*.spec.ts files were found; the e2e .ts gate would be a silent no-op.');
    return 1;
  }
  if (!supportsTypeStripping(nodeVersion)) {
    log(
      `::warning::Skipped ${specs.length} e2e .ts spec(s): node --test type stripping requires Node >= ${MIN_TYPE_STRIPPING_NODE_VERSION} (current ${nodeVersion}). ` +
        'These specs gate on the Node 22 lane; this lane has NO e2e .ts coverage.'
    );
    log(`e2e-ts-specs: skipped ${specs.length} spec file(s) on ${nodeVersion}`);
    return 0;
  }
  log(`e2e-ts-specs: running ${specs.length} spec file(s) on ${nodeVersion}`);
  // Drop the test-runner context marker so a nested `node --test` child
  // reports plain TAP instead of switching to the parent runner's
  // serialized child protocol.
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  const result = spawn(process.execPath, ['--test', ...specs], {
    cwd: rootDir,
    stdio: 'inherit',
    env
  });
  return result.status ?? 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(runE2eTsSpecs());
}
