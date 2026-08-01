import assert from 'node:assert/strict';
import { mkdir, mkdtemp, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { recordVerificationEvidence } from '../src/verification-evidence.js';

async function makeWorkspaceRepo() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vibepro-command-path-guard-'));
  await mkdir(path.join(root, '.vibepro'), { recursive: true });
  await writeFile(
    path.join(root, '.vibepro', 'vibepro-manifest.json'),
    JSON.stringify({ schema_version: '0.1.0', runs: [], latest_run_by_story: {} }, null, 2)
  );
  return root;
}

async function addTestFile(root, relPath) {
  const absolute = path.join(root, relPath);
  await mkdir(path.dirname(absolute), { recursive: true });
  await writeFile(absolute, "import test from 'node:test';\ntest('x', () => {});\n");
}

async function evidenceFileExists(root, storyId) {
  try {
    await stat(path.join(root, '.vibepro', 'pr', storyId, 'verification-evidence.json'));
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

test('node --testが実在しないtestファイルを名指しするpassing unit recordは_欠損パスを名指しして拒否される', async () => {
  const repo = await makeWorkspaceRepo();
  await addTestFile(repo, 'test/delivery-efficiency-guardrail.test.js');

  await assert.rejects(
    recordVerificationEvidence(repo, {
      storyId: 'story-a',
      kind: 'unit',
      status: 'pass',
      command: 'node --test test/delivery-efficiency-guardrail.test.js test/pr-manager.test.js'
    }),
    (error) => {
      assert.match(error.message, /test\/pr-manager\.test\.js/);
      assert.doesNotMatch(error.message, /delivery-efficiency-guardrail/);
      return true;
    }
  );
  assert.equal(await evidenceFileExists(repo, 'story-a'), false);
});

test('名指しされたtestファイルが全て実在するpassing unit recordは受理される', async () => {
  const repo = await makeWorkspaceRepo();
  await addTestFile(repo, 'test/delivery-efficiency-guardrail.test.js');

  const result = await recordVerificationEvidence(repo, {
    storyId: 'story-a',
    kind: 'unit',
    status: 'pass',
    command: 'node --test test/delivery-efficiency-guardrail.test.js'
  });
  assert.equal(result.evidence.commands[0].status, 'pass');
});

test('パスを名指ししないコマンドは従来どおり受理される', async () => {
  const repo = await makeWorkspaceRepo();

  const result = await recordVerificationEvidence(repo, {
    storyId: 'story-a',
    kind: 'unit',
    status: 'pass',
    command: 'npm test'
  });
  assert.equal(result.evidence.commands[0].status, 'pass');
});

test('globパターン引数は実在チェックの対象外として受理される', async () => {
  const repo = await makeWorkspaceRepo();

  const result = await recordVerificationEvidence(repo, {
    storyId: 'story-a',
    kind: 'unit',
    status: 'pass',
    command: 'node --test test/*.test.js'
  });
  assert.equal(result.evidence.commands[0].status, 'pass');
});

test('--test-name-patternの値はパスとして解決されない', async () => {
  const repo = await makeWorkspaceRepo();
  await addTestFile(repo, 'test/existing.test.js');

  const result = await recordVerificationEvidence(repo, {
    storyId: 'story-a',
    kind: 'unit',
    status: 'pass',
    command: 'node --test --test-name-pattern "pr-manager coverage" test/existing.test.js'
  });
  assert.equal(result.evidence.commands[0].status, 'pass');
});

test('npm test -- が実在しないtestパスを名指しする場合は拒否される', async () => {
  const repo = await makeWorkspaceRepo();

  await assert.rejects(
    recordVerificationEvidence(repo, {
      storyId: 'story-a',
      kind: 'unit',
      status: 'pass',
      command: 'npm test -- test/pr-manager.test.js'
    }),
    /test\/pr-manager\.test\.js/
  );
  assert.equal(await evidenceFileExists(repo, 'story-a'), false);
});

test('npx playwright testが実在しないspecを名指しするpassing e2e recordは拒否される', async () => {
  const repo = await makeWorkspaceRepo();

  await assert.rejects(
    recordVerificationEvidence(repo, {
      storyId: 'story-a',
      kind: 'e2e',
      status: 'pass',
      command: 'npx playwright test test/e2e/missing-flow.spec.ts'
    }),
    /test\/e2e\/missing-flow\.spec\.ts/
  );
  assert.equal(await evidenceFileExists(repo, 'story-a'), false);
});

test('npx vitestが実在しないtestファイルを名指しする場合は拒否される', async () => {
  const repo = await makeWorkspaceRepo();

  await assert.rejects(
    recordVerificationEvidence(repo, {
      storyId: 'story-a',
      kind: 'unit',
      status: 'pass',
      command: 'npx vitest run test/pr-manager.test.ts'
    }),
    /test\/pr-manager\.test\.ts/
  );
});

test('npx jestが実在しないtestファイルを名指しする場合は拒否される', async () => {
  const repo = await makeWorkspaceRepo();

  await assert.rejects(
    recordVerificationEvidence(repo, {
      storyId: 'story-a',
      kind: 'unit',
      status: 'pass',
      command: 'npx jest test/pr-manager.test.js'
    }),
    /test\/pr-manager\.test\.js/
  );
  assert.equal(await evidenceFileExists(repo, 'story-a'), false);
});

test('failing recordはコマンドのパス実在に関係なく従来どおり記録できる', async () => {
  const repo = await makeWorkspaceRepo();

  const result = await recordVerificationEvidence(repo, {
    storyId: 'story-a',
    kind: 'unit',
    status: 'fail',
    command: 'node --test test/pr-manager.test.js',
    summary: 'fails locally'
  });
  assert.equal(result.evidence.commands[0].status, 'fail');
});
