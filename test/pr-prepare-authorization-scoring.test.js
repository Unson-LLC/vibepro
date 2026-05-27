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

async function setupRepoWithStory({
  storyBody = null,
  writeStory = true,
  sourceFile = null,
  addSourceContent = null
} = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vibepro-prpas-'));
  await writeFile(path.join(root, 'index.html'), '<!doctype html><title>Test</title>');
  await git(root, ['init', '-b', 'main']);
  await git(root, ['config', 'user.email', 'vibepro@example.com']);
  await git(root, ['config', 'user.name', 'VibePro Test']);
  await runCli([
    'init',
    root,
    '--story-id',
    'story-test-scoring',
    '--title',
    'Test scoring'
  ]);
  if (writeStory) {
    await mkdir(path.join(root, 'docs', 'management', 'stories', 'active'), { recursive: true });
    await writeFile(
      path.join(root, 'docs', 'management', 'stories', 'active', 'story-test-scoring.md'),
      storyBody
    );
  }
  await git(root, ['add', '.']);
  await git(root, ['commit', '-m', 'init']);
  await git(root, ['switch', '-c', 'feature/test']);
  if (sourceFile && addSourceContent !== null) {
    await mkdir(path.dirname(path.join(root, sourceFile)), { recursive: true });
    await writeFile(path.join(root, sourceFile), addSourceContent);
    await git(root, ['add', sourceFile]);
    await git(root, ['commit', '-m', `feat: add ${sourceFile}`]);
  }
  return root;
}

test('pr prepare embeds authorization_scoring in pr-prepare.json', async () => {
  const repo = await setupRepoWithStory({
    storyBody: '---\nstory_id: story-test-scoring\ntitle: Test scoring\n---\n\n# Story\n\n## Background\nTest only.\n\n## Acceptance Criteria\n- Touch a README only.\n',
    sourceFile: 'README.md',
    addSourceContent: '# Hello\n'
  });
  await runCli(['pr', 'prepare', repo, '--story-id', 'story-test-scoring', '--base', 'main', '--json']);
  const json = await readJson(path.join(repo, '.vibepro', 'pr', 'story-test-scoring', 'pr-prepare.json'));
  assert.ok(json.authorization_scoring, 'authorization_scoring must be present');
  const scoring = json.authorization_scoring;
  assert.equal(scoring.schema_version, '0.1.0');
  assert.ok(['high', 'medium', 'low', 'unknown'].includes(scoring.authorization_level));
  assert.ok(['allow', 'require_human_review', 'block'].includes(scoring.review_outcome_recommendation));
  assert.ok(scoring.matrix_cell);
  assert.ok(scoring.risk_profile);
  assert.equal(scoring.risk_profile.profile, 'light', 'README-only change should be light profile');
});

test('story mentioning server_api yields medium when API file is touched', async () => {
  const repo = await setupRepoWithStory({
    storyBody: '---\nstory_id: story-test-scoring\ntitle: Test scoring\n---\n\n# Story\n\n## Background\nNew server_api endpoint required.\n\n## Acceptance Criteria\n- Add a server_api route for /widgets that returns 201.\n',
    sourceFile: 'src/api/widgets.js',
    addSourceContent: 'export function handler() {}\n'
  });
  await runCli(['pr', 'prepare', repo, '--story-id', 'story-test-scoring', '--base', 'main', '--json']);
  const json = await readJson(path.join(repo, '.vibepro', 'pr', 'story-test-scoring', 'pr-prepare.json'));
  const scoring = json.authorization_scoring;
  assert.equal(scoring.risk_profile.profile, 'api_contract');
  assert.equal(scoring.authorization_level, 'medium');
  assert.equal(scoring.review_outcome_recommendation, 'require_human_review');
  assert.ok(scoring.signals.some((s) => s.kind === 'acceptance_criteria_mentions_surface' && s.surface === 'server_api'));
});

test('transient unresolved story source keeps authorization_scoring unknown for risky changes', async () => {
  const repo = await setupRepoWithStory({
    writeStory: false,
    sourceFile: 'src/api/widgets.js',
    addSourceContent: 'export function handler() {}\n'
  });
  await runCli(['pr', 'prepare', repo, '--story-id', 'story-test-scoring', '--base', 'main', '--json']);
  const json = await readJson(path.join(repo, '.vibepro', 'pr', 'story-test-scoring', 'pr-prepare.json'));
  const scoring = json.authorization_scoring;
  assert.equal(scoring.risk_profile.profile, 'api_contract');
  assert.equal(scoring.authorization_level, 'unknown');
  assert.equal(scoring.review_outcome_recommendation, 'block');
  assert.deepEqual(scoring.signals, []);
});

test('pr prepare tolerates missing decision records (INV-PAS-3)', async () => {
  const repo = await setupRepoWithStory({
    storyBody: '---\nstory_id: story-test-scoring\ntitle: Test scoring\n---\n\n# Story\n\n## Background\nTest.\n\n## Acceptance Criteria\n- Test.\n',
    sourceFile: 'README.md',
    addSourceContent: '# x\n'
  });
  const result = await runCli(['pr', 'prepare', repo, '--story-id', 'story-test-scoring', '--base', 'main', '--json']);
  assert.equal(result.exitCode, 0);
  const json = await readJson(path.join(repo, '.vibepro', 'pr', 'story-test-scoring', 'pr-prepare.json'));
  assert.ok(json.authorization_scoring);
});

test('authorization_scoring is advisory and does not change ready_for_pr_create (INV-PAS-1)', async () => {
  const repo = await setupRepoWithStory({
    storyBody: '---\nstory_id: story-test-scoring\ntitle: Test scoring\n---\n\n# Story\n\n## Background\nTest.\n\n## Acceptance Criteria\n- Test.\n',
    sourceFile: 'README.md',
    addSourceContent: '# x\n'
  });
  await runCli(['pr', 'prepare', repo, '--story-id', 'story-test-scoring', '--base', 'main', '--json']);
  const json = await readJson(path.join(repo, '.vibepro', 'pr', 'story-test-scoring', 'pr-prepare.json'));
  const gateReady = json.gate_status?.ready_for_pr_create ?? null;
  assert.equal(typeof gateReady, 'boolean', 'ready_for_pr_create must remain a boolean determined by gate logic');
  assert.notEqual(json.authorization_scoring, undefined, 'scoring is advisory but present');
});
