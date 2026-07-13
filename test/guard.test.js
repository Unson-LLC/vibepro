import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

import {
  GUARD_HOOK_MARKER,
  checkGuard,
  classifyReleaseSurface,
  guardStatus,
  installGuard,
  parsePrePushRefs,
  parsePreToolUseInput,
  readGuardConfig,
  uninstallGuard
} from '../src/guard.js';

const execFileAsync = promisify(execFile);
const STORY_ID = 'story-guard-fixture';

async function git(repo, args) {
  await execFileAsync('git', args, { cwd: repo });
}

async function makeRepo({ workspace = true, guardConfig = null } = {}) {
  const repo = await mkdtemp(path.join(os.tmpdir(), 'vibepro-guard-'));
  await git(repo, ['init', '-b', 'main']);
  await git(repo, ['config', 'user.email', 'test@example.com']);
  await git(repo, ['config', 'user.name', 'Test User']);
  await writeFile(path.join(repo, 'README.md'), '# Fixture\n');
  if (workspace) {
    await mkdir(path.join(repo, '.vibepro'), { recursive: true });
    const config = {
      schema_version: '0.1.0',
      tool: 'vibepro',
      workspace: '.vibepro',
      brainbase: {
        stories: [{ story_id: STORY_ID, title: 'Guard fixture', ssot: 'local', status: 'active' }],
        selected_story_id: STORY_ID
      }
    };
    if (guardConfig) config.guard = guardConfig;
    await writeFile(path.join(repo, '.vibepro', 'config.json'), `${JSON.stringify(config, null, 2)}\n`, 'utf8');
  }
  await git(repo, ['add', '.']);
  await git(repo, ['commit', '-m', 'chore: baseline']);
  return repo;
}

const DEFAULT_CONFIG = {
  workspace_initialized: true,
  enabled: true,
  protected_branches: ['main', 'master'],
  release_patterns: []
};

async function defaultConfigFor(repo) {
  return readGuardConfig(repo);
}

test('GUARD-S-001 release surface classification matches release commands and ignores routine work', async () => {
  const repo = await makeRepo();
  const config = await defaultConfigFor(repo);
  assert.equal(classifyReleaseSurface('gh pr create --base main', config).id, 'raw_pr_create');
  assert.equal(classifyReleaseSurface('cd repo && gh pr merge 12', config).id, 'raw_pr_merge');
  assert.equal(classifyReleaseSurface('fly deploy --now', config).id, 'fly_deploy');
  assert.equal(classifyReleaseSurface('flyctl deploy', config).id, 'fly_deploy');
  assert.equal(classifyReleaseSurface('npm publish', config).id, 'npm_publish');
  assert.equal(classifyReleaseSurface('git push origin main', config).id, 'protected_branch_push');
  assert.equal(classifyReleaseSurface('git push -u origin master', config).id, 'protected_branch_push');
  assert.equal(classifyReleaseSurface('git push origin HEAD:main', config).id, 'protected_branch_push');

  assert.equal(classifyReleaseSurface('npm test', config), null);
  assert.equal(classifyReleaseSurface('git push origin feature/x', config), null);
  assert.equal(classifyReleaseSurface('git push -u origin vibepro/story-x-abc', config), null);
  assert.equal(classifyReleaseSurface('gh pr view 12', config), null);
  assert.equal(classifyReleaseSurface('echo "gh pr create is documented here" > docs.md && npm run build', config), null, 'quoted mention still matches conservatively is acceptable; but plain build commands must not match');
  assert.equal(classifyReleaseSurface('vibepro pr create . --base origin/main', config), null);
  assert.equal(classifyReleaseSurface('node bin/vibepro.js pr create .', config), null);

  // 自己免除はsegment単位: vibepro呼び出しを混ぜても複合コマンドの他segmentは免除されない
  assert.equal(classifyReleaseSurface('vibepro --version && gh pr create --title x', config).id, 'raw_pr_create');
  assert.equal(classifyReleaseSurface('vibepro help; git push origin main', config).id, 'protected_branch_push');
  assert.equal(classifyReleaseSurface('vibepro pr prepare . | tee log && fly deploy', config).id, 'fly_deploy');
});

test('GUARD-S-002 non-release commands allow immediately and unmanaged repos are never blocked', async () => {
  const repo = await makeRepo();
  const routine = await checkGuard(repo, {
    command: 'npm test',
    readinessEvaluator: async () => { throw new Error('readiness must not be evaluated for routine commands'); }
  });
  assert.equal(routine.decision, 'allow');

  const bare = await mkdtemp(path.join(os.tmpdir(), 'vibepro-guard-bare-'));
  const unmanaged = await checkGuard(bare, { command: 'gh pr create' });
  assert.equal(unmanaged.decision, 'allow');
  assert.match(unmanaged.reason, /no VibePro workspace/);
});

test('GUARD-S-011 readiness evaluation errors fail closed while a missing story selection allows deterministically', async () => {
  const repo = await makeRepo();
  const failing = await checkGuard(repo, {
    command: 'gh pr create',
    readinessEvaluator: async () => { throw new Error('workspace JSON corrupted'); }
  });
  assert.equal(failing.decision, 'block');

  const noStory = await makeRepo();
  const configPath = path.join(noStory, '.vibepro', 'config.json');
  const config = JSON.parse(await readFile(configPath, 'utf8'));
  delete config.brainbase.selected_story_id;
  config.brainbase.stories = [];
  await writeFile(configPath, JSON.stringify(config, null, 2), 'utf8');
  const allowed = await checkGuard(noStory, {
    command: 'gh pr create',
    readinessEvaluator: async () => { throw new Error('must not be called without a selected story'); }
  });
  assert.equal(allowed.decision, 'allow');
  assert.match(allowed.reason, /no story is selected/);
});

test('GUARD-S-003 blocked story blocks release surfaces with blocking gates and next commands', async () => {
  const repo = await makeRepo();
  const readinessEvaluator = async () => ({
    status: 'blocked',
    story_id: STORY_ID,
    overall_status: 'needs_verification',
    ready_for_pr_create: false,
    gates: [{ id: 'gate:evidence_adjudication', status: 'needs_evidence', label: 'Evidence Adjudication Gate', blocking: true, critical: true }]
  });
  const result = await checkGuard(repo, { command: 'gh pr create --fill', readinessEvaluator });
  assert.equal(result.decision, 'block');
  assert.equal(result.surface.id, 'raw_pr_create');
  assert.match(result.reason, /Evidence Adjudication Gate/);
  assert.ok(result.next_commands.some((cmd) => cmd.includes('vibepro pr prepare')));
});

test('GUARD-S-004 ready story allows release surfaces', async () => {
  const repo = await makeRepo();
  const readinessEvaluator = async () => ({
    status: 'passed',
    story_id: STORY_ID,
    overall_status: 'ready_for_review',
    ready_for_pr_create: true,
    gates: []
  });
  const result = await checkGuard(repo, { command: 'git push origin main', readinessEvaluator });
  assert.equal(result.decision, 'allow');
});

test('GUARD-S-005 bypass requires a non-empty reason and appends an audit record', async () => {
  const repo = await makeRepo();
  const readinessEvaluator = async () => ({ status: 'blocked', story_id: STORY_ID, ready_for_pr_create: false, gates: [] });

  const silent = await checkGuard(repo, { command: 'gh pr create', readinessEvaluator, bypassReason: '   ' });
  assert.equal(silent.decision, 'block');

  const bypassed = await checkGuard(repo, { command: 'gh pr create', readinessEvaluator, bypassReason: '本番障害の緊急ホットフィックス' });
  assert.equal(bypassed.decision, 'bypass');
  const log = await readFile(path.join(repo, '.vibepro', 'guard', 'bypass-log.jsonl'), 'utf8');
  const entries = log.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
  assert.equal(entries.length, 1);
  assert.equal(entries[0].reason, '本番障害の緊急ホットフィックス');
  assert.equal(entries[0].command, 'gh pr create');
  assert.ok(entries[0].head_sha);
});

test('GUARD-S-006 guard install writes a marked idempotent pre-push hook and refuses foreign hooks', async () => {
  const repo = await makeRepo();
  const first = await installGuard(repo, {});
  assert.equal(first.hook.status, 'installed');
  const hookContent = await readFile(first.hook.path, 'utf8');
  assert.ok(hookContent.includes(GUARD_HOOK_MARKER));
  assert.ok(hookContent.includes('guard check'));

  const second = await installGuard(repo, {});
  assert.equal(second.hook.status, 'reinstalled');

  const removed = await uninstallGuard(repo);
  assert.equal(removed.status, 'uninstalled');
  assert.equal(removed.claude, 'not_installed');

  await mkdir(path.dirname(first.hook.path), { recursive: true });
  await writeFile(first.hook.path, '#!/bin/sh\necho existing user hook\n', 'utf8');
  await chmod(first.hook.path, 0o755);
  await assert.rejects(() => installGuard(repo, {}), /refusing to overwrite/);
  await assert.rejects(() => uninstallGuard(repo), /not managed by vibepro/);
});

test('GUARD-S-007 pre-push ref parsing delegates only protected-branch refs', async () => {
  const stdin = [
    'refs/heads/feature/x 1111111111111111111111111111111111111111 refs/heads/feature/x 0000000000000000000000000000000000000000',
    'refs/heads/main 2222222222222222222222222222222222222222 refs/heads/main 0000000000000000000000000000000000000000'
  ].join('\n');
  const parsed = parsePrePushRefs(stdin, ['main', 'master']);
  assert.equal(parsed.refs.length, 2);
  assert.equal(parsed.protected_refs.length, 1);
  assert.equal(parsed.protected_refs[0].remote_ref, 'refs/heads/main');

  const featureOnly = parsePrePushRefs('refs/heads/f 111 refs/heads/f 000', ['main']);
  assert.equal(featureOnly.protected_refs.length, 0);
});

test('GUARD-S-008 guard install --claude merges the PreToolUse hook preserving existing settings and is idempotent', async () => {
  const repo = await makeRepo();
  const settingsPath = path.join(repo, '.claude', 'settings.json');
  await mkdir(path.dirname(settingsPath), { recursive: true });
  await writeFile(settingsPath, `${JSON.stringify({
    permissions: { allow: ['Bash(npm test)'] },
    hooks: { PostToolUse: [{ matcher: 'Write', hooks: [{ type: 'command', command: 'echo done' }] }] }
  }, null, 2)}\n`, 'utf8');

  const first = await installGuard(repo, { prePush: false, claude: true });
  assert.equal(first.claude.status, 'installed');
  const settings = JSON.parse(await readFile(settingsPath, 'utf8'));
  assert.deepEqual(settings.permissions, { allow: ['Bash(npm test)'] });
  assert.equal(settings.hooks.PostToolUse.length, 1);
  assert.equal(settings.hooks.PreToolUse.length, 1);
  assert.equal(settings.hooks.PreToolUse[0].matcher, 'Bash');
  assert.ok(settings.hooks.PreToolUse[0].hooks[0].command.includes('vibepro guard check'));

  const second = await installGuard(repo, { prePush: false, claude: true });
  assert.equal(second.claude.status, 'already_installed');
  const again = JSON.parse(await readFile(settingsPath, 'utf8'));
  assert.equal(again.hooks.PreToolUse.length, 1);

  // uninstallはClaude hookも対称に除去し、他エントリは保持する
  const removed = await uninstallGuard(repo);
  assert.equal(removed.claude, 'uninstalled');
  const after = JSON.parse(await readFile(settingsPath, 'utf8'));
  assert.equal(after.hooks.PreToolUse.length, 0);
  assert.equal(after.hooks.PostToolUse.length, 1);
  assert.deepEqual(after.permissions, { allow: ['Bash(npm test)'] });
});

test('GUARD-S-009 pretooluse input parsing extracts the tool command and tolerates invalid JSON', () => {
  assert.equal(parsePreToolUseInput(JSON.stringify({ tool_input: { command: 'gh pr create' } })), 'gh pr create');
  assert.equal(parsePreToolUseInput(JSON.stringify({ command: 'npm test' })), 'npm test');
  assert.equal(parsePreToolUseInput('not json'), '');
});

test('GUARD-S-010 guard config controls enablement, protected branches, and extra patterns', async () => {
  const repo = await makeRepo({ guardConfig: { enabled: false } });
  const disabled = await checkGuard(repo, { command: 'gh pr create' });
  assert.equal(disabled.decision, 'allow');
  assert.match(disabled.reason, /disabled/);

  const custom = await makeRepo({ guardConfig: { protected_branches: ['develop'], release_patterns: [{ id: 'custom_deploy', pattern: 'make\\s+release' }] } });
  const config = await readGuardConfig(custom);
  assert.equal(classifyReleaseSurface('git push origin develop', config).id, 'protected_branch_push');
  assert.equal(classifyReleaseSurface('git push origin main', config), null);
  assert.equal(classifyReleaseSurface('make release', config).id, 'custom_deploy');

  const status = await guardStatus(custom);
  assert.equal(status.enabled, true);
  assert.deepEqual(status.protected_branches, ['develop']);
  assert.equal(status.pre_push_hook, 'not_installed');
});
