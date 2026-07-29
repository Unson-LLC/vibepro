import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

import { getExecutionStatus, reconcileExecutionState, renderExecutionStateSummary, startExecution } from '../../src/execution-state.js';
import { buildManagedWorktreeGate } from '../../src/managed-worktree-gate.js';
import { evaluateManagedWorktreeCommandContext } from '../../src/managed-worktree.js';
import { recordVerificationEvidence, renderVerificationEvidenceSummary } from '../../src/verification-evidence.js';

const execFileAsync = promisify(execFile);
const STORY_ID = 'story-vibepro-managed-worktree-policy-resync';

async function git(repo, args) {
  return execFileAsync('git', args, { cwd: repo, encoding: 'utf8' });
}

async function writeJson(filePath, value) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

async function makeRepoFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vibepro-policy-resync-e2e-'));
  await git(root, ['init', '-b', 'main']);
  await git(root, ['config', 'user.email', 'vibepro@example.com']);
  await git(root, ['config', 'user.name', 'VibePro Test']);
  await mkdir(path.join(root, '.vibepro'), { recursive: true });
  await writeJson(path.join(root, '.vibepro', 'config.json'), {
    schema_version: '0.1.0',
    tool: 'vibepro',
    execution: { managed_worktree: 'preferred' },
    budgets: { pr_artifact_bytes: 16384 },
    brainbase: { stories: [{ story_id: STORY_ID, status: 'active' }], current_story_id: STORY_ID }
  });
  await writeJson(path.join(root, '.vibepro', 'vibepro-manifest.json'), { schema_version: '0.1.0', tool: 'vibepro' });
  await writeFile(path.join(root, 'README.md'), '# policy resync e2e fixture\n');
  await git(root, ['add', '.']);
  await git(root, ['commit', '-m', 'chore: init policy resync e2e fixture']);
  return root;
}

// story-vibepro-managed-worktree-policy-resync ac:4
// story-vibepro-managed-worktree-policy-resync ac:1
// Composed CLI flow replay: protected commands run the managed-worktree gate/context check
// (which refreshes and performs the actual policy sync) BEFORE the execution-state reconcile
// persists its own refresh. The sync event must survive into the persisted audit trail as
// policy_sync.last_event even though the second refresh diffs already-converged configs.
test('gate-then-reconcile command order keeps the synced policy distribution auditable in execution state', async (t) => {
  const root = await makeRepoFixture();
  t.after(async () => rm(root, { recursive: true, force: true }));

  await startExecution(root, { storyId: STORY_ID });

  const configPath = path.join(root, '.vibepro', 'config.json');
  const parentConfig = JSON.parse(await readFile(configPath, 'utf8'));
  parentConfig.budgets.delivery_efficiency = { max_fresh_input_tokens: 900000 };
  await writeJson(configPath, parentConfig);

  // Step 1: the gate/context check every protected command runs first. This refresh
  // performs the real sync write into the managed worktree config copy.
  const gateContext = await evaluateManagedWorktreeCommandContext(root, {
    storyId: STORY_ID,
    commandName: 'e2e composed flow'
  });
  assert.equal(gateContext.managed_worktree.policy_sync.status, 'synced');
  assert.deepEqual(gateContext.managed_worktree.policy_sync.sections_updated, ['budgets']);

  // Step 2: the reconcile that persists execution state. Its own refresh sees converged
  // configs ('unchanged'), but the durable audit stamp keeps the sync event visible.
  const reconciled = await reconcileExecutionState(root, { storyId: STORY_ID });
  assert.equal(reconciled.state.managed_worktree.policy_sync.status, 'unchanged');
  assert.equal(reconciled.state.managed_worktree.policy_sync.last_event.status, 'synced',
    'the sync performed by the earlier gate refresh must stay auditable through the persisted state');
  assert.deepEqual(reconciled.state.managed_worktree.policy_sync.last_event.sections_updated, ['budgets']);

  const persisted = JSON.parse(await readFile(
    path.join(root, '.vibepro', 'executions', STORY_ID, 'state.json'), 'utf8'));
  assert.equal(persisted.managed_worktree.policy_sync.last_event.status, 'synced');
  assert.deepEqual(persisted.managed_worktree.policy_sync.last_event.sections_updated, ['budgets']);

  const status = await getExecutionStatus(root, { storyId: STORY_ID });
  assert.equal(status.state.managed_worktree.policy_sync.last_event.status, 'synced');
});

// story-vibepro-managed-worktree-policy-resync ac:1
// story-vibepro-managed-worktree-policy-resync ac:4
// buildManagedWorktreeGate is the dominant protected-command path (assertManagedWorktreeCommandAllowed
// call sites across cli.js). Its refresh must perform the sync and surface policy_sync too.
test('buildManagedWorktreeGate path performs the policy sync and surfaces policy_sync', async (t) => {
  const root = await makeRepoFixture();
  t.after(async () => rm(root, { recursive: true, force: true }));

  await startExecution(root, { storyId: STORY_ID });

  const configPath = path.join(root, '.vibepro', 'config.json');
  const parentConfig = JSON.parse(await readFile(configPath, 'utf8'));
  parentConfig.budgets.delivery_efficiency = { max_fresh_input_tokens: 900000 };
  await writeJson(configPath, parentConfig);

  const gate = await buildManagedWorktreeGate(root, { storyId: STORY_ID });
  assert.equal(gate.managed_worktree.policy_sync.status, 'synced');
  assert.deepEqual(gate.managed_worktree.policy_sync.sections_updated, ['budgets']);

  const state = await getExecutionStatus(root, { storyId: STORY_ID });
  const worktreePath = state.state.managed_worktree.path;
  const worktreeConfig = JSON.parse(await readFile(path.join(worktreePath, '.vibepro', 'config.json'), 'utf8'));
  assert.deepEqual(worktreeConfig.budgets.delivery_efficiency, { max_fresh_input_tokens: 900000 },
    'the gate path must actually write the distributed policy into the worktree copy');
  assert.equal(state.state.managed_worktree.policy_sync.last_event.status, 'synced');
});

// story-vibepro-managed-worktree-policy-resync ac:4
// A fail-soft sync failure must be visible on the default human-readable surface,
// not only via --json: silent policy drift is the bug this story exists to prevent.
test('default execute status output surfaces a failed policy sync', async (t) => {
  const root = await makeRepoFixture();
  t.after(async () => rm(root, { recursive: true, force: true }));

  const started = await startExecution(root, { storyId: STORY_ID });
  const worktreePath = started.state.managed_worktree.path;
  await writeFile(path.join(root, '.vibepro', 'config.json'), '{not json');

  // Run from inside the managed worktree (the S-005 posture): the worktree's own config
  // copy is valid, only the parent source is corrupt, so the sync fails soft.
  const status = await getExecutionStatus(worktreePath, { storyId: STORY_ID });
  assert.equal(status.state.managed_worktree.policy_sync.status, 'failed');

  const summary = renderExecutionStateSummary(status);
  assert.match(summary, /policy_sync: failed/,
    'the default text summary must surface the fail-soft sync failure');
  assert.match(summary, /policy_sync_reason: /);
  assert.match(summary, /policy_sync_failed/, 'the managed_worktree headline must flag the failure');
});

// story-vibepro-managed-worktree-policy-resync ac:4
// verify record's plain-text output is also a primary policy-drift surface: a policy_sync
// failure observed by this command's own gate/context refresh must show up without --json.
test('verify record text output surfaces managed worktree context including a failed policy sync', async (t) => {
  const root = await makeRepoFixture();
  t.after(async () => rm(root, { recursive: true, force: true }));

  const result = await recordVerificationEvidence(root, {
    storyId: STORY_ID,
    kind: 'unit',
    status: 'fail',
    command: 'npm run test:run',
    managedWorktreeContext: {
      status: 'satisfied',
      mode: 'preferred',
      required: false,
      command_name: 'verify record',
      reason: 'verify record is running inside the recorded managed worktree',
      managed_worktree: {
        path: path.join(root, '.vibepro-worktrees', STORY_ID),
        branch: `vibepro/${STORY_ID}`,
        actual_branch: `vibepro/${STORY_ID}`,
        dirty: true,
        raw_dirty: true,
        policy_sync: {
          status: 'failed',
          reason: 'source repo config is unreadable',
          sections_updated: [],
          last_event: { status: 'synced', sections_updated: ['budgets'], synced_at: '2026-07-22T00:00:00.000Z' }
        }
      }
    }
  });

  const summary = renderVerificationEvidenceSummary(result);
  assert.match(summary, /managed_worktree: preferred\/satisfied\/policy_sync_failed/,
    'the headline must flag the policy sync failure');
  assert.match(summary, /policy_sync: failed/);
  assert.match(summary, /policy_sync_reason: source repo config is unreadable/);
  assert.match(summary, /policy_sync_last_event: synced \(budgets\) at 2026-07-22T00:00:00\.000Z/);
  assert.match(summary, /raw_dirty: true/, 'pre-existing dirty context must also surface in text output');
});

// Evidence recorded before this surface existed has no managed_worktree_context.
test('verify record text output reports not_recorded when managed worktree context is absent', async (t) => {
  const root = await makeRepoFixture();
  t.after(async () => rm(root, { recursive: true, force: true }));

  const result = await recordVerificationEvidence(root, {
    storyId: STORY_ID,
    kind: 'unit',
    status: 'fail',
    command: 'npm run test:run'
  });

  const summary = renderVerificationEvidenceSummary(result);
  assert.match(summary, /managed_worktree: not_recorded/);
  assert.match(summary, /## Managed Worktree Context\n\n- status: not_recorded/);
});
