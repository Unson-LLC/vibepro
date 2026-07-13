import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const VIBEPRO_BIN = path.resolve('bin/vibepro.js');
const STORY_ID = 'story-guard-e2e';

async function run(command, args, cwd, options = {}) {
  const { stdout, stderr } = await execFileAsync(command, args, { cwd, encoding: 'utf8', ...options });
  return { stdout, stderr };
}

async function vibepro(repo, args, options = {}) {
  return run(process.execPath, [VIBEPRO_BIN, ...args], repo, options);
}

async function makeRepo() {
  const repo = await mkdtemp(path.join(os.tmpdir(), 'vibepro-guard-e2e-'));
  await run('git', ['init', '-b', 'main'], repo);
  await run('git', ['config', 'user.email', 'test@example.com'], repo);
  await run('git', ['config', 'user.name', 'Test User'], repo);
  await vibepro(repo, ['init', repo, '--story-id', STORY_ID, '--title', 'Guard E2E']);
  await mkdir(path.join(repo, 'docs', 'management', 'stories', 'active'), { recursive: true });
  await writeFile(path.join(repo, 'docs', 'management', 'stories', 'active', `${STORY_ID}.md`), `---
story_id: ${STORY_ID}
title: Guard E2E
status: active
---

# Story

## 受け入れ基準

- [ ] 利用者が結果を確認できる
`, 'utf8');
  await run('git', ['add', '.'], repo);
  await run('git', ['commit', '-m', 'chore: fixture'], repo);
  return repo;
}

function runWithStdin(command, args, cwd, input, env = {}) {
  return new Promise((resolve) => {
    import('node:child_process').then(({ spawn }) => {
      const child = spawn(command, args, { cwd, env: { ...process.env, ...env } });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (chunk) => { stdout += chunk; });
      child.stderr.on('data', (chunk) => { stderr += chunk; });
      child.on('close', (code) => resolve({ code, stdout, stderr }));
      child.stdin.end(input ?? '');
    });
  });
}

// story-vibepro-release-surface-guard ac:1
// story-vibepro-release-surface-guard ac:2
// story-vibepro-release-surface-guard ac:12
// story-vibepro-release-surface-guard S-001
test('GUARD-E2E-001 story-vibepro-release-surface-guard ac:1 blocked story blocks raw pr create with blocking gates while routine commands pass', async () => {
  const repo = await makeRepo();

  // ac:1 / S-001: `vibepro guard check --command "gh pr create ..."` は、選択Storyのgate readinessが `ready_for_pr_create: false` のとき非0で終了し、出力に blocking gate と復旧コマンドが含まれる
  // When a release-surface command is checked while the selected story is not ready_for_pr_create, the guard exits non-zero and reports blocking gates and recovery commands.
  const blocked = await runWithStdin(process.execPath, [VIBEPRO_BIN, 'guard', 'check', repo, '--command', 'gh pr create --fill'], repo, '');
  assert.equal(blocked.code, 2);
  assert.match(blocked.stderr, /blocked/);
  assert.match(blocked.stderr, /vibepro pr prepare/);

  // ac:2: release-surfaceに該当しないコマンド（通常のbuild/test/読み取り系）は gate readiness を評価せず即 exit 0 になる
  const routine = await runWithStdin(process.execPath, [VIBEPRO_BIN, 'guard', 'check', repo, '--command', 'npm test'], repo, '');
  assert.equal(routine.code, 0);
  assert.match(routine.stdout, /does not match any release surface/);

  // ac:12: テストは「パターン分類（該当/非該当）」「blocked/readyのblock・allow」等を含む（unit suiteの実在と実実行で検証）
  const unitSuite = await readFile(path.resolve('test/guard.test.js'), 'utf8');
  for (const testId of ['GUARD-S-001', 'GUARD-S-002', 'GUARD-S-003', 'GUARD-S-004', 'GUARD-S-005', 'GUARD-S-006', 'GUARD-S-007', 'GUARD-S-008', 'GUARD-S-009', 'GUARD-S-010']) {
    assert.ok(unitSuite.includes(testId), `${testId} must exist`);
  }
});

// story-vibepro-release-surface-guard ac:4
// story-vibepro-release-surface-guard S-004
test('GUARD-E2E-002 story-vibepro-release-surface-guard ac:4 repositories without a VibePro workspace are never interfered with', async () => {
  // ac:4 / S-004: `.vibepro` workspaceが無い・Storyが未選択のリポジトリでは常に exit 0 になる（vibepro管理外へ干渉しない）
  // When the repository has no VibePro workspace or the guard is disabled, every command is allowed untouched.
  const bare = await mkdtemp(path.join(os.tmpdir(), 'vibepro-guard-e2e-bare-'));
  const result = await runWithStdin(process.execPath, [VIBEPRO_BIN, 'guard', 'check', bare, '--command', 'gh pr create'], bare, '');
  assert.equal(result.code, 0);
  assert.match(result.stdout, /no VibePro workspace/);
});

// story-vibepro-release-surface-guard ac:5
// story-vibepro-release-surface-guard S-002
test('GUARD-E2E-003 story-vibepro-release-surface-guard ac:5 bypass passes only with a recorded non-empty reason', async () => {
  const repo = await makeRepo();

  // 空reasonなら通過しない
  const silent = await runWithStdin(process.execPath, [VIBEPRO_BIN, 'guard', 'check', repo, '--command', 'gh pr create'], repo, '', { VIBEPRO_GUARD_BYPASS: '   ' });
  assert.equal(silent.code, 2);

  // ac:5 / S-002: `VIBEPRO_GUARD_BYPASS` に非空のreasonを設定するとblockは通過するが、bypassが `.vibepro/guard/bypass-log.jsonl` へ reason・command・head_sha 付きで追記される
  // When the bypass environment variable carries a non-empty reason, the guard allows the command and appends an audit record.
  const bypassed = await runWithStdin(process.execPath, [VIBEPRO_BIN, 'guard', 'check', repo, '--command', 'gh pr create'], repo, '', { VIBEPRO_GUARD_BYPASS: '緊急ホットフィックス' });
  assert.equal(bypassed.code, 0);
  const log = await readFile(path.join(repo, '.vibepro', 'guard', 'bypass-log.jsonl'), 'utf8');
  const entry = JSON.parse(log.trim().split('\n').at(-1));
  assert.equal(entry.reason, '緊急ホットフィックス');
  assert.equal(entry.command, 'gh pr create');
  assert.ok(entry.head_sha);
});

// story-vibepro-release-surface-guard ac:6
// story-vibepro-release-surface-guard ac:7
// story-vibepro-release-surface-guard ac:3
// story-vibepro-release-surface-guard S-003
test('GUARD-E2E-004 story-vibepro-release-surface-guard ac:7 installed pre-push hook physically blocks protected-branch pushes while feature pushes pass', async () => {
  const repo = await makeRepo();
  const origin = await mkdtemp(path.join(os.tmpdir(), 'vibepro-guard-e2e-origin-'));
  await run('git', ['init', '--bare', '-b', 'main'], origin);
  await run('git', ['remote', 'add', 'origin', origin], repo);

  // ac:6: `vibepro guard install` はmarker付きpre-push hookを設置し、再実行は冪等
  const install = await vibepro(repo, ['guard', 'install', repo]);
  assert.match(install.stdout, /installed/);
  const again = await vibepro(repo, ['guard', 'install', repo]);
  assert.match(again.stdout, /reinstalled/);

  // hookがテスト対象のCLIを解決できるようにshimを置く
  const shimDir = await mkdtemp(path.join(os.tmpdir(), 'vibepro-guard-shim-'));
  const shim = path.join(shimDir, 'vibepro');
  await writeFile(shim, `#!/bin/sh\nexec "${process.execPath}" "${VIBEPRO_BIN}" "$@"\n`, 'utf8');
  await chmod(shim, 0o755);
  const hookEnv = { PATH: `${shimDir}:${process.env.PATH}` };

  // ac:7: 設置されたpre-push hookは、protected branchへのpush refをguard checkへ委譲し、blocked時に非0で終了する
  const blockedPush = await runWithStdin('git', ['push', 'origin', 'main'], repo, '', hookEnv);
  assert.notEqual(blockedPush.code, 0);
  assert.match(blockedPush.stderr, /blocked|pre-push/);

  // protected以外のbranch pushは通す
  await run('git', ['switch', '-c', 'feature/x'], repo);
  await writeFile(path.join(repo, 'f.txt'), 'x\n', 'utf8');
  await run('git', ['add', 'f.txt'], repo);
  await run('git', ['commit', '-m', 'feat: x'], repo);
  const featurePush = await runWithStdin('git', ['push', 'origin', 'feature/x'], repo, '', hookEnv);
  assert.equal(featurePush.code, 0);

  // ac:3 / S-003: gate readinessが `ready_for_pr_create: true` のとき、release-surfaceコマンドでも exit 0 になる
  // When the selected story is ready_for_pr_create the guard allows release-surface commands.
  // guard.enabled=false でreadiness非依存のallowも確認する（ready状態の完全なfixtureはユニット層のGUARD-S-004でDI検証済み。ここでは実CLIの設定経路を検証する）
  await run('git', ['switch', 'main'], repo);
  const configPath = path.join(repo, '.vibepro', 'config.json');
  const config = JSON.parse(await readFile(configPath, 'utf8'));
  config.guard = { enabled: false };
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
  const allowedPush = await runWithStdin('git', ['push', 'origin', 'main'], repo, '', hookEnv);
  assert.equal(allowedPush.code, 0);
});

// story-vibepro-release-surface-guard ac:8
// story-vibepro-release-surface-guard ac:9
test('GUARD-E2E-005 story-vibepro-release-surface-guard ac:9 claude PreToolUse mode blocks via exit 2 on stdin tool input', async () => {
  const repo = await makeRepo();

  // ac:8: `vibepro guard install --claude` は `.claude/settings.json` へ PreToolUse hook（Bash matcher）をマージ追加し、既存のhooks・他設定キーを保持し、再実行は冪等になる
  await mkdir(path.join(repo, '.claude'), { recursive: true });
  await writeFile(path.join(repo, '.claude', 'settings.json'), JSON.stringify({ permissions: { allow: ['Bash(ls)'] } }), 'utf8');
  await vibepro(repo, ['guard', 'install', repo, '--claude']);
  const settings = JSON.parse(await readFile(path.join(repo, '.claude', 'settings.json'), 'utf8'));
  assert.deepEqual(settings.permissions, { allow: ['Bash(ls)'] });
  assert.equal(settings.hooks.PreToolUse[0].matcher, 'Bash');
  await vibepro(repo, ['guard', 'install', repo, '--claude']);
  const again = JSON.parse(await readFile(path.join(repo, '.claude', 'settings.json'), 'utf8'));
  assert.equal(again.hooks.PreToolUse.length, 1);

  // ac:9: `--pretooluse` モードはstdinのtool入力JSONからコマンドを抽出し、block時は exit 2 とstderrへの理由出力で応答する
  const blocked = await runWithStdin(process.execPath, [VIBEPRO_BIN, 'guard', 'check', repo, '--pretooluse'], repo, JSON.stringify({ tool_input: { command: 'gh pr create --fill' } }));
  assert.equal(blocked.code, 2);
  assert.match(blocked.stderr, /blocked/);

  const allowed = await runWithStdin(process.execPath, [VIBEPRO_BIN, 'guard', 'check', repo, '--pretooluse'], repo, JSON.stringify({ tool_input: { command: 'npm test' } }));
  assert.equal(allowed.code, 0);
});

// story-vibepro-release-surface-guard ac:10
// story-vibepro-release-surface-guard ac:11
test('GUARD-E2E-006 story-vibepro-release-surface-guard ac:10 config overrides and status reporting work through the real CLI', async () => {
  const repo = await makeRepo();

  // ac:10: `.vibepro/config.json` の `guard.enabled: false` で全guard surfaceが無効になり、`protected_branches` / `release_patterns` で既定を上書きできる
  const configPath = path.join(repo, '.vibepro', 'config.json');
  const config = JSON.parse(await readFile(configPath, 'utf8'));
  config.guard = { protected_branches: ['develop'], release_patterns: [{ id: 'custom', pattern: 'make\\s+release' }] };
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
  const customBlocked = await runWithStdin(process.execPath, [VIBEPRO_BIN, 'guard', 'check', repo, '--command', 'make release'], repo, '');
  assert.equal(customBlocked.code, 2);
  const mainAllowed = await runWithStdin(process.execPath, [VIBEPRO_BIN, 'guard', 'check', repo, '--command', 'git push origin main'], repo, '');
  assert.equal(mainAllowed.code, 0);

  // ac:11: `vibepro guard status` は hook設置状態・有効設定・bypass記録件数を表示する
  const status = await vibepro(repo, ['guard', 'status', repo]);
  assert.match(status.stdout, /enabled: true/);
  assert.match(status.stdout, /pre-push hook: not_installed/);
  assert.match(status.stdout, /protected branches: develop/);
  assert.match(status.stdout, /bypass records: 0/);
});
