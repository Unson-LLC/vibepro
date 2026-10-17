import './support/scratch-tmpdir.js';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

import {
  preparePullRequest,
  renderPrPrepareSummary
} from '../src/pr-manager.js';
import { getSpecDraftFile, writeDraftSpec, writeInferredSpec } from '../src/spec-store.js';
import { runCli } from '../src/cli.js';

const execFileAsync = promisify(execFile);

async function git(repo, args) {
  return execFileAsync('git', args, { cwd: repo, encoding: 'utf8' });
}

const STORY_DOC = [
  '---',
  'story_id: story-draft-spec',
  'title: Draft spec story',
  '---',
  '',
  '# Story',
  '',
  '## Acceptance Criteria',
  '- AC-1: The widget renders without error',
  ''
].join('\n');

async function setupRepo(storyId = 'story-draft-spec') {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vibepro-pr-draft-spec-'));
  await writeFile(path.join(root, 'index.html'), '<!doctype html><title>Test</title>');
  await git(root, ['init', '-b', 'main']);
  await git(root, ['config', 'user.email', 'vibepro@example.com']);
  await git(root, ['config', 'user.name', 'VibePro Test']);
  await runCli(['init', root, '--story-id', storyId, '--title', 'Draft spec story']);
  await mkdir(path.join(root, 'docs', 'management', 'stories', 'active'), { recursive: true });
  await writeFile(
    path.join(root, 'docs', 'management', 'stories', 'active', `${storyId}.md`),
    STORY_DOC.replaceAll('story-draft-spec', storyId)
  );
  await git(root, ['add', '.']);
  await git(root, ['commit', '-m', 'init']);
  await git(root, ['switch', '-c', 'feature/draft-spec']);
  await writeFile(path.join(root, 'widget.js'), 'export function renderWidget() { return true; }\n');
  await git(root, ['add', 'widget.js']);
  await git(root, ['commit', '-m', 'implement widget']);
  return root;
}

test('pr prepare reports draft spec when only draft.json exists', async () => {
  const storyId = 'story-draft-only';
  const root = await setupRepo(storyId);
  await writeDraftSpec(root, storyId, {
    schema_version: '0.1.0',
    story_id: storyId,
    clauses: [{ id: 'C-1', statement: 'one' }, { id: 'C-2', statement: 'two' }]
  });

  const { preparation } = await preparePullRequest(root, { storyId, baseRef: 'main' });
  assert.deepEqual(preparation.spec, {
    present: false,
    status: 'draft',
    story_id: storyId,
    clause_count: 2
  });

  const summary = renderPrPrepareSummary({ preparation, artifacts: { json: '', pr_body: '' } });
  assert.match(summary, /- spec: draft \(not accepted\)/);

  const body = await readFile(path.join(root, '.vibepro', 'pr', storyId, 'pr-body.md'), 'utf8');
  assert.match(body, /- draft spec present, not accepted \(`story-draft-only`, 2 clause\(s\)\)/);
  assert.doesNotMatch(body, /no accepted spec found/);
});

test('pr prepare prefers accepted spec when both accepted and draft exist', async () => {
  const storyId = 'story-accepted-and-draft';
  const root = await setupRepo(storyId);
  await writeDraftSpec(root, storyId, {
    schema_version: '0.1.0',
    story_id: storyId,
    clauses: [{ id: 'D-1', statement: 'draft clause' }]
  });
  await writeInferredSpec(root, storyId, {
    schema_version: '0.1.0',
    story_id: storyId,
    clauses: [{ id: 'A-1', statement: 'accepted clause' }]
  });

  const { preparation } = await preparePullRequest(root, { storyId, baseRef: 'main' });
  assert.equal(preparation.spec.status, 'accepted');
  assert.equal(preparation.spec.present, true);
  assert.equal(preparation.spec.clause_count, 1);

  const summary = renderPrPrepareSummary({ preparation, artifacts: { json: '', pr_body: '' } });
  assert.match(summary, /- spec: present/);
});

test('pr prepare reports missing spec when neither accepted nor draft exists', async () => {
  const storyId = 'story-no-spec';
  const root = await setupRepo(storyId);

  const { preparation } = await preparePullRequest(root, { storyId, baseRef: 'main' });
  assert.deepEqual(preparation.spec, { present: false, status: 'missing' });

  const summary = renderPrPrepareSummary({ preparation, artifacts: { json: '', pr_body: '' } });
  assert.match(summary, /- spec: missing/);

  const body = await readFile(path.join(root, '.vibepro', 'pr', storyId, 'pr-body.md'), 'utf8');
  assert.match(body, /- no accepted spec found for this story/);
});

test('pr prepare treats invalid draft JSON as missing spec', async () => {
  const storyId = 'story-invalid-draft';
  const root = await setupRepo(storyId);
  await mkdir(path.dirname(getSpecDraftFile(root, storyId)), { recursive: true });
  await writeFile(getSpecDraftFile(root, storyId), '{not json', 'utf8');

  const { preparation } = await preparePullRequest(root, { storyId, baseRef: 'main' });
  assert.deepEqual(preparation.spec, { present: false, status: 'missing' });
});

test('pr prepare gate status is unchanged for draft-only vs missing spec', async () => {
  const storyId = 'story-gate-draft-vs-missing';
  const rootMissing = await setupRepo(storyId);
  const missingResult = await preparePullRequest(rootMissing, { storyId, baseRef: 'main' });

  const rootDraft = await setupRepo(`${storyId}-draft`);
  await writeDraftSpec(rootDraft, `${storyId}-draft`, {
    schema_version: '0.1.0',
    story_id: `${storyId}-draft`,
    clauses: []
  });
  const draftResult = await preparePullRequest(rootDraft, { storyId: `${storyId}-draft`, baseRef: 'main' });

  assert.equal(draftResult.preparation.gate_status, missingResult.preparation.gate_status);
  assert.deepEqual(draftResult.preparation.blocking_reasons, missingResult.preparation.blocking_reasons);
});
