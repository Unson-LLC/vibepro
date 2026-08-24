import './support/scratch-tmpdir.js';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { access, mkdtemp, mkdir, readFile, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';

import { assertSelectedTaskAccepted, assertSelectedTaskScope, bindTaskAuthority, readTaskAuthorities } from '../src/task-authority.js';
import { createStoryTasks } from '../src/story-task-generator.js';

const execFileAsync = promisify(execFile);
const STORY_ID = 'story-authority';

async function repo() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vibepro-task-authority-'));
  await mkdir(path.join(root, '.vibepro'), { recursive: true });
  await writeFile(path.join(root, '.vibepro', 'config.json'), `${JSON.stringify({
    schema_version: '0.1.0',
    brainbase: { stories: [{ story_id: STORY_ID, title: 'Authority', status: 'active' }] }
  }, null, 2)}\n`);
  await execFileAsync('git', ['init'], { cwd: root });
  await execFileAsync('git', ['config', 'user.email', 'test@example.com'], { cwd: root });
  await execFileAsync('git', ['config', 'user.name', 'Test'], { cwd: root });
  await execFileAsync('git', ['add', '.vibepro/config.json'], { cwd: root });
  await execFileAsync('git', ['commit', '-m', 'init'], { cwd: root });
  return root;
}

async function trackedInput(root, name = 'authority.json', overrides = {}) {
  const input = {
    schema_version: '0.1.0',
    story_id: STORY_ID,
    tasks: [{ task_id: 'TASK-001', story_id: STORY_ID, title: 'Implement', allowed_paths: ['src/task.js', 'test/task.test.js'] }],
    ...overrides
  };
  await writeFile(path.join(root, name), `${JSON.stringify(input, null, 2)}\n`);
  await execFileAsync('git', ['add', name], { cwd: root });
  return name;
}

test('bind creates deterministic accepted authority with tracked provenance', async () => {
  const root = await repo();
  const input = await trackedInput(root);
  await assert.rejects(access(path.join(root, '.vibepro', 'stories', STORY_ID, 'spec')));
  await assert.rejects(access(path.join(root, '.vibepro', 'stories', STORY_ID, 'reviews')));
  const first = await bindTaskAuthority(root, { storyId: STORY_ID, inputPath: input });
  const firstBytes = await readFile(first.artifacts.canonical_json, 'utf8');
  const second = await bindTaskAuthority(root, { storyId: STORY_ID, inputPath: input });
  const secondBytes = await readFile(second.artifacts.canonical_json, 'utf8');

  assert.equal(firstBytes, secondBytes);
  assert.equal(first.authority.authority.status, 'accepted');
  assert.equal(first.authority.provenance.input_path, input);
  assert.match(first.authority.provenance.input_sha256, /^[a-f0-9]{64}$/);
  assert.deepEqual(first.authority.tasks[0].allowed_paths, ['src/task.js', 'test/task.test.js']);

  const authorities = await readTaskAuthorities(root, STORY_ID);
  assert.equal(authorities.accepted.present, true);
  assert.deepEqual(authorities.accepted.tasks.map((task) => task.id), ['TASK-001']);
  await assert.rejects(access(path.join(root, '.vibepro', 'stories', STORY_ID, 'spec')));
  await assert.rejects(access(path.join(root, '.vibepro', 'stories', STORY_ID, 'reviews')));
});

test('bind rejects untracked, wrong-story, duplicate, path escape, and diagnostic proposal inputs', async () => {
  const root = await repo();
  await writeFile(path.join(root, 'untracked.json'), '{}\n');
  await assert.rejects(bindTaskAuthority(root, { storyId: STORY_ID, inputPath: 'untracked.json' }), /tracked/);
  await writeFile(path.join(root, 'authority.txt'), '{}\n');
  await execFileAsync('git', ['add', 'authority.txt'], { cwd: root });
  await assert.rejects(bindTaskAuthority(root, { storyId: STORY_ID, inputPath: 'authority.txt' }), /JSON file/);

  for (const [name, overrides, pattern] of [
    ['schema.json', { schema_version: '9.9.9' }, /schema_version/],
    ['wrong.json', { story_id: 'story-other' }, /story_id/],
    ['duplicate.json', { tasks: [
      { task_id: 'TASK-001', story_id: STORY_ID, allowed_paths: ['src/a.js'] },
      { task_id: 'TASK-001', story_id: STORY_ID, allowed_paths: ['src/b.js'] }
    ] }, /duplicate/],
    ['escape.json', { tasks: [{ task_id: 'TASK-001', story_id: STORY_ID, allowed_paths: ['../outside.js'] }] }, /allowed_paths/],
    ['diagnostic.json', { source_run: { run_id: 'diagnosis-1' } }, /diagnostic proposal/],
    ['unknown.json', { tasks: [{ task_id: 'TASK-001', story_id: STORY_ID, allowed_paths: ['src/a.js'], unexpected: true }] }, /unknown task field/]
  ]) {
    const input = await trackedInput(root, name, overrides);
    await assert.rejects(bindTaskAuthority(root, { storyId: STORY_ID, inputPath: input }), pattern);
  }
});

test('diagnosis routes to proposal output and cannot overwrite accepted authority', async () => {
  const root = await repo();
  const input = await trackedInput(root);
  const bound = await bindTaskAuthority(root, { storyId: STORY_ID, inputPath: input });
  const before = await readFile(bound.artifacts.canonical_json, 'utf8');

  const diagnosis = await createStoryTasks(root, {
    story: { story_id: STORY_ID, title: 'Authority' },
    evidence: { findings: [], action_candidates: [], gates: [] },
    runId: 'diagnosis-20260825',
    gateStatus: 'pass'
  });

  assert.match(diagnosis.artifacts.story_tasks_json, /diagnostics\/diagnosis-20260825\/tasks\.json$/);
  assert.equal(await readFile(bound.artifacts.canonical_json, 'utf8'), before);
  const authorities = await readTaskAuthorities(root, STORY_ID);
  assert.equal(authorities.accepted.task_count, 1);
  assert.equal(authorities.generated.present, true);
  assert.equal(authorities.generated.path, `.vibepro/stories/${STORY_ID}/diagnostics/diagnosis-20260825/tasks.json`);
});

test('selected task validation fails closed outside accepted authority', async () => {
  const root = await repo();
  await assert.rejects(assertSelectedTaskAccepted(root, STORY_ID, 'TASK-001'), /not in accepted authority/);
  const input = await trackedInput(root);
  await bindTaskAuthority(root, { storyId: STORY_ID, inputPath: input });
  assert.equal((await assertSelectedTaskAccepted(root, STORY_ID, 'TASK-001')).selected.id, 'TASK-001');
  await assert.rejects(assertSelectedTaskAccepted(root, STORY_ID, 'TASK-999'), /accepted tasks: TASK-001/);
});

test('selected task validation rejects stale or tampered accepted authority', async () => {
  const root = await repo();
  const input = await trackedInput(root);
  const bound = await bindTaskAuthority(root, { storyId: STORY_ID, inputPath: input });
  const canonical = JSON.parse(await readFile(bound.artifacts.canonical_json, 'utf8'));

  for (const [label, mutate, pattern] of [
    ['schema', (document) => { document.schema_version = '9.9.9'; }, /schema_version/],
    ['status', (document) => { document.authority.status = 'generated_proposal'; }, /accepted status/],
    ['digest', (document) => { document.provenance.input_sha256 = '0'.repeat(64); }, /digest.*match/],
    ['input escape', (document) => { document.provenance.input_path = '../outside.json'; }, /inside the repository/],
    ['duplicate', (document) => { document.tasks.push({ ...document.tasks[0] }); }, /duplicate task_id/],
    ['cross story', (document) => { document.tasks[0].story_id = 'story-other'; }, /story_id must exactly match/],
    ['allowed path escape', (document) => { document.tasks[0].allowed_paths = ['../outside.js']; }, /allowed_paths/],
    ['valid-looking task divergence', (document) => { document.tasks[0].allowed_paths = ['src/other.js']; }, /tasks must match/],
    ['unknown canonical field', (document) => { document.unexpected = true; }, /unknown accepted/]
  ]) {
    const tampered = structuredClone(canonical);
    mutate(tampered);
    await writeFile(bound.artifacts.canonical_json, `${JSON.stringify(tampered, null, 2)}\n`);
    await assert.rejects(assertSelectedTaskAccepted(root, STORY_ID, 'TASK-001'), pattern, label);
  }

  await writeFile(bound.artifacts.canonical_json, `${JSON.stringify(canonical, null, 2)}\n`);
  await writeFile(path.join(root, input), `${JSON.stringify({
    schema_version: '0.1.0', story_id: STORY_ID,
    tasks: [{ task_id: 'TASK-001', story_id: STORY_ID, allowed_paths: ['src/changed.js'] }]
  }, null, 2)}\n`);
  await assert.rejects(assertSelectedTaskAccepted(root, STORY_ID, 'TASK-001'), /digest.*match/);
});

async function commitTaskScopeFiles(root, files) {
  const { stdout: baseBranch } = await execFileAsync('git', ['branch', '--show-current'], { cwd: root, encoding: 'utf8' });
  await execFileAsync('git', ['switch', '-c', 'feature/task-scope'], { cwd: root });
  for (const [relativePath, content] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(root, relativePath)), { recursive: true });
    await writeFile(path.join(root, relativePath), content);
  }
  await execFileAsync('git', ['add', '.'], { cwd: root });
  await execFileAsync('git', ['commit', '-m', 'task scope changes'], { cwd: root });
  const { stdout } = await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' });
  return { base_ref: baseBranch.trim(), head_ref: 'HEAD', head_sha: stdout.trim() };
}

test('task scope globstar accepts zero or nested directory segments', async () => {
  const prefixRoot = await repo();
  const prefixGit = await commitTaskScopeFiles(prefixRoot, {
    'src/a.js': 'export const a = true;\n',
    'src/deep/b.js': 'export const b = true;\n'
  });
  await assert.doesNotReject(assertSelectedTaskScope(prefixRoot, {
    id: 'TASK-001', allowed_paths: ['src/**/*.js']
  }, prefixGit));

  const repositoryRoot = await repo();
  const rootGit = await commitTaskScopeFiles(repositoryRoot, {
    'a.js': 'export const a = true;\n',
    'deep/b.js': 'export const b = true;\n'
  });
  await assert.doesNotReject(assertSelectedTaskScope(repositoryRoot, {
    id: 'TASK-001', allowed_paths: ['**/*.js']
  }, rootGit));
});

test('task scope globstar still rejects wrong extensions and outside prefixes', async () => {
  for (const [files, pattern] of [
    [{ 'src/a.txt': 'not javascript\n' }, 'src/a.txt'],
    [{ 'other/a.js': 'export const outside = true;\n' }, 'other/a.js']
  ]) {
    const root = await repo();
    const git = await commitTaskScopeFiles(root, files);
    await assert.rejects(assertSelectedTaskScope(root, {
      id: 'TASK-001', allowed_paths: ['src/**/*.js']
    }, git), new RegExp(`outside accepted task TASK-001 allowed_paths: ${pattern.replace('.', '\\.')}`));
  }
});

test('task bind CLI writes JSON result', async () => {
  const root = await repo();
  const input = await trackedInput(root);
  const cli = path.resolve('bin/vibepro.js');
  const { stdout } = await execFileAsync(process.execPath, [cli, 'task', 'bind', root, '--id', STORY_ID, '--input', input, '--json']);
  const result = JSON.parse(stdout);
  assert.equal(result.authority.status, 'accepted');
  assert.deepEqual(result.tasks.map((task) => task.task_id), ['TASK-001']);
});

test('bind preflights routed projections before writing accepted authority', async () => {
  const root = await repo();
  const input = await trackedInput(root);
  const outside = await mkdtemp(path.join(os.tmpdir(), 'vibepro-task-authority-outside-'));
  const configPath = path.join(root, '.vibepro', 'config.json');
  const config = JSON.parse(await readFile(configPath, 'utf8'));
  config.artifact_routing = { artifacts: { task_plan: {
    canonical: `.vibepro/stories/{story_id}/tasks/tasks.md`,
    projections: [{ path: 'escaped/{story_id}.md', generated: true }]
  } } };
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);
  await symlink(outside, path.join(root, 'escaped'));

  await assert.rejects(bindTaskAuthority(root, { storyId: STORY_ID, inputPath: input }), (error) => error.code === 'repository_traversal');
  await assert.rejects(access(path.join(root, '.vibepro', 'stories', STORY_ID, 'tasks', 'tasks.json')));
});
