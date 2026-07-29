import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

import {
  detectProductExecutionSignals,
  listE2eTestFiles,
  lintE2eProductExecution,
  PRODUCT_EXECUTION_SIGNALS
} from '../scripts/lint-e2e-product-execution.mjs';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const lintPath = join(repoRoot, 'scripts', 'lint-e2e-product-execution.mjs');

function makeFixtureRoot(files) {
  const root = mkdtempSync(join(tmpdir(), 'e2e-product-execution-lint-'));
  mkdirSync(join(root, 'test', 'e2e'), { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(root, 'test', 'e2e', name), content);
  }
  return root;
}

function runLint(root, overrides = {}) {
  const lines = [];
  const status = lintE2eProductExecution({
    rootDir: root,
    log: (line) => lines.push(line),
    ...overrides
  });
  return { status, output: lines.join('\n') };
}

// The smallest file this Story removed, quoted verbatim from the Story
// background. The left operand is a literal the file wrote itself and the
// right operand is a substring of that literal, so no product change can
// fail it.
const HISTORICAL_VACUOUS_FILE = `import test from 'node:test';
import assert from 'node:assert/strict';

test('story-vibepro-engineering-judgment-activation-precision ac:1', () => {
  assert.match(
    'activation_candidates activation_signals activation_precision',
    /activation_precision/
  );
});
`;

const REAL_BEHAVIOUR_FILE = `import test from 'node:test';
import assert from 'node:assert/strict';
import { buildThing } from '../../src/thing.js';

test('exercises the product', () => {
  assert.equal(buildThing().ok, true);
});
`;

test('LINT-1 VET-S-5 a test file that executes no product behaviour fails the lint and is named', () => {
  const root = makeFixtureRoot({
    'story-vacuous-main.test.js': HISTORICAL_VACUOUS_FILE,
    'story-real-main.test.js': REAL_BEHAVIOUR_FILE
  });
  try {
    const { status, output } = runLint(root);
    assert.equal(status, 1);
    assert.match(output, /story-vacuous-main\.test\.js/);
    assert.doesNotMatch(output, /story-real-main\.test\.js/);
    assert.match(output, /execute no product behaviour/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('LINT-2 VET-S-5 the lint fails closed when it cannot scan the e2e directory', () => {
  // A lint that reports clean on a directory it cannot read is worse than no
  // lint: it converts a missing subject into a passing signal.
  const root = mkdtempSync(join(tmpdir(), 'e2e-product-execution-lint-missing-'));
  try {
    const { status, output } = runLint(root);
    assert.equal(status, 1);
    assert.match(output, /Could not scan/);
    assert.match(output, /fails closed/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }

  // Same contract when the directory exists but enumeration itself throws.
  const permissionRoot = makeFixtureRoot({ 'story-real-main.test.js': REAL_BEHAVIOUR_FILE });
  try {
    const { status, output } = runLint(permissionRoot, {
      readdir: () => {
        throw Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' });
      }
    });
    assert.equal(status, 1);
    assert.match(output, /Could not scan/);
    assert.match(output, /EACCES/);
  } finally {
    rmSync(permissionRoot, { recursive: true, force: true });
  }
});

test('LINT-3 VET-S-5 an unreadable file fails the lint instead of being skipped', () => {
  const root = makeFixtureRoot({ 'story-real-main.test.js': REAL_BEHAVIOUR_FILE });
  try {
    const { status, output } = runLint(root, {
      readFile: () => {
        throw Object.assign(new Error('EIO: i/o error'), { code: 'EIO' });
      }
    });
    assert.equal(status, 1);
    assert.match(output, /Could not read/);
    assert.match(output, /fails closed/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('LINT-4 VET-S-5 an empty e2e directory fails rather than reporting a silent clean run', () => {
  const root = makeFixtureRoot({});
  try {
    const { status, output } = runLint(root);
    assert.equal(status, 1);
    assert.match(output, /silent no-op/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('LINT-5 each product-execution signal independently clears a file', () => {
  const signalFixtures = {
    product_import: `import { thing } from '../../src/thing.js';\ntest('x', () => { thing(); });\n`,
    process_start: `import { execFileSync } from 'node:child_process';\ntest('x', () => { execFileSync('node', ['-e', '1']); });\n`,
    filesystem_access: `import { readFileSync } from 'node:fs';\ntest('x', () => { readFileSync('package.json', 'utf8'); });\n`,
    browser_automation: `import { test, expect } from '@playwright/test';\ntest('x', async () => { await expect(1).toBe(1); });\n`
  };
  assert.deepEqual(
    Object.keys(signalFixtures).sort(),
    PRODUCT_EXECUTION_SIGNALS.map((signal) => signal.id).sort(),
    'every declared signal must have a fixture proving it is sufficient on its own'
  );

  for (const [signalId, content] of Object.entries(signalFixtures)) {
    assert.deepEqual(detectProductExecutionSignals(content), [signalId]);
    const root = makeFixtureRoot({ 'story-signal-main.test.js': content });
    try {
      const { status } = runLint(root);
      assert.equal(status, 0, `${signalId} alone must satisfy the lint`);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }

  assert.deepEqual(detectProductExecutionSignals(HISTORICAL_VACUOUS_FILE), []);
});

test('LINT-10 a nested directory under test/e2e is scanned, not silently skipped', () => {
  // A gate that never reports clean on what it cannot see must not drop a
  // whole subdirectory. Before this was fixed, test/e2e/<dir>/*.test.js was
  // enumerated away and a vacuous file there read as clean.
  const root = makeFixtureRoot({ 'story-real-main.test.js': REAL_BEHAVIOUR_FILE });
  try {
    mkdirSync(join(root, 'test', 'e2e', 'merge', 'deep'), { recursive: true });
    writeFileSync(join(root, 'test', 'e2e', 'merge', 'deep', 'story-nested-main.test.js'), HISTORICAL_VACUOUS_FILE);

    const listed = listE2eTestFiles(join(root, 'test', 'e2e'));
    assert.equal(listed.length, 2, `nested file must be enumerated, saw ${JSON.stringify(listed)}`);
    assert.ok(listed.some((entry) => entry.includes('story-nested-main.test.js')));

    const { status, output } = runLint(root);
    assert.equal(status, 1, 'a vacuous file in a subdirectory must fail the lint');
    assert.match(output, /story-nested-main\.test\.js/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('LINT-11 product code reached through a helper, a subpath import or an alias clears the lint', () => {
  // These shapes execute product behaviour but contain no literal ../src/ path.
  // Rejecting them would make the lint a false-positive generator that a
  // contributor could only satisfy by editing the lint itself.
  const shapes = {
    'via-helper': `import { withTempRepo } from './helpers/repo.js';\ntest('x', () => { withTempRepo(); });\n`,
    'via-subpath': `import { thing } from '#src/thing.js';\ntest('x', () => { thing(); });\n`,
    'via-alias': `import { thing } from '@/src/thing.js';\ntest('x', () => { thing(); });\n`,
    'via-side-effect': `import '../../src/register.js';\ntest('x', () => {});\n`
  };
  for (const [name, content] of Object.entries(shapes)) {
    assert.deepEqual(
      detectProductExecutionSignals(content),
      ['product_import'],
      `${name} must be recognised as reaching product code`
    );
  }

  // The widened signal must not weaken the tripwire: the historical shape,
  // which imported nothing but node:test and node:assert, is still rejected.
  assert.deepEqual(detectProductExecutionSignals(HISTORICAL_VACUOUS_FILE), []);
});

test('LINT-6 the lint only inspects test files and sorts its inspection deterministically', () => {
  const root = makeFixtureRoot({
    'zz-story-main.test.js': REAL_BEHAVIOUR_FILE,
    'aa-story-main.spec.ts': REAL_BEHAVIOUR_FILE,
    'README.md': 'not a test file, and vacuous by nature'
  });
  try {
    assert.deepEqual(listE2eTestFiles(join(root, 'test', 'e2e')), [
      'aa-story-main.spec.ts',
      'zz-story-main.test.js'
    ]);
    const { status } = runLint(root);
    assert.equal(status, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('LINT-7 VET-S-1 the repository test/e2e directory contains no file that executes no product behaviour', () => {
  const { status, output } = runLint(repoRoot);
  assert.equal(status, 0, output);
  assert.match(output, /all execute product behaviour/);
});

test('LINT-9 the lint ships with an operator-facing release note, observability and rollback path', () => {
  // The lint adds a CI step that can fail a contributor's build, so the
  // release note must answer three questions without reading the source:
  // what must an operator do, how is the lint observed, and how is it undone.
  // Asserting on the document keeps those answers from silently drifting.
  const changelog = readFileSync(join(repoRoot, 'CHANGELOG.md'), 'utf8');
  const unreleased = changelog.split(/^## /m).find((section) => section.startsWith('Unreleased'));
  assert.ok(unreleased, 'CHANGELOG.md must have an Unreleased section');

  const entry = unreleased.slice(0, unreleased.indexOf('\n## ') === -1 ? undefined : unreleased.indexOf('\n## '));
  assert.match(entry, /lint:e2e-product-execution/, 'release_note must name the shipped command');
  assert.match(entry, /scripts\/lint-e2e-product-execution\.mjs/);

  // operator action
  assert.match(entry, /\*\*Operator action\*\*/);
  assert.match(entry, /no operator action|none for existing consumers/i);

  // observability_evidence: how a reader sees what the lint did
  assert.match(entry, /\*\*Observability\*\*/);
  assert.match(entry, /exit code/i);
  assert.match(entry, /::error::/);
  assert.match(entry, /fail-closed/i);

  // rollback_instruction: how to undo it, both fully and partially
  assert.match(entry, /\*\*Rollback\*\*/);
  assert.match(entry, /revert/i);
  assert.match(entry, /\.github\/workflows\/ci\.yml/);

  // The documented partial-rollback lever must actually exist in CI.
  const ci = readFileSync(join(repoRoot, '.github', 'workflows', 'ci.yml'), 'utf8');
  assert.match(ci, /npm run lint:e2e-product-execution/);
});

test('LINT-8 the lint is runnable as a standalone command and reports through its exit code', () => {
  const clean = spawnSync(process.execPath, [lintPath], { cwd: repoRoot, encoding: 'utf8' });
  assert.equal(clean.status, 0, clean.stdout + clean.stderr);
  assert.match(clean.stdout, /all execute product behaviour/);

  const dirty = makeFixtureRoot({ 'story-vacuous-main.test.js': HISTORICAL_VACUOUS_FILE });
  try {
    const result = spawnSync(process.execPath, [lintPath], { cwd: dirty, encoding: 'utf8' });
    assert.equal(result.status, 1);
    assert.match(result.stdout, /story-vacuous-main\.test\.js/);
  } finally {
    rmSync(dirty, { recursive: true, force: true });
  }
});
