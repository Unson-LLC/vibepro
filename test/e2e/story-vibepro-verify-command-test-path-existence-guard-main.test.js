import assert from 'node:assert/strict';
import { access, mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { runCli } from '../../src/cli.js';

const STORY_ID = 'story-vibepro-verify-command-test-path-existence-guard';

async function makeWorkspaceRepo() {
  const repo = await mkdtemp(path.join(os.tmpdir(), 'vibepro-path-guard-e2e-'));
  await mkdir(path.join(repo, '.vibepro'), { recursive: true });
  await writeFile(
    path.join(repo, '.vibepro', 'vibepro-manifest.json'),
    JSON.stringify({ schema_version: '0.1.0', runs: [], latest_run_by_story: {} }, null, 2)
  );
  await mkdir(path.join(repo, 'test'), { recursive: true });
  await writeFile(
    path.join(repo, 'test', 'delivery-efficiency-guardrail.test.js'),
    "import test from 'node:test';\ntest('x', () => {});\n"
  );
  return repo;
}

async function fileExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function verifyRecord(repo, command, { kind = 'unit', status = 'pass' } = {}) {
  let stderr = '';
  const result = await runCli([
    'verify', 'record', repo, '--id', STORY_ID, '--kind', kind, '--status', status,
    '--command', command, '--json'
  ], { stderr: { write(chunk) { stderr += chunk; } } });
  return { ...result, stderr: `${result.stderr ?? ''}${stderr}` };
}

test(`${STORY_ID} replays the incident and exercises AC-1 through AC-6`, async () => {
  const repo = await makeWorkspaceRepo();
  const evidencePath = path.join(repo, '.vibepro', 'pr', STORY_ID, 'verification-evidence.json');

  // ${STORY_ID} ac:1
  // 実在しないtestパスを名指しするpassing recordは拒否され、欠損パスがエラーに列挙される
  const incident = await verifyRecord(
    repo,
    'node --test test/delivery-efficiency-guardrail.test.js test/pr-manager.test.js'
  );
  assert.notEqual(incident.exitCode, 0);
  assert.match(incident.stderr, /test\/pr-manager\.test\.js/);
  assert.doesNotMatch(incident.stderr, /delivery-efficiency-guardrail\.test\.js.*does not exist/);

  // story-vibepro-verify-command-test-path-existence-guard ac:2
  // 拒否時、verification-evidence.json は書き込まれない
  assert.equal(await fileExists(evidencePath), false);

  // story-vibepro-verify-command-test-path-existence-guard ac:3
  // ガードは決定的: ランナー出力のパースではなく、ファイル実在の判定文言で拒否される
  assert.match(incident.stderr, /test paths that do not exist in the repository/);

  // story-vibepro-verify-command-test-path-existence-guard ac:4
  // npm test -- / npx playwright / npx vitest の明示ファイル引数も対象になる
  const npmForm = await verifyRecord(repo, 'npm test -- test/pr-manager.test.js');
  assert.notEqual(npmForm.exitCode, 0);
  assert.match(npmForm.stderr, /test\/pr-manager\.test\.js/);
  const playwrightForm = await verifyRecord(repo, 'npx playwright test test/e2e/missing-flow.spec.ts', { kind: 'e2e' });
  assert.notEqual(playwrightForm.exitCode, 0);
  assert.match(playwrightForm.stderr, /test\/e2e\/missing-flow\.spec\.ts/);
  const vitestForm = await verifyRecord(repo, 'npx vitest run test/pr-manager.test.ts');
  assert.notEqual(vitestForm.exitCode, 0);
  assert.match(vitestForm.stderr, /test\/pr-manager\.test\.ts/);

  // story-vibepro-verify-command-test-path-existence-guard ac:5
  // glob・--test-name-pattern値・パスを名指ししないコマンド・failing recordは従来どおり受理される
  const glob = await verifyRecord(repo, 'node --test test/*.test.js');
  assert.equal(glob.exitCode, 0, glob.stderr);
  const namePattern = await verifyRecord(repo, 'node --test --test-name-pattern "pr-manager coverage" test/delivery-efficiency-guardrail.test.js');
  assert.equal(namePattern.exitCode, 0, namePattern.stderr);
  const noPath = await verifyRecord(repo, 'npm test');
  assert.equal(noPath.exitCode, 0, noPath.stderr);
  const failing = await verifyRecord(repo, 'node --test test/pr-manager.test.js', { status: 'fail' });
  assert.equal(failing.exitCode, 0, failing.stderr);

  // story-vibepro-verify-command-test-path-existence-guard ac:6
  // 実在するtestパスを名指しするpassing recordは受理され、証跡が書き込まれる
  const accepted = await verifyRecord(repo, 'node --test test/delivery-efficiency-guardrail.test.js');
  assert.equal(accepted.exitCode, 0, accepted.stderr);
  assert.equal(await fileExists(evidencePath), true);
});
