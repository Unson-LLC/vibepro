---
story_id: story-vibepro-human-review-cockpit
title: VibeProの人間レビュー成果物を実行可能な判断コックピットにする
status: active
view: dev
period: 2026-W19
architecture_ref: docs/architecture/vibepro-human-review-cockpit-architecture.md
spec_ref: docs/specs/vibepro-human-review-cockpit-spec.md
---

# Story: VibeProの人間レビュー成果物を実行可能な判断コックピットにする

## 背景

VibeProのPR準備成果物はHTML化され、Story / Architecture / Spec / Code / Gate の関係を人間が読みやすくなった。一方で、現状のHTMLは「読むレポート」に寄っており、レビュー担当者が次に何を判断し、どのコマンドを実行し、どの証跡を残すべきかが一画面で完結していない。

## ユーザー価値

VibeProを使う開発者・レビュアーとして、PR準備後に1つのHTML画面を見れば、進める・分割する・証跡を追加する・waiver理由付きで進める・止める、の判断と次アクションを実行できる状態にしたい。

## 受け入れ基準

- [ ] `pr prepare` が `review-cockpit.html` を生成する
- [ ] `pr prepare` が人間レビュー判断の正本テンプレートとして `human-review.json` を生成する
- [ ] Cockpitに推奨判断、選択可能な判断、Gate状態、分割判断、Graphify調査範囲、次コマンドがまとまっている
- [ ] 次コマンドやレビューJSONをコピーできる
- [ ] manifest と `pr-prepare.json` から `review-cockpit.html` / `human-review.json` を辿れる
- [ ] JSON正本とHTML投影を分離し、HTMLだけを機械可読正本にしない
