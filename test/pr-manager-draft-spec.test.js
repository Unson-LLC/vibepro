import './support/scratch-tmpdir.js';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

import { runCli } from '../src/cli.js';
import { preparePullRequest, renderPrPrepareSummary } from '../src/pr-manager.js';
import { getSpecDraftFile, writeDraftSpec, writeInferredSpec } from '../src/spec-store.js';

const execFileAsync = promisify(execFile);

async function git(repo, args) {
  return execFileAsync('git', args, { cwd: repo, encoding: 'utf8' });
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'));
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

async function setupRepo({ storyId = 'story-draft-spec' } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vibepro-pr-draft-spec-'));
  await writeFile(path.join(root, 'index.html'), '<!doctype html><title>Test</title>');
  await git(root, ['init', '-b', 'main']);
  await git(root, ['config', 'user.email', 'vibepro@example.com']);
  await git(root, ['config', 'user.name', 'VibePro Test']);
  await runCli(['init', root, '--story-id', storyId, '--title', 'Draft spec story']);
  await mkdir(path.join(root, 'docs', 'management', 'stories', 'active'), { recursive: true });
  await writeFile(path.join(root, 'docs', 'management', 'stories', 'active', `${storyId}.md`), STORY_DOC);
  await git(root, ['add', '.']);
  await git(root, ['commit', '-m', 'init']);
  await git(root, ['switch', '-c', 'feature/draft-spec']);
  await writeFile(path.join(root, 'widget.js'), 'export function renderWidget() { return true; }\n');
  await git(root, ['add', 'widget.js']);
  await git(root, ['commit', '-m', 'implement widget rendering']);
  return root;
}

function draft(clauses) {
  return { schema_version: '0.1.0', story_id: 'story-draft-spec', clauses };
}

test('pr prepare reports a draft spec as draft, not missing', async () => {
  const storyId = 'story-draft-spec';
  const root = await setupRepo({ storyId });
  await writeDraftSpec(root, storyId, draft([
    { id: 'X-001', type: 'scenario', statement: 'one' },
    { id: 'X-002', type: 'scenario', statement: 'two' }
  ]));

  const result = await preparePullRequest(root, { storyId, baseRef: 'main' });

  assert.deepEqual(result.preparation.spec, {
    present: false,
    status: 'draft',
    story_id: storyId,
    clause_count: 2
  });

  const summary = renderPrPrepareSummary(result);
  assert.match(summary, /- spec: draft \(not accepted\)/);

  const body = await readFile(path.join(root, '.vibepro', 'pr', storyId, 'pr-body.md'), 'utf8');
  assert.match(body, new RegExp(`- draft spec present, not accepted \\(\`${storyId}\`, 2 clause\\(s\\)\\)`));
  assert.doesNotMatch(body, /no accepted spec found for this story/);
});

test('pr prepare treats an accepted spec as accepted even when a draft also exists', async () => {
  const storyId = 'story-draft-spec';
  const root = await setupRepo({ storyId });
  await writeInferredSpec(root, storyId, {
    schema_version: '0.1.0',
    story_id: storyId,
    clauses: [{ id: 'X-001', type: 'scenario', statement: 'accepted clause' }]
  });
  await writeDraftSpec(root, storyId, draft([
    { id: 'X-001', type: 'scenario', statement: 'draft one' },
    { id: 'X-002', type: 'scenario', statement: 'draft two' }
  ]));

  const result = await preparePullRequest(root, { storyId, baseRef: 'main' });

  assert.deepEqual(result.preparation.spec, {
    present: true,
    status: 'accepted',
    story_id: storyId,
    clause_count: 1
  });

  const summary = renderPrPrepareSummary(result);
  assert.match(summary, /- spec: present/);

  const body = await readFile(path.join(root, '.vibepro', 'pr', storyId, 'pr-body.md'), 'utf8');
  assert.match(body, new RegExp(`- accepted spec present \\(\`${storyId}\`, 1 clause\\(s\\)\\)`));
  assert.doesNotMatch(body, /draft spec present/);
});

test('pr prepare reports missing when neither an accepted nor a draft spec exists', async () => {
  const storyId = 'story-draft-spec';
  const root = await setupRepo({ storyId });

  const result = await preparePullRequest(root, { storyId, baseRef: 'main' });

  assert.deepEqual(result.preparation.spec, { present: false, status: 'missing' });

  const summary = renderPrPrepareSummary(result);
  assert.match(summary, /- spec: missing/);

  const body = await readFile(path.join(root, '.vibepro', 'pr', storyId, 'pr-body.md'), 'utf8');
  assert.match(body, /- no accepted spec found for this story/);
});

test('pr prepare treats an invalid draft spec as missing without throwing', async () => {
  const storyId = 'story-draft-spec';
  const root = await setupRepo({ storyId });
  const draftFile = getSpecDraftFile(root, storyId);
  await mkdir(path.dirname(draftFile), { recursive: true });
  await writeFile(draftFile, '{ not valid json');

  const result = await preparePullRequest(root, { storyId, baseRef: 'main' });

  assert.deepEqual(result.preparation.spec, { present: false, status: 'missing' });
});

test('pr prepare draft spec leaves gate status and readiness identical to no spec', async () => {
  const storyId = 'story-draft-spec';
  const root = await setupRepo({ storyId });

  const missing = await preparePullRequest(root, { storyId, baseRef: 'main' });
  await writeDraftSpec(root, storyId, draft([{ id: 'X-001', type: 'scenario', statement: 'one' }]));
  const draftOnly = await preparePullRequest(root, { storyId, baseRef: 'main' });

  assert.equal(draftOnly.preparation.spec.status, 'draft');
  assert.equal(draftOnly.preparation.gate_status, missing.preparation.gate_status);
  assert.deepEqual(draftOnly.preparation.blocking_reasons, missing.preparation.blocking_reasons);
});
