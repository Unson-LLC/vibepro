import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

import { startExecution } from '../src/execution-state.js';
import { evaluateManagedWorktreeCommandContext, resolveManagedWorktreeMode } from '../src/managed-worktree.js';

const execFileAsync = promisify(execFile);
const STORY_ID = 'story-corrupt-config-fixture';

async function git(repo, args) {
  return execFileAsync('git', args, { cwd: repo, encoding: 'utf8' });
}

async function writeJson(filePath, value) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function baseConfig() {
  return {
    schema_version: '0.1.0',
    tool: 'vibepro',
    execution: { managed_worktree: 'preferred' },
    brainbase: {
      stories: [{ story_id: STORY_ID, status: 'active' }],
      current_story_id: STORY_ID
    }
  };
}

async function makeRepoFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vibepro-corrupt-config-'));
  await git(root, ['init', '-b', 'main']);
  await git(root, ['config', 'user.email', 'vibepro@example.com']);
  await git(root, ['config', 'user.name', 'VibePro Test']);
  await mkdir(path.join(root, '.vibepro'), { recursive: true });
  await writeJson(path.join(root, '.vibepro', 'config.json'), baseConfig());
  await writeJson(path.join(root, '.vibepro', 'vibepro-manifest.json'), { schema_version: '0.1.0', tool: 'vibepro' });
  await writeFile(path.join(root, 'README.md'), '# corrupt config fixture\n');
  await git(root, ['add', '.']);
  await git(root, ['commit', '-m', 'chore: init corrupt config fixture']);
  return root;
}

function corruptConfig(root) {
  return writeFile(path.join(root, '.vibepro', 'config.json'), '{not json');
}

test('resolveManagedWorktreeMode names the config file when it holds invalid JSON', async (t) => {
  const root = await makeRepoFixture();
  t.after(async () => rm(root, { recursive: true, force: true }));

  await corruptConfig(root);

  await assert.rejects(resolveManagedWorktreeMode(root), (error) => {
    assert.match(error.message, /config JSON is invalid/);
    assert.ok(error.message.includes(path.join(root, '.vibepro', 'config.json')),
      `error must name the broken file, got: ${error.message}`);
    return true;
  });
});

test('protected command context from inside the worktree names the corrupt source repo config', async (t) => {
  const root = await makeRepoFixture();
  t.after(async () => rm(root, { recursive: true, force: true }));

  const started = await startExecution(root, { storyId: STORY_ID });
  const worktreePath = started.state.managed_worktree?.path;
  assert.ok(worktreePath, 'execute start must record a managed worktree path');

  await corruptConfig(root);

  await assert.rejects(
    evaluateManagedWorktreeCommandContext(worktreePath, { storyId: STORY_ID, commandName: 'verify record' }),
    (error) => {
      assert.match(error.message, /config JSON is invalid/);
      assert.ok(error.message.includes(path.join('.vibepro', 'config.json')),
        `error must point at the source repo config, got: ${error.message}`);
      return true;
    }
  );
});
