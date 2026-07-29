#!/usr/bin/env node
// story-vibepro-vacuous-e2e-test-elimination
//
// test/e2e once held files that imported no product code, started no process,
// and touched no filesystem. Each asserted a locally-defined string against a
// regex built from that same string, so no product regression could fail them,
// yet `node --test` counted them as passing e2e tests. That turns the pass
// count into a false statement about how much behaviour was verified.
//
// This lint fails when such a file reappears. It is deliberately fail-closed:
// an unscannable directory, an unreadable file, and an empty file set are all
// failures, because a lint that cannot see its subject must never report clean.

import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';

export const E2E_TEST_FILE_PATTERN = /\.(spec|test)\.[cm]?[jt]sx?$/;

// A file counts as executing product behaviour when it does at least one of:
// import this repository's product code, start a process, or touch the
// filesystem. These are the three signals the Story defines as Tier A.
export const PRODUCT_EXECUTION_SIGNALS = [
  {
    id: 'product_import',
    description: 'imports repository product code (src/, scripts/, bin/)',
    pattern: /['"][^'"]*(?:\.\.\/)+(?:src|scripts|bin)\/[^'"]*['"]/
  },
  {
    id: 'process_start',
    description: 'starts a child process or runs the CLI',
    pattern: /node:child_process|require\(\s*['"]child_process['"]\s*\)|\b(?:execFile|execFileSync|execSync|spawn|spawnSync|fork)\s*\(|\brunCli\b|\bVIBEPRO_BIN\b/
  },
  {
    id: 'filesystem_access',
    description: 'reads or writes the filesystem',
    pattern: /node:fs|require\(\s*['"]fs(?:\/promises)?['"]\s*\)|['"]fs\/promises['"]|\b(?:readFile|readFileSync|writeFile|writeFileSync|mkdtemp|mkdtempSync|readdir|readdirSync|existsSync|rm|rmSync|mkdir|mkdirSync)\s*\(/
  }
];

export function detectProductExecutionSignals(content) {
  return PRODUCT_EXECUTION_SIGNALS
    .filter((signal) => signal.pattern.test(content))
    .map((signal) => signal.id);
}

export function listE2eTestFiles(e2eDir, readdir = readdirSync) {
  // Any failure to enumerate the directory is a lint failure, not an empty set.
  // Returning [] here would let a moved or deleted directory read as "clean".
  const entries = readdir(e2eDir);
  return entries
    .filter((name) => E2E_TEST_FILE_PATTERN.test(name))
    .sort();
}

export function lintE2eProductExecution({
  rootDir = process.cwd(),
  log = (line) => process.stdout.write(`${line}\n`),
  readdir = readdirSync,
  readFile = (file) => readFileSync(file, 'utf8')
} = {}) {
  const e2eDir = join(rootDir, 'test', 'e2e');

  let files;
  try {
    files = listE2eTestFiles(e2eDir, readdir);
  } catch (error) {
    log(`::error::Could not scan ${relative(rootDir, e2eDir) || e2eDir}: ${error.message}. The e2e product-execution lint fails closed rather than reporting clean on a directory it cannot read.`);
    return 1;
  }

  if (files.length === 0) {
    log(`::error::No e2e test files were found under ${relative(rootDir, e2eDir) || e2eDir}; the e2e product-execution lint would be a silent no-op.`);
    return 1;
  }

  const violations = [];
  for (const name of files) {
    const filePath = join(e2eDir, name);
    let content;
    try {
      content = readFile(filePath);
    } catch (error) {
      log(`::error::Could not read ${join('test', 'e2e', name)}: ${error.message}. The e2e product-execution lint fails closed rather than skipping a file it cannot read.`);
      return 1;
    }
    const signals = detectProductExecutionSignals(content);
    if (signals.length === 0) {
      violations.push(join('test', 'e2e', name));
    }
  }

  if (violations.length > 0) {
    log(
      `::error::${violations.length} e2e test file(s) execute no product behaviour ` +
        '(no product import, no process start, no filesystem access). ' +
        'They pass regardless of what the product does, so they inflate the e2e pass count without verifying anything: ' +
        violations.join(', ')
    );
    log(
      'Fix by asserting on real behaviour: import the product module under test, run the CLI as a child process, ' +
        'or exercise the code against a real working tree. Delete the file if another suite already covers its Story acceptance criteria.'
    );
    return 1;
  }

  log(`e2e-product-execution: ${files.length} e2e test file(s) all execute product behaviour`);
  return 0;
}

const invokedDirectly = process.argv[1]
  && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  process.exit(lintE2eProductExecution({ rootDir: process.cwd() }));
}
