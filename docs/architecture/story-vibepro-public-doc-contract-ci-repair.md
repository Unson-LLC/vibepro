---
story_id: story-vibepro-public-doc-contract-ci-repair
title: 公開文書契約テストの意味境界
status: accepted
updated_at: 2026-08-20
---

# 公開文書契約テストの意味境界

## 判断

公開文書を旧コピーへ戻さず、テスト側を#476で確定した現在の設計へ同期する。
テストは文章全体の固定ではなく、次の意味境界を示す短い契約句を確認する。

- VibeProはプロダクト意図からStory、Spec、実装、検証、判断、PR引き渡しまでを追跡可能にする。
- プロダクトの意味、安全性、承認、mergeの最終権限は人間とリポジトリ方針に残る。
- 現行の最小コアは旧Gate DAG、managed execution、lifecycle会計、budget enforcement、自動audit bundleを持たない。

## 代替案

- 公開文書を旧文言へ戻す案は、#476の設計変更を取り消すため不採用。
- 旧テスト文字列を現在の文書へ付け足す案は、同じ意味を重複して表現し、コピーだけを契約化するため不採用。
- 大規模なスナップショットテストへの置換は、今回の3 assertionを越えて変更範囲を広げるため不採用。

## 互換性・境界

変更対象は `test/public-manual-contract.test.js`、`test/uiux-docs-feature-map.test.js`、
`test/vibepro-cli.test.js` の旧文言assertionだけとする。CLI、公開文書、package metadata、保存形式、
#477のDevelopment Judgment DAGは変更しない。

## ロールバック

対象テスト、Story、Spec、Architectureを同一コミットでrevertすれば、実行時状態や永続データの移行なしに戻せる。
