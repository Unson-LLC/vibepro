import './support/scratch-tmpdir.js';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

import { runCli } from '../src/cli.js';
import { buildReportFingerprint } from '../src/report-fingerprint.js';

const execFileAsync = promisify(execFile);

async function git(repo, args) {
  return execFileAsync('git', args, { cwd: repo, encoding: 'utf8' });
}

const STORY_DOC = [
  '---',
  'story_id: story-fingerprint-demo',
  'title: Fingerprint demo',
  '---',
  '',
  '# Story',
  '',
  '## Acceptance Criteria',
  '- AC-1: The widget renders without error',
  ''
].join('\n');

async function setupPreparedRepo() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vibepro-fingerprint-'));
  await writeFile(path.join(root, 'index.html'), '<!doctype html><title>Test</title>');
  await git(root, ['init', '-b', 'main']);
  await git(root, ['config', 'user.email', 'vibepro@example.com']);
  await git(root, ['config', 'user.name', 'VibePro Test']);
  await runCli(['init', root, '--story-id', 'story-fingerprint-demo', '--title', 'Fingerprint demo']);
  await mkdir(path.join(root, 'docs', 'management', 'stories', 'active'), { recursive: true });
  await writeFile(path.join(root, 'docs', 'management', 'stories', 'active', 'story-fingerprint-demo.md'), STORY_DOC);
  await git(root, ['add', '.']);
  await git(root, ['commit', '-m', 'init']);
  await git(root, ['switch', '-c', 'feature/fingerprint']);
  await writeFile(path.join(root, 'widget.js'), 'export function renderWidget() { return true; }\n');
  await mkdir(path.join(root, 'test'), { recursive: true });
  await writeFile(path.join(root, 'test', 'widget.test.js'), "import test from 'node:test';\ntest('AC-1 widget renders', () => {});\n");
  await git(root, ['add', 'widget.js', 'test/widget.test.js']);
  await git(root, ['commit', '-m', 'implement widget rendering']);
  return root;
}

test('report fingerprint --kind pr-body throws an explicit error when pr-prepare.json does not exist', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vibepro-fingerprint-missing-'));
  await mkdir(root, { recursive: true });
  await assert.rejects(
    () => buildReportFingerprint(root, { kind: 'pr-body', storyId: 'story-never-prepared' }),
    (error) => {
      assert.match(error.message, /no pr-prepare\.json found/);
      assert.match(error.message, /story-never-prepared/);
      assert.match(error.message, /Run `pr prepare`/);
      return true;
    }
  );
});

test('report fingerprint --kind pr-body computes fields from the persisted minimal-core pr-prepare.json schema', async () => {
  const root = await setupPreparedRepo();
  await runCli(['verify', 'record', root, '--id', 'story-fingerprint-demo', '--kind', 'unit', '--status', 'pass', '--command', 'node --test test/widget.test.js']);
  const prepareResult = await runCli(['pr', 'prepare', root, '--story-id', 'story-fingerprint-demo', '--base', 'main', '--json']);
  assert.equal(prepareResult.exitCode, 0);

  const fingerprint = await buildReportFingerprint(root, { kind: 'pr-body', storyId: 'story-fingerprint-demo' });

  assert.equal(fingerprint.kind, 'pr-body');
  assert.equal(fingerprint.story_id, 'story-fingerprint-demo');
  assert.equal(fingerprint.story.story_id, 'story-fingerprint-demo');

  // Story-document discovery and AC/code traceability computed by pr prepare
  // must flow through to the fingerprint (Task 2 output), not be dropped.
  assert.equal(fingerprint.story_source.found, true);
  assert.equal(fingerprint.story_source.path, 'docs/management/stories/active/story-fingerprint-demo.md');
  assert.equal(fingerprint.traceability.acceptance_criteria.length, 1);
  assert.equal(fingerprint.traceability.summary.acceptance_criteria_count, 1);

  assert.equal(fingerprint.verification.recorded, true);
  assert.equal(fingerprint.verification.commands[0].kind, 'unit');
  assert.equal(fingerprint.verification.commands[0].status, 'pass');

  // The review pipeline reports the configured default stage set, but no
  // review is recorded until at least one role artifact actually exists.
  assert.equal(fingerprint.review.configured, true);
  assert.equal(fingerprint.review.recorded, false);
  assert.equal(fingerprint.review.complete, false);
  assert.equal(fingerprint.review.status, 'needs_review');

  // Deterministic, schema-derived numerical truth — no gate_dag / requirement
  // consistency fields (removed with the minimal-core rebuild).
  assert.equal(fingerprint.numerical_truth.changed_files_count, 2);
  assert.equal(fingerprint.numerical_truth.acceptance_criteria_count, 1);
  assert.equal(fingerprint.numerical_truth.requirement_invariant_count, 0);
  assert.equal(fingerprint.numerical_truth.requirement_contradiction_count, 0);
  assert.deepEqual(fingerprint.findings, []);

  assert.ok(fingerprint.inputs_digest.story_sha.startsWith('sha256:'));
  assert.ok(fingerprint.inputs_digest.traceability_sha.startsWith('sha256:'));

  assert.equal(fingerprint.pr_context, undefined, 'legacy pr_context field must not resurface');
  assert.equal(fingerprint.gate_dag, undefined, 'legacy gate_dag field must not resurface');
});

test('report fingerprint is deterministic for the same persisted pr-prepare.json (no live recomputation)', async () => {
  const root = await setupPreparedRepo();
  const prepareResult = await runCli(['pr', 'prepare', root, '--story-id', 'story-fingerprint-demo', '--base', 'main', '--json']);
  assert.equal(prepareResult.exitCode, 0);

  const first = await buildReportFingerprint(root, { kind: 'pr-body', storyId: 'story-fingerprint-demo' });

  // Mutate the working tree without re-running `pr prepare`.
  await writeFile(path.join(root, 'extra.txt'), 'untracked change\n');

  const second = await buildReportFingerprint(root, { kind: 'pr-body', storyId: 'story-fingerprint-demo' });
  assert.deepEqual(second.git, first.git, 'fingerprint reads the persisted artifact, not live git state');
  assert.equal(second.inputs_digest.git_sha, first.inputs_digest.git_sha);
});
