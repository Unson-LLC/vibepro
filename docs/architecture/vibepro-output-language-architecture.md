---
story_id: story-vibepro-output-language
title: VibePro出力言語設定のアーキテクチャ
story_ref: docs/stories/vibepro-output-language-story.md
spec_ref: docs/specs/vibepro-output-language-spec.md
---

# Architecture: VibePro出力言語設定

## 方針

言語設定は、VibeProのmachine-readable正本ではなく、人間向け投影の表示責務として扱う。

## 責務境界

- Workspace config
  - `.vibepro/config.json` に出力言語を保存する
  - 設定の正本は `output.language`
- CLI layer
  - `init` 時の指定と、既存workspaceの設定変更を受け付ける
  - 不正な言語値を拒否する
- Language policy
  - 言語値の正規化、既定値、サポート言語を一箇所に集約する
- Human artifact renderers
  - HTML artifact、PR本文、CLI summaryの固定ラベルを設定言語で表示する
- Machine artifacts
  - JSON schema、ID、status、command、file path、Graphify node id は言語設定で変えない

## データ流

1. `vibepro init` または `vibepro config language` が `.vibepro/config.json` の `output.language` を更新する
2. `pr prepare` がworkspace configから `output.language` を解決する
3. `pr prepare` が `preparation.output.language` に解決済み言語を記録する
4. HTML renderer と PR body renderer は `preparation.output.language` を使って固定ラベルを出す
5. JSONの構造・enum・IDは同じまま維持する

## 判断

既定言語は `ja` とする。VibeProの社内β利用者は日本語でレビューする前提が強く、現在の課題も日本語利用時の英語混在であるため。
