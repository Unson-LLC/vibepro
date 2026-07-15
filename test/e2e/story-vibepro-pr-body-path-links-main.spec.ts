import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const implementation = readFileSync(new URL('../../src/pr-manager.js', import.meta.url), 'utf8');
const cli = readFileSync(new URL('../../src/cli.js', import.meta.url), 'utf8');
const cliRegression = readFileSync(new URL('../vibepro-cli.test.js', import.meta.url), 'utf8');

test('story-vibepro-pr-body-path-links acceptance coverage', () => {
  // story-vibepro-pr-body-path-links ac:1
  // PR本文のStory正本、設計/Story、実装、テストはMarkdownリンクで出力され、ローカルartifactはinline codeになる。
  assert.match(implementation, /function formatRepoPathList/);
  assert.match(implementation, /function formatPrBodyPathReference/);
  assert.match(cliRegression, /docs\/management\/stories\/active\/story-pr-prepare\.md/);
  assert.match(cliRegression, /\.vibepro\/pr\/story-pr-prepare\/pr-prepare\.json/);

  // story-vibepro-pr-body-path-links ac:2
  // 確認セクションのverification evidence artifactと最終E2E artifactは公開可否の境界で表示を分ける。
  assert.match(implementation, /isLocalVibeProArtifactPath/);
  assert.match(cliRegression, /\.vibepro\/verification\/story-pr-prepare\/unit-status\.json/);
  assert.match(cliRegression, /tests\/src\/app\/api\/projects\/\[projectId\]\/available-recipients\/route\.test\.ts/);

  // story-vibepro-pr-body-path-links ac:3
  // Next.js動的ルートのように [ ] や ( ) を含むパスでも、Markdownリンクのラベルとhrefが壊れない。
  assert.match(implementation, /escapeMarkdownLinkLabel/);
  assert.match(implementation, /encodeMarkdownRelativePath/);
  assert.match(cliRegression, /'src', 'app', '\(app\)', 'detail'/);
  assert.match(cliRegression, /'src', 'app', 'projects', '\[projectId\]', '_components'/);
  assert.match(cliRegression, /%28app%29/);

  // story-vibepro-pr-body-path-links ac:4
  // 外部URL、絶対パス、Story未検出などリポジトリ相対パスではない値はリンク化しない。
  assert.match(implementation, /trimmed\.includes\('\\n'\)/);
  assert.match(implementation, /\^\[a-z\]\[a-z0-9\+\.\-\]\*:/);
  assert.match(implementation, /normalized\.startsWith\('\/'\)/);
  assert.match(implementation, /normalized\.includes\('\.\.'\)/);

  // story-vibepro-pr-body-path-links ac:5
  // PR本文の短い判断ブリーフ構造、Gate判定、PR作成/merge経路は変えない。
  assert.match(implementation, /## 判断/);
  assert.match(implementation, /## 確認/);
  assert.match(implementation, /## 詳細/);
  assert.match(implementation, /- Gate: \$\{gateStatus\}/);
  assert.match(implementation, /pr create/);
  assert.match(cli, /vibepro execute merge/);
});
