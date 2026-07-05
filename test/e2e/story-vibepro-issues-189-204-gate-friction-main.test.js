import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

import { runCli } from '../../src/cli.js';
import { preparePullRequest } from '../../src/pr-manager.js';

const execFileAsync = promisify(execFile);
const STORY_ID = 'story-vibepro-issues-189-204-gate-friction';

async function git(repo, args) {
  return execFileAsync('git', args, { cwd: repo, encoding: 'utf8' });
}

async function makeStoryRepo(storyId = 'story-pr-prepare') {
  const repo = await mkdtemp(path.join(os.tmpdir(), 'vibepro-story-189-204-'));
  await writeFile(path.join(repo, 'index.html'), '<!doctype html><title>VibePro test</title>');
  await git(repo, ['init', '-b', 'main']);
  await git(repo, ['config', 'user.email', 'vibepro@example.com']);
  await git(repo, ['config', 'user.name', 'VibePro Test']);
  const init = await runCli([
    'init',
    repo,
    '--story-id',
    storyId,
    '--title',
    'PR準備',
    '--view',
    'dev',
    '--period',
    '2026-W18'
  ]);
  assert.equal(init.exitCode, 0);
  await git(repo, ['add', '.']);
  await git(repo, ['commit', '-m', 'chore: init test repo']);
  await git(repo, ['switch', '-c', 'feature/test-story']);
  return repo;
}

function gateById(preparation, id) {
  const currentPreparation = preparation.preparation ?? preparation;
  return currentPreparation.pr_context.gate_dag.nodes.find((node) => node.id === id);
}

test('story-vibepro-issues-189-204-gate-friction replays merge-delta review binding behavior', async () => {
  const repo = await makeStoryRepo();
  await mkdir(path.join(repo, 'src'), { recursive: true });
  await mkdir(path.join(repo, 'docs'), { recursive: true });
  await writeFile(path.join(repo, 'src', 'merge-delta-target.js'), 'export const value = 1;\n');
  await git(repo, ['add', 'src/merge-delta-target.js']);
  await git(repo, ['commit', '-m', 'feat: add reviewed merge delta target']);

  assert.equal((await runCli(['review', 'prepare', repo, '--id', 'story-pr-prepare', '--stage', 'implementation'])).exitCode, 0);
  assert.equal((await runCli([
    'review',
    'record',
    repo,
    '--id',
    'story-pr-prepare',
    '--stage',
    'implementation',
    '--role',
    'runtime_contract',
    '--status',
    'pass',
    '--summary',
    'runtime contract reviewed before base sync',
    '--inspection-summary',
    'inspected runtime source before base sync',
    '--inspection-input',
    'src/merge-delta-target.js',
    '--agent-system',
    'codex',
    '--execution-mode',
    'parallel_subagent',
    '--agent-id',
    'story-189-204-merge-delta-agent',
    '--agent-thread-id',
    'thread-story-189-204-merge-delta-agent',
    '--agent-model',
    'gpt-5.5',
    '--judgment-delta',
    'recorded head review -> reused only if merge delta leaves inspected source untouched',
    '--agent-closed'
  ])).exitCode, 0);

  await writeFile(path.join(repo, 'docs', 'base-sync-note.md'), 'unrelated base sync note\n');
  await git(repo, ['add', 'docs/base-sync-note.md']);
  await git(repo, ['commit', '-m', 'chore: sync unrelated base docs']);

  const reused = await runCli(['review', 'status', repo, '--id', 'story-pr-prepare', '--stage', 'implementation', '--json']);
  assert.equal(reused.exitCode, 0);
  const reusedRole = reused.result.stages[0].roles.find((item) => item.role === 'runtime_contract');
  const ac1 = 'Content-bound review evidence remains current when current HEAD changes only files outside recorded `inspection.inputs`.';
  const ac1Marker = `${STORY_ID} ac:1`;
  const scenario1 = 'Given a passing review inspected src/runtime.js, when current HEAD only adds docs/base-sync.md, then the role remains passing with binding_status=current.';
  const scenario1Marker = `${STORY_ID} scenario:1`;
  assert.equal(reusedRole.binding_status, 'current', `${ac1Marker} ${ac1} ${scenario1Marker} ${scenario1}`);
  assert.equal(reusedRole.effective_status, 'pass', `${scenario1Marker} ${scenario1}`);

  await writeFile(path.join(repo, 'src', 'merge-delta-target.js'), 'export const value = 2;\n');
  await git(repo, ['add', 'src/merge-delta-target.js']);
  await git(repo, ['commit', '-m', 'chore: sync touched reviewed source']);

  const stale = await runCli(['review', 'status', repo, '--id', 'story-pr-prepare', '--stage', 'implementation', '--json']);
  assert.equal(stale.exitCode, 0);
  const staleRole = stale.result.stages[0].roles.find((item) => item.role === 'runtime_contract');
  const ac2 = 'Review evidence remains stale when content binding detects a recorded inspected file changed.';
  const ac2Marker = `${STORY_ID} ac:2`;
  const scenario2 = 'Given the same review, when current HEAD changes src/runtime.js, then the role remains stale and names the touched reviewed file.';
  const scenario2Marker = `${STORY_ID} scenario:2`;
  assert.equal(staleRole.binding_status, 'stale', `${ac2Marker} ${ac2} ${scenario2Marker} ${scenario2}`);
  assert.match(staleRole.stale_reason, /content-bound evidence surface changed/, `${ac2Marker} ${ac2}`);
  assert.deepEqual(staleRole.content_binding.changed_files, ['src/merge-delta-target.js'], `${scenario2Marker} ${scenario2}`);
});

test('story-vibepro-issues-189-204-gate-friction replays AC diagnostics and multiline local binding coverage', async () => {
  const repo = await makeStoryRepo();
  await mkdir(path.join(repo, 'docs', 'management', 'stories', 'active'), { recursive: true });
  await mkdir(path.join(repo, 'src', 'app'), { recursive: true });
  await mkdir(path.join(repo, 'tests', 'e2e'), { recursive: true });
  await writeFile(path.join(repo, 'docs', 'management', 'stories', 'active', 'story-pr-prepare.md'), `---
story_id: story-pr-prepare
title: PR準備
---

# PR準備

## 受け入れ基準

- [ ] ユーザーが保存ボタンを押すと完了画面へ遷移し、操作結果の通知が画面上に残る
`);
  await writeFile(path.join(repo, 'src', 'app', 'page.tsx'), 'export default function Page() { return <button>Save</button>; }\n');
  await writeFile(path.join(repo, 'tests', 'e2e', 'story-pr-prepare-diagnostics.spec.ts'), `
import { expect, test } from '@playwright/test';

test('candidate block with criterion text but no AC marker', async () => {
  const criteria = [
    'ユーザーが保存ボタンを押すと完了画面へ遷移し、操作結果の通知が画面上に残る',
  ];
  await expect(
    criteria[0],
  ).toContain('保存ボタン');
});
`);
  await git(repo, ['add', 'docs/management/stories/active/story-pr-prepare.md', 'src/app/page.tsx', 'tests/e2e/story-pr-prepare-diagnostics.spec.ts']);
  await git(repo, ['commit', '-m', 'feat: add story e2e diagnostic candidate']);

  assert.equal((await runCli([
    'verify',
    'record',
    repo,
    '--id',
    'story-pr-prepare',
    '--kind',
    'e2e',
    '--status',
    'pass',
    '--command',
    'npm run test:e2e tests/e2e/story-pr-prepare-diagnostics.spec.ts',
    '--summary',
    'E2E command passed with candidate diagnostic fixture'
  ])).exitCode, 0);

  const missing = await preparePullRequest(repo, { base: 'main', storyId: 'story-pr-prepare' });
  const missingGate = gateById(missing, 'gate:e2e');
  const missingDiagnostic = missingGate.acceptance_e2e_coverage.coverage_diagnostics.missing_acceptance_criteria[0];
  const ac3 = 'Missing Story E2E AC coverage reports the AC id/text, inspected E2E file, candidate test block, and the reason the block did not count.';
  const ac3Marker = `${STORY_ID} ac:3`;
  const scenario3 = 'Given a matching E2E file contains a candidate test block with AC text but no AC marker, when `pr prepare` runs, then the E2E gate stays `needs_evidence` and diagnostics explain the missing marker.';
  const scenario3Marker = `${STORY_ID} scenario:3`;
  assert.equal(
    missingGate.acceptance_e2e_coverage.status,
    'needs_evidence',
    'story-vibepro-issues-189-204-gate-friction ac:3 Missing Story E2E AC coverage reports the AC id/text, inspected E2E file, candidate test block, and the reason the block did not count. story-vibepro-issues-189-204-gate-friction scenario:3 Given a matching E2E file contains a candidate test block with AC text but no AC marker, when `pr prepare` runs, then the E2E gate stays `needs_evidence` and diagnostics explain the missing marker.'
  );
  assert.equal(missingDiagnostic.candidate_diagnostics[0].path, 'tests/e2e/story-pr-prepare-diagnostics.spec.ts', `${ac3Marker} ${ac3}`);
  assert.equal(missingDiagnostic.candidate_diagnostics[0].blocks[0].test_name, 'candidate block with criterion text but no AC marker', `${ac3Marker} ${ac3}`);
  assert.match(
    missingDiagnostic.candidate_diagnostics[0].blocks[0].reasons[0],
    /missing AC marker/,
    'story-vibepro-issues-189-204-gate-friction scenario:3 Given a matching E2E file contains a candidate test block with AC text but no AC marker, when `pr prepare` runs, then the E2E gate stays `needs_evidence` and diagnostics explain the missing marker.'
  );

  await writeFile(path.join(repo, 'tests', 'e2e', 'story-pr-prepare-diagnostics.spec.ts'), `
import { expect, test } from '@playwright/test';

test('story-pr-prepare ac:1 multiline local binding assertion', async () => {
  const criteria = [
    'ユーザーが保存ボタンを押すと完了画面へ遷移し、操作結果の通知が画面上に残る',
  ];
  const markers = [
    'story-pr-prepare ac:1',
  ];
  await expect(
    criteria[0],
    markers[0],
  ).toContain('保存ボタン');
});
`);
  await git(repo, ['add', 'tests/e2e/story-pr-prepare-diagnostics.spec.ts']);
  await git(repo, ['commit', '-m', 'test: add multiline local binding AC marker']);

  assert.equal((await runCli([
    'verify',
    'record',
    repo,
    '--id',
    'story-pr-prepare',
    '--kind',
    'e2e',
    '--status',
    'pass',
    '--command',
    'npm run test:e2e tests/e2e/story-pr-prepare-diagnostics.spec.ts',
    '--summary',
    'E2E command passed with multiline local binding AC coverage'
  ])).exitCode, 0);

  const covered = await preparePullRequest(repo, { base: 'main', storyId: 'story-pr-prepare' });
  const coveredGate = gateById(covered, 'gate:e2e');
  const ac4 = 'Multiline `expect(...)` assertions can satisfy AC coverage when the assertion references a local static string/array binding containing the AC text and a local marker such as `story-id ac:1`.';
  const ac4Marker = `${STORY_ID} ac:4`;
  const scenario4 = 'Given a matching E2E file contains multiline `expect(...)` that references `criteria[0]` and `markers[0]`, when both local arrays are static string arrays, then the AC is covered.';
  const scenario4Marker = `${STORY_ID} scenario:4`;
  assert.equal(
    coveredGate.acceptance_e2e_coverage.status,
    'passed',
    'story-vibepro-issues-189-204-gate-friction ac:4 Multiline `expect(...)` assertions can satisfy AC coverage when the assertion references a local static string/array binding containing the AC text and a local marker such as `story-id ac:1`. story-vibepro-issues-189-204-gate-friction scenario:4 Given a matching E2E file contains multiline `expect(...)` that references `criteria[0]` and `markers[0]`, when both local arrays are static string arrays, then the AC is covered.'
  );
  assert.deepEqual(coveredGate.acceptance_e2e_coverage.covered_acceptance_criteria[0].files, [
    'tests/e2e/story-pr-prepare-diagnostics.spec.ts'
  ], 'story-vibepro-issues-189-204-gate-friction scenario:4 Given a matching E2E file contains multiline `expect(...)` that references `criteria[0]` and `markers[0]`, when both local arrays are static string arrays, then the AC is covered.');

  const ac5 = 'The detector still rejects candidate blocks that contain AC text but no executable AC marker, and it suggests explicit executable coverage markers instead of no-op scanner assertions.';
  const ac5Marker = `${STORY_ID} ac:5`;
  assert.match(missingDiagnostic.guidance, /explicit AC marker near an executable assertion/, `${ac5Marker} ${ac5}`);
});
