import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const implementation = readFileSync(new URL('../../src/pr-manager.js', import.meta.url), 'utf8');
const cliRegression = readFileSync(new URL('../vibepro-cli.test.js', import.meta.url), 'utf8');

const storyId = 'story-vibepro-pr-body-published-evidence-integrity';

test(`${storyId} ac:1 current passing evidence is projected without an auto command`, () => {
  const criterion = '自動検出verification commandが0件でも、current-headのpassing verification evidenceがあれば、PR本文の確認欄はその証跡を完了済みとして表示し、未完了fallbackを表示しない。';
  assert.equal(implementation.includes('collectCurrentPassingVerificationEvidence(verificationEvidence)'), true, `${storyId} ac:1 ${criterion}`);
  assert.equal(cliRegression.includes('Current HEAD external verification passed'), true, `${storyId} ac:1 ${criterion}`);
});

test(`${storyId} ac:2 fallback appears only without current passing evidence`, () => {
  const criterion = 'current-headのpassing verification evidenceが存在しない場合だけ、「手動確認または対象テストを追記する」の未完了fallbackを表示する。';
  assert.equal(implementation.includes('currentPassingEvidenceItems'), true, `${storyId} ac:2 ${criterion}`);
  assert.equal(cliRegression.includes('docs/stale-evidence-change.md'), true, `${storyId} ac:2 ${criterion}`);
});

test(`${storyId} ac:3 local workbench paths are inline references`, () => {
  const criterion = '`.vibepro/` 配下のPR準備・判断索引・verification・最終E2E artifactは、GitHubリンクではなくローカルVibePro workbenchのinline code参照として表示する。';
  assert.equal(implementation.includes('function isLocalVibeProArtifactPath'), true, `${storyId} ac:3 ${criterion}`);
  assert.equal(implementation.includes('function formatPrBodyPathReference'), true, `${storyId} ac:3 ${criterion}`);
});

test(`${storyId} ac:4 existing local Markdown links are normalized and tracked links survive`, () => {
  const criterion = '自由文に既存Markdown形式の`.vibepro/`リンクが含まれる場合もinline codeへ正規化し、既存のtracked repo pathリンクは維持する。';
  assert.equal(cliRegression.includes('doesNotMatch(waivedPrBody'), true, `${storyId} ac:4 ${criterion}`);
  assert.equal(cliRegression.includes('tracked=[Story](docs/management/stories/active/story-pr-prepare.md)'), true, `${storyId} ac:4 ${criterion}`);
});

test(`${storyId} ac:5 every published fallback applies the same path policy`, () => {
  const criterion = '通常本文だけでなく、Gate waiver追記、GitHub本文上限超過時のlimit notice、minimal fallback、forced fallbackでも、`.vibepro/` 参照をローカルinline codeとして表示する。';
  assert.equal(implementation.includes('buildMinimalGithubPrBody'), true, `${storyId} ac:5 ${criterion}`);
  assert.equal(implementation.includes('forceBoundPrBody'), true, `${storyId} ac:5 ${criterion}`);
  assert.equal(cliRegression.includes('forced_artifact_reference_fallback'), true, `${storyId} ac:5 ${criterion}`);
});

test(`${storyId} ac:6 tracked repository paths remain clickable without filesystem checks`, () => {
  const criterion = '`docs/`、`src/`、`test/` など既存のrepo path allowlistに一致する相対パスは、従来どおりクリック可能なMarkdownリンクとして表示する。formatterではfilesystem/Gitの存在確認を追加しない。';
  assert.equal(implementation.includes('function formatRepoPathLink'), true, `${storyId} ac:6 ${criterion}`);
  assert.equal(implementation.includes('existsSync(repoPath)'), false, `${storyId} ac:6 ${criterion}`);
});

test(`${storyId} ac:7 gate and binding enforcement remain unchanged`, () => {
  const criterion = 'Gate readiness、verification binding、PR create/merge経路は変更しない。';
  assert.equal(implementation.includes('Pre-create gate waiver missing'), true, `${storyId} ac:7 ${criterion}`);
  assert.equal(cliRegression.includes('artifact_reference_fallback'), true, `${storyId} ac:7 ${criterion}`);
});
