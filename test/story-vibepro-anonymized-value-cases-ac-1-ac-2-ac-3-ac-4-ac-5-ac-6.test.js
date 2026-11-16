import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const root = process.cwd();
const caseFiles = [
  'evidence-gated-answer.md',
  'stable-completion-decision.md',
  'stable-batch-window.md',
  'restart-safe-delivery.md'
];

const localeFallbackFiles = ['index.md', 'release-safety.md', ...caseFiles];
const anonymousSpecificValuePatterns = [
  /[0-9０-９]/,
  /[一二三四五六七八九十百千]+件/,
  /[一二三四五六七八九十]+月[一二三四五六七八九十]+日/
];

async function readCase(file) {
  return readFile(path.join(root, 'docs/ja/cases', file), 'utf8');
}

test('AC-1 AC-5 AVC-1 AVC-5 事例一覧から5件へ移動できる', async () => {
  const [index, config] = await Promise.all([
    readCase('index.md'),
    readFile(path.join(root, 'docs/.vitepress/config.mjs'), 'utf8')
  ]);

  assert.match(config, /\{ text: '事例', link: '\/ja\/cases\/' \}/);

  for (const href of [
    './evidence-gated-answer',
    './stable-completion-decision',
    './stable-batch-window',
    './restart-safe-delivery',
    './release-safety'
  ]) {
    assert.match(index, new RegExp(href.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
});

test('AC-2 AVC-2 匿名事例から識別子と原典リンクを除く', async () => {
  const pages = await Promise.all(caseFiles.map(readCase));
  const forbidden = [
    ...anonymousSpecificValuePatterns,
    /Unson/i,
    /Zeims/i,
    /SalesTailor/i,
    /Tech[ -]?Knight/i,
    /Mana/i,
    /Slack/i,
    /GitHub/i,
    /github\.com/i,
    /https?:\/\//i,
    /\]\((?:\/|[a-z][a-z0-9+.-]*:)/i,
    /pull\/\d+/i,
    /PR\s*#?\d+/i,
    /\b[0-9a-f]{7,40}\b/i,
    /20\d{2}[-年/]/,
    /税務/,
    /宿泊/,
    /ホテル/,
    /フォーム/
  ];

  for (const page of pages) {
    for (const pattern of forbidden) {
      assert.doesNotMatch(page, pattern);
    }
  }
});

test('AC-2 AVC-2 固有件数と日付の検査感度を固定する', () => {
  for (const sample of ['123件', '8月11日', '八月十一日']) {
    assert.ok(anonymousSpecificValuePatterns.some((pattern) => pattern.test(sample)));
  }
});

test('AC-3 AC-4 AVC-3 AVC-4 各事例が事実と主張境界を分ける', async () => {
  const pages = await Promise.all(caseFiles.map(readCase));

  for (const page of pages) {
    for (const heading of [
      '## 起きていたこと',
      '## 変更',
      '## 確認できたこと',
      '## VibeProの寄与',
      '## まだ言えないこと'
    ]) {
      assert.match(page, new RegExp(heading));
    }

    assert.match(page, /VibeProが.+わけではありません|VibeProの工程/);
    assert.match(page, /売上、顧客満足度、工数削減、不具合削減率/);
    assert.match(page, /事例一覧へ戻る/);
  }
});

test('AC-4 AVC-4 検証、マージ、本番反映の確認境界を固定する', async () => {
  const pages = await Promise.all(caseFiles.map(readCase));

  for (const page of pages) {
    assert.match(page, /テスト|動作確認/);
    assert.match(page, /マージ/);
    assert.match(
      page,
      /本番へ反映された記録まで確認しています|本番反映の有無は、この記録では確認できません/
    );
  }
});

test('AC-6 AVC-6 内部Specを公開ビルドから除外する', async () => {
  const [config, buildContract] = await Promise.all([
    readFile(path.join(root, 'docs/.vitepress/config.mjs'), 'utf8'),
    readFile(path.join(root, 'scripts/check-public-manual-build.mjs'), 'utf8')
  ]);

  assert.match(config, /features\/anonymized-value-cases\/\*\*/);
  assert.match(buildContract, /features\/anonymized-value-cases/);
});

test('AC-5 AVC-5 日本語の全事例から一覧へ戻れる', async () => {
  const pages = await Promise.all([
    ...caseFiles.map(readCase),
    readCase('release-safety.md')
  ]);

  for (const page of pages) {
    assert.match(page, /\[事例一覧へ戻る\]\(\.\/\)/);
  }
});

test('AC-5 AVC-5 言語切替先に英語案内ページが存在する', async () => {
  for (const file of localeFallbackFiles) {
    const content = await readFile(path.join(root, 'docs/cases', file), 'utf8');
    const slug = file === 'index.md' ? '' : file.replace(/\.md$/u, '');
    assert.match(content, new RegExp(`/ja/cases/${slug}`));
  }

  const buildContract = await readFile(path.join(root, 'scripts/check-public-manual-build.mjs'), 'utf8');
  for (const file of localeFallbackFiles) {
    assert.match(buildContract, new RegExp(`cases/${file.replace(/\.md$/u, '.html')}`));
  }
});
