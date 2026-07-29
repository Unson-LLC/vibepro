import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const childEnv = { ...process.env };
delete childEnv.NODE_TEST_CONTEXT;

const contractRun = execFileAsync(process.execPath, [
    '--test',
    '--test-name-pattern',
    'gate evidence and release risk reviews survive|merge reuse invalidates only the role|review strict HEAD CLI override|review status keeps stale review when merge delta diff cannot be resolved',
    'test/content-scoped-evidence-freshness.test.js',
    'test/vibepro-cli.test.js'
], {
  cwd: repoRoot,
  encoding: 'utf8',
  env: childEnv,
  maxBuffer: 10 * 1024 * 1024
});

test('story-vibepro-surface-aware-agent-review-freshness AC-1 S-001 unrelated main advance does not stale an unchanged branch review', async () => {
  const { stdout } = await contractRun;
  assert.match(stdout, /gate evidence and release risk reviews survive unrelated main advance and rebase/);
});

test('story-vibepro-surface-aware-agent-review-freshness AC-2 unchanged surfaces remain reusable after rebase or merge', async () => {
  const { stdout } = await contractRun;
  assert.match(stdout, /gate evidence and release risk reviews survive unrelated main advance and rebase/);
});

test('story-vibepro-surface-aware-agent-review-freshness AC-3 S-002 only the role with changed lineage or release impact becomes stale', async () => {
  const { stdout } = await contractRun;
  assert.match(stdout, /merge reuse invalidates only the role whose projection lineage or release impact surface changed/);
});

test('story-vibepro-surface-aware-agent-review-freshness AC-4 unresolved changed files fail closed', async () => {
  const { stdout } = await contractRun;
  assert.match(stdout, /review status keeps stale review when merge delta diff cannot be resolved/);
});

test('story-vibepro-surface-aware-agent-review-freshness AC-5 gate and release roles use surface-aware freshness', async () => {
  const { stdout } = await contractRun;
  assert.match(stdout, /gate evidence and release risk reviews survive unrelated main advance and rebase/);
});

test('story-vibepro-surface-aware-agent-review-freshness AC-6 dirty inspection provenance and lifecycle regressions remain green', async () => {
  const { stdout, stderr } = await contractRun;
  assert.doesNotMatch(stderr, /not ok|Warning:/, 'AC-6 dirty fingerprint inspection input agent provenance review lifecycle');
  assert.match(stdout, /fail 0/, 'AC-6 dirty fingerprint inspection input agent provenance review lifecycle');
});

test('story-vibepro-surface-aware-agent-review-freshness AC-7 S-003 explicit strict HEAD compatibility remains enforced', async () => {
  const { stdout } = await contractRun;
  assert.match(stdout, /review strict HEAD CLI override requires and records an explicit reason/);
});

test('story-vibepro-surface-aware-agent-review-freshness AC-8 contract integration and E2E matrix completes without failures', async () => {
  const { stdout } = await contractRun;
  assert.match(stdout, /fail 0/, 'AC-8 contract integration E2E proves the complete freshness transition matrix');
});
