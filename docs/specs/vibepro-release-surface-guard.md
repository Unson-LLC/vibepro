---
story_id: story-vibepro-release-surface-guard
title: Release Surface Guard Spec
parent_design: vibepro-release-surface-guard
---

# Spec

機械可読の正本は `docs/specs/story-vibepro-release-surface-guard.vibepro.json`（`vibepro spec write --final` 入力）。この文書は人間向け要約。

## Contracts

### GRD-CONTRACT-001: 決定的分類

release-surface分類（raw `gh pr create`/`merge`・protected branchへの`git push`・デプロイコマンド）は決定的コードで行い、通常コマンドと `vibepro` 自身のコマンドは決して該当させない。非該当コマンドはgate readinessを評価せず即allowする。

### GRD-CONTRACT-002: blocked時の停止と復旧導線

選択Storyが `ready_for_pr_create: false` の間、該当コマンドは非0（PreToolUseモードは exit 2 + stderr理由）で停止し、blocking gates と復旧コマンド（`vibepro pr prepare` / `vibepro pr create`）を出力しなければならない。readyなら該当コマンドもallowする。

### GRD-CONTRACT-003: 監査可能なbypass

`VIBEPRO_GUARD_BYPASS` の非空reasonでのみblockを通過でき、bypassは `.vibepro/guard/bypass-log.jsonl` へ reason・command・head_sha・時刻付きで追記されなければならない。空reasonは通過しない。

### GRD-CONTRACT-004: 設置の安全性

`guard install` はmarker付きpre-push hookを冪等に設置し、非vibepro hookは上書きせず明示エラーにする。`--claude` は `.claude/settings.json` の既存キー・既存hooksを保持してPreToolUse hookをマージし、冪等である。`uninstall` はvibepro管理hookのみ除去する。

### GRD-CONTRACT-005: 管理外への不干渉

`.vibepro` workspaceが無い・Story未選択・`guard.enabled: false` のリポジトリでは常にallowし、vibeproを使わないリポジトリの操作を妨げない。`protected_branches` / `release_patterns` は config で上書きできる。

## Non Goals

- GitHubブランチ保護等サーバー側enforcementの代替
- hookインターフェースを持たないハーネス（Codex等）への強制
- デプロイ先サービス側での停止
- `vibepro pr create` / `execute merge` 内部経路の変更
