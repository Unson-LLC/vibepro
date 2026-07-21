import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

import { getExecutionStatus, startExecution } from '../src/execution-state.js';
import { ensureManagedWorktree, refreshManagedWorktree } from '../src/managed-worktree.js';

const execFileAsync = promisify(execFile);
const STORY_ID = 'story-vibepro-managed-worktree-policy-resync';

async function git(repo, args) {
  return execFileAsync('git', args, { cwd: repo, encoding: 'utf8' });
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'));
}

async function writeJson(filePath, value) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function baseConfig() {
  return {
    schema_version: '0.1.0',
    tool: 'vibepro',
    execution: { managed_worktree: 'preferred' },
    budgets: { pr_artifact_bytes: 16384 },
    artifact_routing: { default_view: 'summary' },
    brainbase: {
      stories: [{ story_id: STORY_ID, status: 'active' }],
      current_story_id: STORY_ID
    }
  };
}

async function makeRepoFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vibepro-policy-resync-'));
  await git(root, ['init', '-b', 'main']);
  await git(root, ['config', 'user.email', 'vibepro@example.com']);
  await git(root, ['config', 'user.name', 'VibePro Test']);
  await mkdir(path.join(root, '.vibepro'), { recursive: true });
  await writeJson(path.join(root, '.vibepro', 'config.json'), baseConfig());
  await writeJson(path.join(root, '.vibepro', 'vibepro-manifest.json'), { schema_version: '0.1.0', tool: 'vibepro' });
  await writeFile(path.join(root, 'README.md'), '# policy resync fixture\n');
  await git(root, ['add', '.']);
  await git(root, ['commit', '-m', 'chore: init policy resync fixture']);
  return root;
}

async function makeRepoWithManagedWorktree() {
  const root = await makeRepoFixture();
  const managedWorktree = await ensureManagedWorktree(root, { storyId: STORY_ID });
  assert.equal(managedWorktree.status, 'created');
  return { root, managedWorktree };
}

async function updateParentConfig(root, mutate) {
  const configPath = path.join(root, '.vibepro', 'config.json');
  const config = await readJson(configPath);
  mutate(config);
  await writeJson(configPath, config);
  return config;
}

function worktreeConfigPath(managedWorktree) {
  return path.join(managedWorktree.path, '.vibepro', 'config.json');
}

// story-vibepro-managed-worktree-policy-resync ac:1 refresh resyncs policy sections from the source repo config
// story-vibepro-managed-worktree-policy-resync ac:2 non-policy sections stay a creation-time snapshot
// story-vibepro-managed-worktree-policy-resync ac:6 budgets.delivery_efficiency distributed after worktree creation reaches the worktree copy
test('refreshManagedWorktree resyncs policy sections while non-policy sections stay frozen', async (t) => {
  const { root, managedWorktree } = await makeRepoWithManagedWorktree();
  t.after(async () => rm(root, { recursive: true, force: true }));

  const initialCopy = await readJson(worktreeConfigPath(managedWorktree));
  assert.equal(initialCopy.budgets.delivery_efficiency, undefined);

  await updateParentConfig(root, (config) => {
    config.budgets.delivery_efficiency = { max_fresh_input_tokens: 900000, max_subagent_dispatches: 12 };
    config.brainbase.current_story_id = 'story-other-selected-later';
  });

  const refreshed = await refreshManagedWorktree(root, managedWorktree);
  assert.equal(refreshed.status, 'created');
  assert.equal(refreshed.policy_sync.status, 'synced');
  assert.deepEqual(refreshed.policy_sync.sections_updated, ['budgets']);

  const syncedCopy = await readJson(worktreeConfigPath(managedWorktree));
  assert.deepEqual(syncedCopy.budgets.delivery_efficiency, {
    max_fresh_input_tokens: 900000,
    max_subagent_dispatches: 12
  });
  assert.equal(syncedCopy.brainbase.current_story_id, STORY_ID, 'story catalog snapshot must not follow the parent');

  const refreshedAgain = await refreshManagedWorktree(root, managedWorktree);
  assert.equal(refreshedAgain.policy_sync.status, 'unchanged');
  assert.deepEqual(refreshedAgain.policy_sync.sections_updated, []);
});

// story-vibepro-managed-worktree-policy-resync ac:3 policy sections removed from the parent are removed from the worktree copy
test('refreshManagedWorktree mirrors policy section removal from the parent config', async (t) => {
  const { root, managedWorktree } = await makeRepoWithManagedWorktree();
  t.after(async () => rm(root, { recursive: true, force: true }));

  const initialCopy = await readJson(worktreeConfigPath(managedWorktree));
  assert.deepEqual(initialCopy.artifact_routing, { default_view: 'summary' });

  await updateParentConfig(root, (config) => {
    delete config.artifact_routing;
    delete config.budgets.pr_artifact_bytes;
  });

  const refreshed = await refreshManagedWorktree(root, managedWorktree);
  assert.equal(refreshed.policy_sync.status, 'synced');
  assert.deepEqual(refreshed.policy_sync.sections_updated.sort(), ['artifact_routing', 'budgets']);

  const syncedCopy = await readJson(worktreeConfigPath(managedWorktree));
  assert.equal(syncedCopy.artifact_routing, undefined);
  assert.deepEqual(syncedCopy.budgets, {});
});

// story-vibepro-managed-worktree-policy-resync ac:5 refresh from inside the worktree still syncs via source_repo
test('refreshManagedWorktree syncs from source_repo when called with the worktree as repoRoot', async (t) => {
  const { root, managedWorktree } = await makeRepoWithManagedWorktree();
  t.after(async () => rm(root, { recursive: true, force: true }));

  await updateParentConfig(root, (config) => {
    config.execution.managed_worktree = 'required';
  });

  const refreshed = await refreshManagedWorktree(managedWorktree.path, managedWorktree);
  assert.equal(refreshed.policy_sync.status, 'synced');
  assert.deepEqual(refreshed.policy_sync.sections_updated, ['execution']);

  const syncedCopy = await readJson(worktreeConfigPath(managedWorktree));
  assert.equal(syncedCopy.execution.managed_worktree, 'required');
});

// story-vibepro-managed-worktree-policy-resync ac:5 same-path source is skipped instead of self-syncing
test('refreshManagedWorktree skips policy sync when the source resolves to the worktree itself', async (t) => {
  const { root, managedWorktree } = await makeRepoWithManagedWorktree();
  t.after(async () => rm(root, { recursive: true, force: true }));

  const selfSourced = { ...managedWorktree, source_repo: managedWorktree.path };
  const refreshed = await refreshManagedWorktree(managedWorktree.path, selfSourced);
  assert.equal(refreshed.policy_sync.status, 'skipped');
  assert.deepEqual(refreshed.policy_sync.sections_updated, []);
});

// story-vibepro-managed-worktree-policy-resync ac:4 the synced outcome is auditable through the execution state path
test('execution status reports policy_sync=synced instead of masking it with a second refresh', async (t) => {
  const root = await makeRepoFixture();
  t.after(async () => rm(root, { recursive: true, force: true }));

  await startExecution(root, { storyId: STORY_ID });
  await updateParentConfig(root, (config) => {
    config.budgets.delivery_efficiency = { max_fresh_input_tokens: 900000 };
  });

  const first = await getExecutionStatus(root, { storyId: STORY_ID });
  assert.equal(first.found, true);
  assert.equal(first.state.managed_worktree.policy_sync.status, 'synced',
    'the CLI-backed status path must report the sync that actually happened, not a post-sync unchanged diff');
  assert.deepEqual(first.state.managed_worktree.policy_sync.sections_updated, ['budgets']);

  const second = await getExecutionStatus(root, { storyId: STORY_ID });
  assert.equal(second.state.managed_worktree.policy_sync.status, 'unchanged');
});

// story-vibepro-managed-worktree-policy-resync ac:4 sync failures do not fail the refresh itself
test('refreshManagedWorktree reports failed policy sync without throwing when the source config is corrupt', async (t) => {
  const { root, managedWorktree } = await makeRepoWithManagedWorktree();
  t.after(async () => rm(root, { recursive: true, force: true }));

  await writeFile(path.join(root, '.vibepro', 'config.json'), '{not json');

  const refreshed = await refreshManagedWorktree(root, managedWorktree);
  assert.equal(refreshed.status, 'created');
  assert.equal(refreshed.policy_sync.status, 'failed');
  assert.deepEqual(refreshed.policy_sync.sections_updated, []);

  const untouchedCopy = await readJson(worktreeConfigPath(managedWorktree));
  assert.deepEqual(untouchedCopy.budgets, { pr_artifact_bytes: 16384 });
});
