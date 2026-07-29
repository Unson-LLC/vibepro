import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { recordVerificationEvidence } from '../src/verification-evidence.js';

async function makeWorkspaceRepo() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vibepro-artifact-check-'));
  await mkdir(path.join(root, '.vibepro'), { recursive: true });
  await writeFile(
    path.join(root, '.vibepro', 'vibepro-manifest.json'),
    JSON.stringify({ schema_version: '0.1.0', runs: [], latest_run_by_story: {} }, null, 2)
  );
  return root;
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

function latestCommand(result) {
  return result.evidence.commands[0];
}

test('pass申告とvitest成功artifactが一致する場合_artifact_checkがverifiedで記録される', async () => {
  const repo = await makeWorkspaceRepo();
  await writeFile(path.join(repo, 'unit-results.json'), JSON.stringify({
    numTotalTests: 12,
    numFailedTests: 0,
    success: true
  }));

  const result = await recordVerificationEvidence(repo, {
    storyId: 'story-a',
    kind: 'unit',
    status: 'pass',
    command: 'npm test',
    artifact: 'unit-results.json'
  });

  const command = latestCommand(result);
  assert.equal(command.artifact_check.status, 'verified');
  assert.equal(command.artifact_check.format, 'vitest_jest');
  assert.equal(command.artifact_check.artifact_outcome, 'pass');
});

test('pass申告とvitest失敗artifactが矛盾する場合_エラーになり証跡は書き込まれない', async () => {
  const repo = await makeWorkspaceRepo();
  await writeFile(path.join(repo, 'unit-results.json'), JSON.stringify({
    numTotalTests: 12,
    numFailedTests: 2,
    success: false
  }));

  await assert.rejects(
    recordVerificationEvidence(repo, {
      storyId: 'story-a',
      kind: 'unit',
      status: 'pass',
      command: 'npm test',
      artifact: 'unit-results.json'
    }),
    /contradicts artifact/
  );
  assert.equal(await evidenceFileExists(repo, 'story-a'), false);
});

test('pass申告とPlaywright unexpected失敗artifactが矛盾する場合_エラーになる', async () => {
  const repo = await makeWorkspaceRepo();
  await writeFile(path.join(repo, 'e2e-results.json'), JSON.stringify({
    stats: { expected: 4, unexpected: 1, flaky: 0, skipped: 0 }
  }));

  await assert.rejects(
    recordVerificationEvidence(repo, {
      storyId: 'story-a',
      kind: 'e2e',
      status: 'pass',
      command: 'npx playwright test',
      artifact: 'e2e-results.json'
    }),
    /contradicts artifact/
  );
  assert.equal(await evidenceFileExists(repo, 'story-a'), false);
});

test('artifact指定のファイルが存在しない場合_エラーになり証跡は書き込まれない', async () => {
  const repo = await makeWorkspaceRepo();

  await assert.rejects(
    recordVerificationEvidence(repo, {
      storyId: 'story-a',
      kind: 'unit',
      status: 'pass',
      command: 'npm test',
      artifact: 'missing-results.json'
    }),
    /artifact not found/
  );
  assert.equal(await evidenceFileExists(repo, 'story-a'), false);
});

test('未知の形式のartifactの場合_unrecognizedとして記録されブロックしない', async () => {
  const repo = await makeWorkspaceRepo();
  await writeFile(path.join(repo, 'custom-output.json'), JSON.stringify({
    something: 'else'
  }));

  const result = await recordVerificationEvidence(repo, {
    storyId: 'story-a',
    kind: 'unit',
    status: 'pass',
    command: 'npm test',
    artifact: 'custom-output.json'
  });

  const command = latestCommand(result);
  assert.equal(command.artifact_check.status, 'unrecognized');
  assert.equal(command.artifact_check.artifact_outcome, null);
});

test('JSONでないartifactの場合_unrecognizedとして記録されブロックしない', async () => {
  const repo = await makeWorkspaceRepo();
  await writeFile(path.join(repo, 'test-log.txt'), 'all 12 tests passed');

  const result = await recordVerificationEvidence(repo, {
    storyId: 'story-a',
    kind: 'unit',
    status: 'pass',
    command: 'npm test',
    artifact: 'test-log.txt'
  });

  const command = latestCommand(result);
  assert.equal(command.artifact_check.status, 'unrecognized');
});

test('TAPのplanとsummaryが一致する成功artifactは_verifiedとして記録される', async () => {
  const repo = await makeWorkspaceRepo();
  await writeFile(path.join(repo, 'tap-results.txt'), [
    'TAP version 13',
    'ok 1 - first',
    'ok 2 - second',
    '1..2',
    '# tests 2',
    '# pass 2',
    '# fail 0',
    ''
  ].join('\n'));

  const result = await recordVerificationEvidence(repo, {
    storyId: 'story-a', kind: 'unit', status: 'pass', command: 'node --test', artifact: 'tap-results.txt'
  });

  const command = latestCommand(result);
  assert.equal(command.artifact_check.status, 'verified');
  assert.equal(command.artifact_check.format, 'tap');
  assert.equal(command.observation.values.tests, '2');
});

test('TAPのnot okはpass申告と矛盾する', async () => {
  const repo = await makeWorkspaceRepo();
  await writeFile(path.join(repo, 'tap-results.txt'), [
    'TAP version 13',
    'not ok 1 - failed',
    '1..1',
    '# tests 1',
    '# pass 0',
    '# fail 1',
    ''
  ].join('\n'));

  await assert.rejects(
    recordVerificationEvidence(repo, {
      storyId: 'story-a', kind: 'unit', status: 'pass', command: 'node --test', artifact: 'tap-results.txt'
    }),
    /contradicts artifact/
  );
});

test('malformed TAPは推測せず_unrecognizedとして記録される', async () => {
  const repo = await makeWorkspaceRepo();
  await writeFile(path.join(repo, 'tap-results.txt'), 'TAP version 13\nok 1 - missing plan\n');

  const result = await recordVerificationEvidence(repo, {
    storyId: 'story-a', kind: 'unit', status: 'pass', command: 'node --test test/example.test.js', artifact: 'tap-results.txt'
  });

  assert.equal(latestCommand(result).artifact_check.status, 'unrecognized');
});

test('pass申告でartifact未指定の場合_artifact_checkがmissingとして記録される', async () => {
  const repo = await makeWorkspaceRepo();

  const result = await recordVerificationEvidence(repo, {
    storyId: 'story-a',
    kind: 'unit',
    status: 'pass',
    command: 'npm test'
  });

  const command = latestCommand(result);
  assert.equal(command.artifact_check.status, 'missing');
});

test('integration passはgit diffのようなinspection-only commandを拒否する', async () => {
  const repo = await makeWorkspaceRepo();

  await assert.rejects(
    recordVerificationEvidence(repo, {
      storyId: 'story-a',
      kind: 'integration',
      status: 'pass',
      command: 'git diff --name-only origin/main...HEAD'
    }),
    /inspection-only or arbitrary command is not valid passing evidence/
  );
  assert.equal(await evidenceFileExists(repo, 'story-a'), false);
});

test('integration passはtrueやechoの任意commandを拒否する', async () => {
  const repo = await makeWorkspaceRepo();
  for (const command of ['true', 'echo passed']) {
    await assert.rejects(recordVerificationEvidence(repo, {
      storyId: 'story-a', kind: 'integration', status: 'pass', command
    }), /arbitrary command is not valid passing evidence/);
  }
});

test('unit e2e typecheck passも任意commandを拒否する', async () => {
  const repo = await makeWorkspaceRepo();
  for (const kind of ['unit', 'e2e', 'typecheck']) {
    await assert.rejects(
      recordVerificationEvidence(repo, {
        storyId: 'story-test', kind, status: 'pass', command: 'echo passed'
      }),
      new RegExp(`recognized executable ${kind} check`)
    );
  }
});

test('build passは名前空間付きpackage scriptを実行可能なbuild checkとして受理する', async () => {
  const repo = await makeWorkspaceRepo();
  const result = await recordVerificationEvidence(repo, {
    storyId: 'story-docs-build',
    kind: 'build',
    status: 'pass',
    command: 'npm run docs:build'
  });

  assert.equal(latestCommand(result).command, 'npm run docs:build');
  assert.equal(latestCommand(result).status, 'pass');
});

test('passing evidenceはrecognized prefix後のshell control operatorを拒否する', async () => {
  const repo = await makeWorkspaceRepo();
  for (const command of [
    'node --test test/unit.test.js; echo forged',
    'npm test && true',
    'npx playwright test | tee result.log',
    'npm run integration > result.log'
  ]) {
    await assert.rejects(
      recordVerificationEvidence(repo, {
        storyId: 'story-shell-injection', kind: 'unit', status: 'pass', command
      }),
      /single executable command/
    );
  }
});

test('passing evidenceはverification kindと異なるscriptを拒否する', async () => {
  const repo = await makeWorkspaceRepo();
  await assert.rejects(recordVerificationEvidence(repo, {
    storyId: 'story-kind-mismatch', kind: 'e2e', status: 'pass', command: 'npm test'
  }), /recognized executable e2e check/);
  await assert.rejects(recordVerificationEvidence(repo, {
    storyId: 'story-kind-mismatch', kind: 'integration', status: 'pass', command: 'npm run unit'
  }), /recognized executable integration check/);
  await assert.rejects(recordVerificationEvidence(repo, {
    storyId: 'story-kind-mismatch',
    kind: 'unit',
    status: 'pass',
    command: 'node --test --test-force-exit test/e2e/story-main.spec.ts'
  }), /recognized executable unit check/);
  await assert.rejects(recordVerificationEvidence(repo, {
    storyId: 'story-kind-mismatch',
    kind: 'unit',
    status: 'pass',
    command: 'node --test test/integration/runtime.test.js'
  }), /recognized executable unit check/);
});

test('integration passは実行可能なintegration test commandを受理する', async () => {
  const repo = await makeWorkspaceRepo();

  const result = await recordVerificationEvidence(repo, {
    storyId: 'story-a',
    kind: 'integration',
    status: 'pass',
    command: 'node --test test/integration/runtime.test.js'
  });

  assert.equal(latestCommand(result).command, 'node --test test/integration/runtime.test.js');
});

test('fail申告と失敗artifactが一致する場合_verifiedとして記録される', async () => {
  const repo = await makeWorkspaceRepo();
  await writeFile(path.join(repo, 'unit-results.json'), JSON.stringify({
    numTotalTests: 12,
    numFailedTests: 3,
    success: false
  }));

  const result = await recordVerificationEvidence(repo, {
    storyId: 'story-a',
    kind: 'unit',
    status: 'fail',
    command: 'npm test',
    artifact: 'unit-results.json'
  });

  const command = latestCommand(result);
  assert.equal(command.artifact_check.status, 'verified');
  assert.equal(command.artifact_check.artifact_outcome, 'fail');
});

test('fail申告と成功artifactの不一致は_contradictedとして記録されブロックしない', async () => {
  const repo = await makeWorkspaceRepo();
  await writeFile(path.join(repo, 'unit-results.json'), JSON.stringify({
    numTotalTests: 12,
    numFailedTests: 0,
    success: true
  }));

  const result = await recordVerificationEvidence(repo, {
    storyId: 'story-a',
    kind: 'unit',
    status: 'fail',
    command: 'npm test',
    artifact: 'unit-results.json'
  });

  const command = latestCommand(result);
  assert.equal(command.artifact_check.status, 'contradicted');
  assert.equal(command.artifact_check.artifact_outcome, 'pass');
});

test('generic status JSONのpass一致は_verifiedとして記録される', async () => {
  const repo = await makeWorkspaceRepo();
  await writeFile(path.join(repo, 'typecheck.json'), JSON.stringify({ status: 'pass' }));

  const result = await recordVerificationEvidence(repo, {
    storyId: 'story-a',
    kind: 'typecheck',
    status: 'pass',
    command: 'npm run typecheck',
    artifact: 'typecheck.json'
  });

  const command = latestCommand(result);
  assert.equal(command.artifact_check.status, 'verified');
  assert.equal(command.artifact_check.format, 'generic_status');
});

test('needs_setup申告にartifactがある場合_not_applicableとして記録されブロックしない', async () => {
  const repo = await makeWorkspaceRepo();
  await writeFile(path.join(repo, 'setup-log.json'), JSON.stringify({ status: 'pass' }));

  const result = await recordVerificationEvidence(repo, {
    storyId: 'story-a',
    kind: 'e2e',
    status: 'needs_setup',
    command: 'npx playwright test',
    artifact: 'setup-log.json'
  });

  const command = latestCommand(result);
  assert.equal(command.artifact_check.status, 'not_applicable');
});

test('既存の証跡JSONとの互換_artifact_checkのない旧commandを保持したまま追記できる', async () => {
  const repo = await makeWorkspaceRepo();
  const prDir = path.join(repo, '.vibepro', 'pr', 'story-a');
  await mkdir(prDir, { recursive: true });
  await writeFile(path.join(prDir, 'verification-evidence.json'), JSON.stringify({
    schema_version: '0.1.0',
    story_id: 'story-a',
    warnings: [],
    commands: [{
      kind: 'build',
      status: 'pass',
      command: 'npm run build',
      summary: 'pass',
      artifact: null,
      executed_at: '2026-06-01T00:00:00.000Z'
    }]
  }, null, 2));

  const result = await recordVerificationEvidence(repo, {
    storyId: 'story-a',
    kind: 'unit',
    status: 'pass',
    command: 'npm test'
  });

  assert.equal(result.evidence.commands.length, 2);
  const stored = JSON.parse(await readFile(path.join(prDir, 'verification-evidence.json'), 'utf8'));
  const buildCommand = stored.commands.find((item) => item.kind === 'build');
  assert.equal(buildCommand.status, 'pass');
});
