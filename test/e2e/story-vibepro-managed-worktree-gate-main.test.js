import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

import { runCli } from '../../src/cli.js';
import {
  assertManagedWorktreeCommandAllowed,
  buildManagedWorktreeGate,
  formatManagedWorktreePrStatus
} from '../../src/managed-worktree-gate.js';

// story-vibepro-managed-worktree-gate ac:5 ac:6
// emergency bypass には理由が必要で、decision record として保存され、
// `gate:managed_worktree` が `bypassed` になり PR body へ表示される。
//
// 対象分岐: src/managed-worktree-gate.js の findAcceptedManagedWorktreeBypass()
// と buildManagedWorktreeGate() の bypassed 返却。他のテストは waiver 記録後に
// `verify record` が exit 0 になることしか見ておらず、gate object の
// status / decision_id / reason は検証していない。

const execFileAsync = promisify(execFile);
const STORY_ID = 'story-vibepro-managed-worktree-gate';

async function git(repo, args) {
  return execFileAsync('git', args, { cwd: repo, encoding: 'utf8' });
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'));
}

async function writeJson(filePath, value) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

// A repo whose config requires the managed worktree, checked out somewhere that
// is not a managed worktree. Without a bypass this is the `block` path.
async function makeRequiredModeRepo() {
  const repo = await mkdtemp(path.join(os.tmpdir(), 'vibepro-mwg-e2e-'));
  await writeFile(path.join(repo, 'index.html'), '<!doctype html><title>Managed Worktree Gate E2E</title>');
  await git(repo, ['init', '-b', 'main']);
  await git(repo, ['config', 'user.email', 'vibepro@example.com']);
  await git(repo, ['config', 'user.name', 'VibePro Test']);
  const init = await runCli([
    'init',
    repo,
    '--story-id',
    STORY_ID,
    '--title',
    'managed worktree gate',
    '--language',
    'ja'
  ]);
  assert.equal(init.exitCode, 0);

  const configPath = path.join(repo, '.vibepro', 'config.json');
  const config = await readJson(configPath);
  config.execution = { ...(config.execution ?? {}), managed_worktree: 'required' };
  await writeJson(configPath, config);

  await git(repo, ['add', '.']);
  await git(repo, ['commit', '-m', 'chore: init managed worktree gate e2e']);
  return repo;
}

async function recordManagedWorktreeWaiver(repo, { status }) {
  return runCli([
    'decision',
    'record',
    repo,
    '--id',
    STORY_ID,
    '--type',
    'waiver',
    '--source',
    'gate:managed_worktree',
    '--summary',
    'Emergency fix must run outside the managed worktree.',
    '--reason',
    'CI recovery requires recording evidence before a managed worktree exists.',
    '--reviewer',
    'codex',
    '--status',
    status
  ]);
}

test('story-vibepro-managed-worktree-gate ac:2 required mode outside a managed worktree blocks before any bypass is recorded', async () => {
  const repo = await makeRequiredModeRepo();

  const gate = await buildManagedWorktreeGate(repo, { storyId: STORY_ID });

  assert.equal(gate.id, 'gate:managed_worktree');
  assert.equal(gate.mode, 'required');
  assert.equal(gate.status, 'block');
  assert.equal(gate.required, true);
  assert.match(gate.reason, /managed worktree execution state is missing/);
  assert.equal(formatManagedWorktreePrStatus(gate), 'needs_review');

  await assert.rejects(
    assertManagedWorktreeCommandAllowed(repo, { storyId: STORY_ID, commandName: 'pr prepare' }),
    /pr prepare is blocked by gate:managed_worktree/
  );
});

test('story-vibepro-managed-worktree-gate ac:5 an accepted waiver decision record turns the gate bypassed and names the decision', async () => {
  const repo = await makeRequiredModeRepo();

  const decision = await recordManagedWorktreeWaiver(repo, { status: 'accepted' });
  assert.equal(decision.exitCode, 0);

  // ac:5 the bypass is persisted as an auditable decision record, not a flag.
  const records = await readJson(path.join(repo, '.vibepro', 'pr', STORY_ID, 'decision-records.json'));
  const waiver = records.decisions.find((item) => item.source === 'gate:managed_worktree');
  assert.equal(waiver.type, 'waiver');
  assert.equal(waiver.status, 'accepted');
  assert.equal(
    waiver.reason,
    'CI recovery requires recording evidence before a managed worktree exists.'
  );

  const gate = await buildManagedWorktreeGate(repo, { storyId: STORY_ID });
  assert.equal(gate.status, 'bypassed');
  assert.equal(gate.mode, 'required');
  assert.equal(gate.required, true);
  assert.equal(gate.decision_id, waiver.decision_id);
  // The reason carries the recorded justification, so the bypass is not silent.
  assert.match(gate.reason, /^accepted bypass decision recorded: /);
  assert.match(gate.reason, /CI recovery requires recording evidence/);

  // ac:6 the PR body projection reports the bypass verbatim.
  assert.equal(formatManagedWorktreePrStatus(gate), 'bypassed');

  // A bypassed gate stops blocking commands in required mode.
  const allowed = await assertManagedWorktreeCommandAllowed(repo, {
    storyId: STORY_ID,
    commandName: 'pr prepare'
  });
  assert.equal(allowed.status, 'bypassed');
});

test('story-vibepro-managed-worktree-gate ac:5 a waiver that is still open does not bypass the gate', async () => {
  const repo = await makeRequiredModeRepo();

  const decision = await recordManagedWorktreeWaiver(repo, { status: 'open' });
  assert.equal(decision.exitCode, 0);

  const gate = await buildManagedWorktreeGate(repo, { storyId: STORY_ID });
  assert.equal(gate.status, 'block');
  assert.equal(gate.decision_id, undefined);
  assert.equal(formatManagedWorktreePrStatus(gate), 'needs_review');

  await assert.rejects(
    assertManagedWorktreeCommandAllowed(repo, { storyId: STORY_ID, commandName: 'pr create' }),
    /pr create is blocked by gate:managed_worktree/
  );
});

test('story-vibepro-managed-worktree-gate ac:4 disabled mode reports not_applicable and never blocks', async () => {
  const repo = await makeRequiredModeRepo();
  const configPath = path.join(repo, '.vibepro', 'config.json');
  const config = await readJson(configPath);
  config.execution.managed_worktree = 'disabled';
  await writeJson(configPath, config);

  const gate = await buildManagedWorktreeGate(repo, { storyId: STORY_ID });
  assert.equal(gate.status, 'not_applicable');
  assert.equal(gate.required, false);
  assert.equal(gate.reason, 'managed worktree mode is disabled');
  assert.equal(formatManagedWorktreePrStatus(gate), 'disabled');

  const allowed = await assertManagedWorktreeCommandAllowed(repo, {
    storyId: STORY_ID,
    commandName: 'pr prepare'
  });
  assert.equal(allowed.status, 'not_applicable');
});
