import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const root = process.cwd();

test('日本語のリリース安全事例を根拠と主張境界付きで公開する', async () => {
  const [page, config] = await Promise.all([
    readFile(path.join(root, 'docs/ja/cases/release-safety.md'), 'utf8'),
    readFile(path.join(root, 'docs/.vitepress/config.mjs'), 'utf8')
  ]);

  assert.match(config, /\{ text: '事例', link: '\/ja\/cases\/release-safety' \}/);
  assert.match(page, /2時間11分44秒/);
  assert.match(page, /VibeProの作業スレッドに記録されたタイムライン/);
  assert.match(page, /公開依頼からnpm公開とGitHub Releaseの確認完了まで/);
  assert.match(page, /同じ作業を担当したエージェントとは別のレビューセッション/);
  assert.match(page, /0\.2\.0-beta\.6/);
  assert.match(page, /## 確認できた事実/);
  assert.match(page, /## VibeProが寄与した範囲/);
  assert.match(page, /VibeProが不具合を単独で自動検出したわけではありません/);
  assert.match(page, /この一例だけで、不具合削減率や開発速度の一般的な効果は算出できません/);
  assert.match(page, /過去の`beta\.1`から`beta\.5`の再分類は、この変更の対象外です/);
  assert.match(page, /日本時間19時12分/);
  assert.match(page, /日本時間20時48分/);

  for (const url of [
    'https://github.com/Unson-LLC/vibepro/pull/450',
    'https://github.com/Unson-LLC/vibepro/pull/451',
    'https://github.com/Unson-LLC/vibepro/pull/452',
    'https://github.com/Unson-LLC/vibepro/actions/runs/31490602296'
  ]) {
    assert.match(page, new RegExp(url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
});
