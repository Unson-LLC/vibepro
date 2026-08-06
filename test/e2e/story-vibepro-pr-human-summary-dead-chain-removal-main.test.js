import './../support/scratch-tmpdir.js';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { promisify } from 'node:util';

import * as prManager from '../../src/pr-manager.js';
import { runCli } from '../../src/cli.js';

const execFileAsync = promisify(execFile);

const STORY_ID = 'story-vibepro-pr-human-summary-dead-chain-removal';

const REMOVED_FUNCTIONS = [
  'renderPrDecisionSection',
  'buildHumanMergeDecision',
  'buildHumanReviewQuestion',
  'formatPrRouteForHuman',
  'formatEngineeringJudgmentForHuman',
  'renderEngineeringJudgmentReasoning',
  'collectEngineeringJudgmentRouteGates',
  'buildJudgmentAxisReasoning',
  'buildCommonSpineReasoning',
  'formatEvidenceArtifactSuffix',
  'formatEngineeringJudgmentGateForHuman',
  'describeEngineeringJudgmentGate',
  'buildEngineeringSignalDigest',
  'describeEngineeringSignal',
  'buildEngineeringEvidenceReasoningDigest',
  'buildEngineeringMergeBoundary',
  'renderHumanDecisionGraph',
  'buildHumanDecisionFileLinks',
  'formatGithubFileLink',
  'githubRepositoryUrl',
  'encodePathForGithub',
  'buildHumanChangeIntent',
  'buildHumanEvidenceDigest',
  'renderPrGateSummary'
];

const KEPT_SHARED_HELPERS = [
  'collectSuppressedJudgmentAxes',
  'buildHumanSplitDigest',
  'formatHumanGateSummary',
  'summarizePrGateReason',
  'isUnresolvedGateStatus',
  'collectContractDocFiles',
  'collectCapabilityFiles',
  'buildPrimaryReviewAreas',
  'formatPrStoryLabel',
  'buildScopeDecisionNote',
  'summarizeBlockerWaiverMissingFields'
];

async function readPrManagerSource() {
  const sourcePath = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'src', 'pr-manager.js');
  return readFile(sourcePath, 'utf8');
}

async function git(repo, args) {
  return execFileAsync('git', args, { cwd: repo, encoding: 'utf8' });
}

// story-vibepro-pr-human-summary-dead-chain-removal ac:1 no dead-chain definition, reference, or export remains in src/pr-manager.js
test(`${STORY_ID} removes every dead-chain function and its exports from src/pr-manager.js (ac:1)`, async () => {
  // story-vibepro-pr-human-summary-dead-chain-removal PS-001 ac:1
  // Given the dead human-summary chain rooted at renderPrDecisionSection and renderPrGateSummary,
  // when src/pr-manager.js is inspected, then no definition or reference to any chain function
  // remains, and the two formerly exported surfaces are no longer module exports.
  const source = await readPrManagerSource();
  for (const name of REMOVED_FUNCTIONS) {
    assert.doesNotMatch(source, new RegExp(`\\b${name}\\b`), `${name} must not remain in src/pr-manager.js (ac:1)`);
  }
  assert.equal(prManager.renderPrGateSummary, undefined, 'renderPrGateSummary must not be exported (ac:1)');
  assert.equal(prManager.buildHumanEvidenceDigest, undefined, 'buildHumanEvidenceDigest must not be exported (ac:1)');
});

// story-vibepro-pr-human-summary-dead-chain-removal ac:2 shared helpers with live callers keep their definitions
test(`${STORY_ID} keeps every shared helper that has live callers outside the chain (ac:2)`, async () => {
  // story-vibepro-pr-human-summary-dead-chain-removal PS-002 ac:2
  // Given shared helpers that have live callers outside the dead chain, when the chain is removed,
  // then each shared helper definition still exists in src/pr-manager.js.
  const source = await readPrManagerSource();
  for (const name of KEPT_SHARED_HELPERS) {
    assert.match(source, new RegExp(`function ${name}\\(`), `${name} must keep its definition (ac:2)`);
  }
});

// story-vibepro-pr-human-summary-dead-chain-removal ac:3 the concise pr-body contract is unchanged after the removal
test(`${STORY_ID} keeps the concise pr-body contract intact when pr prepare renders a real repository (ac:3)`, async () => {
  // story-vibepro-pr-human-summary-dead-chain-removal PS-003 ac:3
  // Given a real fixture repository with a story and a source change, when pr prepare renders
  // pr-body.md through the live renderPrBody path, then the concise body contract holds: the
  // section order 判断→経緯→原因→解決→レビュー観点→確認→詳細 is preserved, the banned strings
  // (Engineering Judgment:, the judgment spine narrative, suppressed-axis detail) do not appear,
  // and the body stays under the 20KB ceiling.
  const repo = await mkdtemp(path.join(os.tmpdir(), 'vibepro-dead-chain-body-'));
  await git(repo, ['init', '-b', 'main']);
  await git(repo, ['config', 'user.email', 'vibepro@example.com']);
  await git(repo, ['config', 'user.name', 'VibePro Test']);
  await runCli(['init', repo, '--story-id', 'story-body-contract', '--title', 'Concise body contract fixture', '--view', 'dev', '--period', '2026-08']);
  await git(repo, ['add', '.']);
  await git(repo, ['commit', '-m', 'chore: init story repo']);
  await git(repo, ['switch', '-c', 'feature/body-contract']);
  await mkdir(path.join(repo, 'docs', 'management', 'stories', 'active'), { recursive: true });
  await mkdir(path.join(repo, 'src'), { recursive: true });
  await writeFile(path.join(repo, 'docs', 'management', 'stories', 'active', 'story-body-contract.md'), `---
story_id: story-body-contract
title: Concise body contract fixture
---

# Story

## 背景

Fixture change for rendering a concise PR body.

## 受け入れ基準

- [ ] fixture renders a concise body
`);
  await writeFile(path.join(repo, 'src', 'fixture.js'), 'export function fixture() { return 1; }\n');
  await git(repo, ['add', '.']);
  await git(repo, ['commit', '-m', 'feat: fixture change']);

  const result = await runCli(['pr', 'prepare', repo, '--base', 'main', '--story-id', 'story-body-contract', '--json']);
  assert.equal(result.exitCode, 0, 'pr prepare must succeed on the fixture repo (ac:3)');

  const prBody = await readFile(path.join(repo, '.vibepro', 'pr', 'story-body-contract', 'pr-body.md'), 'utf8');
  assert.ok(prBody.indexOf('## 判断') < prBody.indexOf('## 経緯'), 'section order 判断 before 経緯 (ac:3)');
  assert.ok(prBody.indexOf('## 経緯') < prBody.indexOf('## 原因'), 'section order 経緯 before 原因 (ac:3)');
  assert.ok(prBody.indexOf('## 原因') < prBody.indexOf('## 解決'), 'section order 原因 before 解決 (ac:3)');
  assert.ok(prBody.indexOf('## 解決') < prBody.indexOf('## レビュー観点'), 'section order 解決 before レビュー観点 (ac:3)');
  assert.ok(prBody.indexOf('## レビュー観点') < prBody.indexOf('## 確認'), 'section order レビュー観点 before 確認 (ac:3)');
  assert.ok(prBody.indexOf('## 確認') < prBody.indexOf('## 詳細'), 'section order 確認 before 詳細 (ac:3)');
  assert.doesNotMatch(prBody, /Engineering Judgment:/, 'Engineering Judgment lines stay banned from pr-body (ac:3)');
  assert.doesNotMatch(prBody, /#### 共通spineの確認/, 'judgment spine narrative stays banned from pr-body (ac:3)');
  assert.doesNotMatch(prBody, /suppressed_candidates:/, 'suppressed-axis detail stays banned from pr-body (ac:3)');
  assert.doesNotMatch(prBody, /## このPRで決めたいこと/, 'the removed decision section does not reappear (ac:3)');
  assert.doesNotMatch(prBody, /### 判断グラフ/, 'the removed decision graph does not reappear (ac:3)');
  assert.ok(Buffer.byteLength(prBody, 'utf8') < 20000, 'pr-body stays under the 20KB ceiling (ac:3)');
});

// story-vibepro-pr-human-summary-dead-chain-removal ac:4 no test references the removed exports
test(`${STORY_ID} leaves no module surface for the removed exports (ac:4)`, () => {
  // story-vibepro-pr-human-summary-dead-chain-removal PS-004 ac:4
  // Given the two test files that pinned the removed exports, when the removal lands, then no test
  // references the removed surfaces (this file asserts the module boundary; repository-wide search
  // is recorded as verification evidence).
  assert.equal(Object.keys(prManager).includes('renderPrGateSummary'), false, 'no test-visible export renderPrGateSummary (ac:4)');
  assert.equal(Object.keys(prManager).includes('buildHumanEvidenceDigest'), false, 'no test-visible export buildHumanEvidenceDigest (ac:4)');
});
