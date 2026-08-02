import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { assertCommandMatchesVerificationKind } from '../src/verification-evidence.js';

// The suite is I/O-bound and scales negatively with parallelism; --test-concurrency=2 is the
// measured optimum (unlimited parallelism took 28 minutes on a loaded host). The unit evidence
// command-form gate only recognizes `npm test` as the full suite, so the npm script is the one
// place where the optimal concurrency and the gate-recognized command can coincide.
// Covers story-vibepro-unit-suite-concurrency-default:AC-1 (script pins the concurrency) and
// story-vibepro-unit-suite-concurrency-default:AC-4 (this test fails if the pin is lost).
test('npm test runs the full suite at the measured-optimal concurrency', async () => {
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(pkg.scripts.test, 'node --test --test-concurrency=2');
});

// Covers story-vibepro-unit-suite-concurrency-default:AC-2 (the command-form gate keeps
// accepting `npm test` with no gate-logic change).
test('npm test stays recognized as passing full-suite unit evidence', () => {
  assert.doesNotThrow(() => assertCommandMatchesVerificationKind('unit', 'npm test', 'pass'));
});
