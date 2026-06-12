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

async function setupRepo() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vibepro-trace-bind-'));
  await writeFile(path.join(root, 'index.html'), '<!doctype html><title>Test</title>');
  await git(root, ['init', '-b', 'main']);
  await git(root, ['config', 'user.email', 'vibepro@example.com']);
  await git(root, ['config', 'user.name', 'VibePro Test']);
  await runCli(['init', root, '--story-id', 'story-test-init', '--title', 'Init story']);
  return root;
}

test('story add writes traceability skeleton', async () => {
  const root = await setupRepo();
  await runCli(['story', 'add', root, '--id', 'story-test-bind', '--title', 'Bind story']);
  const traceability = await readJson(path.join(root, '.vibepro', 'pr', 'story-test-bind', 'traceability.json'));
  assert.equal(traceability.schema_version, '0.1.0');
  assert.equal(traceability.story_id, 'story-test-bind');
  assert.equal(traceability.lifecycle, 'declared_not_started');
  assert.equal(traceability.source, 'story_add');
  assert.ok(traceability.created_at, 'created_at must be set');
  assert.ok(traceability.updated_at, 'updated_at must be set');
  assert.deepEqual(traceability.evidence, []);
});

test('init --story-id also writes traceability skeleton', async () => {
  const root = await setupRepo();
  const traceability = await readJson(path.join(root, '.vibepro', 'pr', 'story-test-init', 'traceability.json'));
  assert.equal(traceability.lifecycle, 'declared_not_started');
  assert.equal(traceability.source, 'story_add');
});

test('pr prepare updates traceability lifecycle', async () => {
  const root = await setupRepo();
  await mkdir(path.join(root, 'docs', 'management', 'stories', 'active'), { recursive: true });
  await writeFile(
    path.join(root, 'docs', 'management', 'stories', 'active', 'story-test-init.md'),
    '---\nstory_id: story-test-init\ntitle: Init story\n---\n\n# Story\n\n## Background\nTest.\n\n## Acceptance Criteria\n- Touch README only.\n'
  );
  await git(root, ['add', '.']);
  await git(root, ['commit', '-m', 'init']);
  await git(root, ['switch', '-c', 'feature/test']);
  await writeFile(path.join(root, 'README.md'), '# Hello\n');
  await git(root, ['add', 'README.md']);
  await git(root, ['commit', '-m', 'feat: add README']);

  const traceabilityPath = path.join(root, '.vibepro', 'pr', 'story-test-init', 'traceability.json');
  const before = await readJson(traceabilityPath);

  await runCli(['pr', 'prepare', root, '--story-id', 'story-test-init', '--base', 'main', '--json']);

  const after = await readJson(traceabilityPath);
  assert.equal(after.lifecycle, 'in_progress');
  assert.equal(after.source, 'pr_prepare');
  assert.equal(after.created_at, before.created_at, 'created_at must be preserved');
  for (const entry of before.evidence) {
    assert.ok(
      after.evidence.some((item) => item.type === entry.type && item.ref === entry.ref),
      'prior evidence must be preserved'
    );
  }
  assert.ok(
    after.evidence.some((item) => item.type === 'pr_artifact'),
    'prepare must connect generated artifacts as evidence'
  );
});
