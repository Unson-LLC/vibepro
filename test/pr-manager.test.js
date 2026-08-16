import './support/scratch-tmpdir.js';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

import { runCli } from '../src/cli.js';
import { preparePullRequest } from '../src/pr-manager.js';
import { writeInferredSpec } from '../src/spec-store.js';

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
  assert.equal(preparation.runtime_identity.integrity.status, 'trusted');
  assert.match(preparation.runtime_identity.identity_digest, /^[0-9a-f]{64}$/);

  const body = await readFile(path.join(root, '.vibepro', 'pr', storyId, 'pr-body.md'), 'utf8');
  assert.match(body, /### Story document/);
  assert.match(body, new RegExp(`docs/management/stories/active/${storyId}\\.md`));
  assert.match(body, /### Acceptance criteria/);
  assert.match(body, /\[未対応\].*AC-2/, 'unmapped AC must be rendered as unaddressed, not as a blocker');
  assert.match(body, /### VibePro runtime identity/);
  assert.match(body, new RegExp(preparation.runtime_identity.identity_digest));
});

test('pr prepare summarizes multi-tenant contract, six views, findings, and review lenses', async () => {
  const storyId = 'story-pr-manager-tenant';
  const storyDoc = STORY_DOC
    .replaceAll('story-pr-manager-ac', storyId)
    .replace('# Story', '# Multi-tenant Story\n\n複数テナントのqueue、credential、storage境界をtenant_idで分離する。');
  const root = await setupRepo({ storyId, storyDoc });
  const contract = JSON.parse(await readFile(
    path.join(import.meta.dirname, 'fixtures', 'multi-tenant-architecture', 'pooled.json'),
    'utf8'
  ));
  await writeInferredSpec(root, storyId, {
    schema_version: '0.1.0',
    story_id: storyId,
    clauses: [],
    multi_tenancy: contract
  });

  await preparePullRequest(root, { storyId, baseRef: 'main' });
  const preparation = await readJson(path.join(root, '.vibepro', 'pr', storyId, 'pr-prepare.json'));
  assert.equal(preparation.multi_tenant_architecture.status, 'ready');
  assert.equal(Object.keys(preparation.multi_tenant_architecture.views).length, 6);
  assert.deepEqual(
    preparation.multi_tenant_architecture.review_lenses.map((lens) => lens.id),
    ['tenant_architecture', 'security_boundary', 'operations_and_migration']
  );

  const body = await readFile(path.join(root, '.vibepro', 'pr', storyId, 'pr-body.md'), 'utf8');
  assert.match(body, /### Multi-tenant architecture/);
  assert.match(body, /status: ready/);
  assert.match(body, /system_context/);
  assert.match(body, /evidence coverage: verified/);
  assert.match(body, /review\/security_boundary \[ready\]/);
  assert.match(body, /unconfirmed: none/);
});

test('pr prepare rejects legacy verification evidence without runtime identity before writing judgment', async () => {
  const storyId = 'story-pr-manager-legacy-runtime';
  const root = await setupRepo({ storyId, storyDoc: STORY_DOC.replaceAll('story-pr-manager-ac', storyId) });
  const prDir = path.join(root, '.vibepro', 'pr', storyId);
  await mkdir(prDir, { recursive: true });
  await writeFile(path.join(prDir, 'verification-evidence.json'), `${JSON.stringify({
    schema_version: '0.1.0',
    story_id: storyId,
    commands: [{ kind: 'unit', status: 'pass', command: 'node --test test/example.test.js' }]
  }, null, 2)}\n`);

  await assert.rejects(
    () => preparePullRequest(root, { storyId, baseRef: 'main' }),
    /runtime_mismatch/
  );
  await assert.rejects(readFile(path.join(prDir, 'pr-prepare.json')), /ENOENT/);
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
