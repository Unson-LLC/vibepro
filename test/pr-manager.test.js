import './support/scratch-tmpdir.js';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

import { runCli } from '../src/cli.js';

const execFileAsync = promisify(execFile);

async function git(repo, args) {
  return execFileAsync('git', args, { cwd: repo, encoding: 'utf8' });
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'));
}

const STORY_DOC = [
  '---',
  'story_id: story-pr-manager-ac',
  'title: AC coverage story',
  '---',
  '',
  '# Story',
  '',
  '## Acceptance Criteria',
  '- AC-1: The widget renders without error',
  '- AC-2: Something completely unrelated to any changed file',
  ''
].join('\n');

async function setupRepo({ storyId = 'story-pr-manager-ac', storyDoc = STORY_DOC } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vibepro-pr-manager-'));
  await writeFile(path.join(root, 'index.html'), '<!doctype html><title>Test</title>');
  await git(root, ['init', '-b', 'main']);
  await git(root, ['config', 'user.email', 'vibepro@example.com']);
  await git(root, ['config', 'user.name', 'VibePro Test']);
  await runCli(['init', root, '--story-id', storyId, '--title', 'AC coverage story']);
  await mkdir(path.join(root, 'docs', 'management', 'stories', 'active'), { recursive: true });
  await writeFile(path.join(root, 'docs', 'management', 'stories', 'active', `${storyId}.md`), storyDoc);
  await git(root, ['add', '.']);
  await git(root, ['commit', '-m', 'init']);
  await git(root, ['switch', '-c', 'feature/ac-coverage']);
  await writeFile(path.join(root, 'widget.js'), 'export function renderWidget() { return true; }\n');
  await git(root, ['add', 'widget.js']);
  await git(root, ['commit', '-m', 'implement widget rendering']);
  return root;
}

test('pr prepare embeds story_source and traceability, with unmapped clauses shown as unaddressed (non-blocking)', async () => {
  const storyId = 'story-pr-manager-ac';
  const root = await setupRepo({ storyId });

  const result = await runCli(['pr', 'prepare', root, '--story-id', storyId, '--base', 'main', '--json']);
  assert.equal(result.exitCode, 0, 'pr prepare must not block even though AC-2 has no matching evidence');

  const preparation = await readJson(path.join(root, '.vibepro', 'pr', storyId, 'pr-prepare.json'));

  assert.equal(preparation.story_source.found, true);
  assert.equal(preparation.story_source.path, `docs/management/stories/active/${storyId}.md`);
  assert.equal(preparation.story_source.acceptance_criteria_count, 2);

  const clauses = preparation.traceability.acceptance_criteria;
  assert.equal(clauses.length, 2);
  const ac1 = clauses.find((clause) => /AC-1/.test(clause.text));
  const ac2 = clauses.find((clause) => /AC-2/.test(clause.text));
  assert.ok(ac1, 'AC-1 must be present in the clause map');
  assert.ok(ac2, 'AC-2 must be present in the clause map');
  assert.notEqual(ac1.status, 'unmapped', 'AC-1 mentions the changed widget.js file and should not be unmapped');
  assert.equal(ac2.status, 'unmapped', 'AC-2 has no matching file, test, or evidence and must be unmapped');

  assert.equal(preparation.traceability.summary.acceptance_criteria_count, 2);
  assert.ok(preparation.traceability.summary.unmapped_count >= 1);

  const body = await readFile(path.join(root, '.vibepro', 'pr', storyId, 'pr-body.md'), 'utf8');
  assert.match(body, /### Story document/);
  assert.match(body, new RegExp(`docs/management/stories/active/${storyId}\\.md`));
  assert.match(body, /### Acceptance criteria/);
  assert.match(body, /\[未対応\].*AC-2/, 'unmapped AC must be rendered as unaddressed, not as a blocker');
});

test('pr prepare does not block when no story document exists', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vibepro-pr-manager-nodoc-'));
  await writeFile(path.join(root, 'index.html'), '<!doctype html><title>Test</title>');
  await git(root, ['init', '-b', 'main']);
  await git(root, ['config', 'user.email', 'vibepro@example.com']);
  await git(root, ['config', 'user.name', 'VibePro Test']);
  await runCli(['init', root, '--story-id', 'story-no-doc', '--title', 'No doc story']);
  await git(root, ['add', '.']);
  await git(root, ['commit', '-m', 'init']);
  await git(root, ['switch', '-c', 'feature/no-doc']);
  await writeFile(path.join(root, 'README.md'), '# Hello\n');
  await git(root, ['add', 'README.md']);
  await git(root, ['commit', '-m', 'feat: add README']);

  const result = await runCli(['pr', 'prepare', root, '--story-id', 'story-no-doc', '--base', 'main', '--json']);
  assert.equal(result.exitCode, 0);

  const preparation = await readJson(path.join(root, '.vibepro', 'pr', 'story-no-doc', 'pr-prepare.json'));
  assert.equal(preparation.story_source.found, false);
  assert.equal(preparation.story_source.acceptance_criteria_count, 0);
  assert.deepEqual(preparation.traceability.acceptance_criteria, []);

  const body = await readFile(path.join(root, '.vibepro', 'pr', 'story-no-doc', 'pr-body.md'), 'utf8');
  assert.match(body, /no story document found/);
  assert.match(body, /no acceptance criteria found/);
});
