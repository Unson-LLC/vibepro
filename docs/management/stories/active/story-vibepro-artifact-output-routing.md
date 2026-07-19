---
story_id: story-vibepro-artifact-output-routing
title: 成果物の正本出力先をリポジトリ設定で一意に制御する
view: dev
period: 2026-07
source:
  type: github-issue
  id: "341"
  url: https://github.com/Unson-LLC/vibepro/issues/341
architecture_docs:
  - ../../../architecture/story-vibepro-artifact-output-routing.md
spec_docs:
  - ../../../specs/story-vibepro-artifact-output-routing.md
status: active
created_at: 2026-07-19
updated_at: 2026-07-19
reason: "生成コマンドごとの個別オプションでは検出側との不一致を防げないため、repo-level resolverを採用する。未設定時は既存既定値を維持し、設定を外せば即時rollbackできる。境界はStory/Architecture/Spec/Task/Graphify/review/Gate/PRが扱う永続成果物で、実行時キャッシュは対象外とする。"
---

# 成果物の正本出力先をリポジトリ設定で一意に制御する

## 背景

VibePro は Story、Architecture、Spec、Task などの成果物について、生成側と検出側に固定パスが分散している。利用リポジトリが独自のドキュメント構造を持つ場合、同じ意味の成果物が既定パスと独自パスへ二重生成され、正本が曖昧になる。

## User Story

**As a** VibePro を既存リポジトリへ導入する開発者
**I want to** 成果物種別ごとの正本出力先をリポジトリ設定で宣言したい
**So that** 生成、検出、レビュー、Gate、PR が同じ一つの正本を参照し、重複した SSOT を作らない

## 方針

- `.vibepro/config.json` に成果物種別ごとの canonical path template と、中央 writer を持つ種別の任意の projection を宣言できるようにする。
- 共通 resolver が `{story_id}` と `{feature_slug}` を展開し、生成側と検出側の双方へ同じ結果を返す。
- 未設定時は既存の出力先を維持する。
- 絶対パス、repository traversal、未解決変数、canonical 同士の衝突は書き込み前に fail closed する。
- migration plan は dry-run で移動元、移動先、衝突、未解決項目を表示し、暗黙には移動しない。

## 受け入れ基準

- [x] リポジトリ設定で成果物種別ごとの canonical output path を宣言できる
- [x] 未設定リポジトリでは既存の出力先と動作が維持される
- [x] Story、Architecture、Spec、Task、Graphify、review、Gate、PR が共通 resolver の結果を参照する
- [x] `story_id` と `feature_slug` の安定したテンプレート変数を利用できる
- [x] 各成果物種別に writable canonical artifact は一つだけ存在する
- [x] 対応種別の projection は明示設定時だけ生成対象になり、canonical と区別される。未対応種別は設定時に fail closed する
- [x] canonical の衝突は書き込み前に検出され、対象種別と解決パスが報告される
- [x] repository traversal、絶対パス、未解決変数は fail closed する
- [x] migration dry-run が移動元、移動先、衝突、未解決項目を報告する
- [x] fresh checkout の設定有無を含む回帰テストがある
- [x] 利用者向けドキュメントに設定例、互換性、migration、rollback を記載する

## 非目標

- 実行時キャッシュや一時証跡をすべてユーザー設定可能にすること
- migration dry-run の結果を確認せず既存ファイルを自動移動すること
