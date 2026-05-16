---
story_id: story-vibepro-output-language
title: VibeProの人間向け成果物の言語を揃える
status: active
view: dev
period: 2026-W19
architecture_ref: docs/architecture/vibepro-output-language-architecture.md
spec_ref: docs/specs/vibepro-output-language-spec.md
---

# Story: VibeProの人間向け成果物の言語を揃える

## 背景

VibeProのPRレビュー成果物やCLI出力に英語と日本語が混ざると、社内利用者がどこを読めばよいか判断しにくい。特にHTML artifactは人間レビュー用の画面なので、読み手の言語に揃っている必要がある。

## ユーザー価値

VibeProを使う開発者・レビュアーとして、リポジトリごとに人間向け出力言語を設定し、PR準備やレビュー成果物を同じ言語で読みたい。これにより、Story / Architecture / Spec / Code / Gate の判断に集中できる。

## 受け入れ基準

- [ ] `.vibepro/config.json` に人間向け出力言語を保存できる
- [ ] `init` 時に出力言語を指定できる
- [ ] 既存workspaceでもCLIから出力言語を変更できる
- [ ] PR準備HTML、Gate DAG HTML、Split Plan HTML、PR作成HTMLが設定言語に揃う
- [ ] PR本文ドラフトの見出しと固定ラベルが設定言語に揃う
- [ ] JSONのschema、ID、machine-readable keyは言語設定で変わらない
