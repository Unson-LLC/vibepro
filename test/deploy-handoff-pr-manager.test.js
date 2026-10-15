import './support/scratch-tmpdir.js';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';

import { runCli } from '../src/cli.js';
import { preparePullRequest } from '../src/pr-manager.js';

const execFileAsync = promisify(execFile);

async function git(repo, args) {
  return execFileAsync('git', args, { cwd: repo, encoding: 'utf8' });
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'));
}

async function setupRepo(storyId) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vibepro-deploy-handoff-'));
  await writeFile(path.join(root, 'index.html'), '<!doctype html><title>Test</title>');
  await git(root, ['init', '-b', 'main']);
  await git(root, ['config', 'user.email', 'vibepro@example.com']);
  await git(root, ['config', 'user.name', 'VibePro Test']);
  await runCli(['init', root, '--story-id', storyId, '--title', 'Deploy handoff story']);
  await mkdir(path.join(root, 'docs', 'stories'), { recursive: true });
  await writeFile(path.join(root, 'docs', 'stories', `${storyId}.md`), [
    '---',
    `story_id: ${storyId}`,
    'title: Deploy handoff story',
    '---',
    '',
    '# Story',
    '',
    '## Acceptance Criteria',
    '- AC-1: The staging endpoint returns the expected response.',
    ''
  ].join('\n'));
  await git(root, ['add', '.']);
  await git(root, ['commit', '-m', 'init']);
  await git(root, ['switch', '-c', 'feature/deploy-handoff']);
  await writeFile(path.join(root, 'widget.js'), 'export function renderWidget() { return true; }\n');
  await git(root, ['add', 'widget.js']);
  await git(root, ['commit', '-m', 'implement widget']);
  return root;
}

async function writeEmptyVerificationEvidence(root, storyId) {
  const directory = path.join(root, '.vibepro', 'pr', storyId);
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, 'verification-evidence.json'), `${JSON.stringify({
    schema_version: '0.1.0',
    story_id: storyId,
    commands: []
  }, null, 2)}\n`);
}

function handoffInput() {
  return {
    target: { repository: 'example/service', environment: 'staging' },
    acceptance_criteria: [{
      id: 'AC-1',
      condition: 'The staging endpoint returns the expected response.',
      evidence_method: 'Read the bounded staging smoke-test receipt.'
    }],
    mode: 'normal',
    authority_ref: 'authority://operator-approval/example'
  };
}

test('pr prepare emits an optional deploy-handoff artifact with hashed relative refs', async () => {
  const storyId = 'story-deploy-handoff-direct';
  const root = await setupRepo(storyId);
  await writeEmptyVerificationEvidence(root, storyId);

  const result = await preparePullRequest(root, {
    storyId,
    baseRef: 'main',
    deployHandoff: handoffInput()
  });
  const artifactPath = result.artifacts.deploy_handoff;
  assert.ok(artifactPath);
  const handoff = await readJson(artifactPath);

  assert.equal(handoff.schema_version, 'deploy-handoff.v1');
  assert.equal(handoff.source, 'vibepro');
  assert.equal(handoff.target.environment, 'staging');
  assert.equal(handoff.head_sha, result.preparation.git.head_sha);
  for (const ref of [handoff.story_ref, handoff.verification_ref, handoff.pr_prepare_ref]) {
    assert.equal(path.isAbsolute(ref.path), false);
    assert.match(ref.path, /^[^\\]+$/);
    assert.match(ref.sha256, /^[0-9a-f]{64}$/);
  }
  assert.equal('merge_commit_sha' in handoff, false);
  assert.equal('request_id' in handoff, false);
  assert.equal('deployed' in handoff, false);
});

test('ordinary pr prepare does not create a deploy-handoff artifact', async () => {
  const storyId = 'story-deploy-handoff-ordinary';
  const root = await setupRepo(storyId);

  const result = await preparePullRequest(root, { storyId, baseRef: 'main' });
  assert.equal('deploy_handoff' in result.artifacts, false);
  const preparation = await readJson(result.artifacts.json);
  assert.equal('deploy_handoff_ref' in preparation, false);
  await assert.rejects(
    readFile(path.join(root, '.vibepro', 'pr', storyId, 'deploy-handoff.json')),
    { code: 'ENOENT' }
  );
});

test('CLI reads deploy-handoff input JSON and reports the generated artifact', async () => {
  const storyId = 'story-deploy-handoff-cli';
  const root = await setupRepo(storyId);
  await writeEmptyVerificationEvidence(root, storyId);
  const inputDir = await mkdtemp(path.join(os.tmpdir(), 'vibepro-deploy-handoff-input-'));
  const inputPath = path.join(inputDir, 'handoff.json');
  await writeFile(inputPath, `${JSON.stringify(handoffInput(), null, 2)}\n`);
  let stdout = '';

  const result = await runCli([
    'pr', 'prepare', root,
    '--story-id', storyId,
    '--base', 'main',
    '--deploy-handoff', inputPath
  ], { stdout: { write: (text) => { stdout += text; } } });

  assert.equal(result.exitCode, 0);
  assert.ok(result.result.artifacts.deploy_handoff);
  assert.equal(result.result.preparation.deploy_handoff_ref, `.vibepro/pr/${storyId}/deploy-handoff.json`);
  assert.match(stdout, /deploy handoff:/);
  const preparation = await readJson(result.result.artifacts.json);
  assert.equal(preparation.deploy_handoff_ref, `.vibepro/pr/${storyId}/deploy-handoff.json`);
  const handoff = await readJson(result.result.artifacts.deploy_handoff);
  assert.equal(handoff.target.repository, 'example/service');
});

test('rejects deploy-handoff Story references whose symlink target escapes the repository', async () => {
  const storyId = 'story-deploy-handoff-story-symlink';
  const root = await setupRepo(storyId);
  await writeEmptyVerificationEvidence(root, storyId);
  const storyPath = path.join(root, 'docs', 'stories', `${storyId}.md`);
  const outsidePath = path.join(path.dirname(root), `${path.basename(root)}-outside-story.md`);
  const storyContent = await readFile(storyPath, 'utf8');
  await writeFile(outsidePath, storyContent);
  await rm(storyPath);
  await symlink(outsidePath, storyPath);

  try {
    await assert.rejects(
      () => preparePullRequest(root, { storyId, baseRef: 'main', deployHandoff: handoffInput() }),
      /must resolve inside the repository/
    );
  } finally {
    await rm(outsidePath, { force: true });
  }
});

test('CLI rejects malformed deploy-handoff JSON before PR preparation', async () => {
  const storyId = 'story-deploy-handoff-invalid-json';
  const root = await setupRepo(storyId);
  const inputDir = await mkdtemp(path.join(os.tmpdir(), 'vibepro-deploy-handoff-invalid-'));
  const inputPath = path.join(inputDir, 'handoff.json');
  await writeFile(inputPath, '{not-json');

  let stderr = '';
  const result = await runCli(
    ['pr', 'prepare', root, '--story-id', storyId, '--base', 'main', '--deploy-handoff', inputPath],
    { stderr: { write: (text) => { stderr += text; } } }
  );
  assert.equal(result.exitCode, 1);
  assert.match(stderr, /must be valid JSON/);
});
