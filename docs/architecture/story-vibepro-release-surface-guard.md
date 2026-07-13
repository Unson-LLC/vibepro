---
story_id: story-vibepro-release-surface-guard
title: Release Surface Guard Architecture
parent_design: vibepro-release-surface-guard
---

# アーキテクチャ

## 判断

VibeProのenforcementは `vibepro pr create` 内部のthrowに閉じており、エージェントがVibePro外のコマンド（raw `gh pr create`・protected branchへの直接push・デプロイ）へ進む経路はadvisoryのままだった。2026-07-13インシデントはこの経路で発生した。再発防止として、release操作の起動面へ決定的ガードを置く。

中核は単一の判定器 `vibepro guard check`。責務は2段で、(1) コマンド文字列のrelease-surfaceパターン分類（純粋な決定的コード、非該当は即allow）、(2) 該当時のみ選択Storyのgate readiness評価（`evaluateGateReadiness` を再利用し `ready_for_pr_create` で判定）。呼び出し面は2つ: git pre-push hook（protected branchへのpush refのみ委譲）と、Claude CodeのPreToolUse hook（Bash tool実行前にstdin JSONで検査、blockは exit 2）。両者ともhookは薄いラッパーに留め、判定ロジックはguard checkに一元化する。

原則は3つ。**決定はコード、判断はしない**: パターン照合と終了コードのみで、LLM的裁量を持たない（判断が必要な例外はbypass経路へ逃がす）。**無音の迂回を不可能にする**: `VIBEPRO_GUARD_BYPASS=<reason>` で通れるが、非空reasonを強制し `.vibepro/guard/bypass-log.jsonl` へ追記記録する。緊急時の脱出路を塞がず、事後監査可能性だけを保証する。**管理外へ干渉しない**: `.vibepro` workspaceが無い・Story未選択・`guard.enabled: false` のときは常にallowし、vibeproを使わないリポジトリの操作を一切妨げない。

## 入力

- 検査対象コマンド: `--command <cmd>` / pre-pushモード（stdinの `<local-ref> <local-sha> <remote-ref> <remote-sha>` 行とremote引数）/ `--pretooluse`（stdinのtool入力JSONから `tool_input.command` を抽出）
- `.vibepro/config.json` の `guard` キー: `enabled`（既定 true）、`protected_branches`（既定 `["main", "master"]`）、`release_patterns`（既定パターンへの追加/置換）
- 選択Storyの gate readiness（`evaluateGateReadiness` の `ready_for_pr_create` / blocking gates）
- 環境変数 `VIBEPRO_GUARD_BYPASS`（bypass理由）

## 出力

- 終了コード: allow=0、block=非0（pretooluseモードは exit 2 + stderr理由。Claude Codeのhook契約に一致）
- block出力: 該当パターン・blocking gates・復旧コマンド（`vibepro pr prepare` / `vibepro pr create` / `vibepro adjudicate prepare` 等）
- `.vibepro/guard/bypass-log.jsonl`: bypass毎に `{reason, command, head_sha, recorded_at}` を追記
- `vibepro guard install` の成果物: marker付き `.git/hooks/pre-push`（既存の非vibepro hookは上書きせず明示エラー、再実行は冪等）、`--claude` で `.claude/settings.json` へのPreToolUse hookマージ（既存キー・既存hooks保持、冪等）
- `vibepro guard status`: hook設置状態・有効設定・bypass記録件数

## 境界

- GitHubブランチ保護等サーバー側enforcementの代替ではない（defense in depthの一層）
- hookインターフェースを持たないハーネス（Codex CLI等）へは強制しない（AGENTS.md指示はadvisoryのまま。将来のharness側hook対応が前提）
- デプロイ先サービス側の停止は扱わない（ローカルのコマンド起動面のみ）
- `vibepro` 自身のコマンド（`vibepro pr create` 等）はパターン対象外（内部throwによる既存enforcementが担当）
- WIP branchの通常pushは妨げない（pre-push hookはprotected branch宛refのみ委譲）
- gate readiness評価はrelease-surface該当時のみ実行し、通常コマンドのオーバーヘッドをゼロに保つ
- pre-push hookはvibepro CLIがPATHに無いときpushを許可する（fail open。gitを文鎮化させないための明示的境界。`command -v` probeで判定し、hook script内に注記する）
- 選択Storyのreadiness評価がエラーになった場合はfail closedでblockする（bypass経路は残る）。Story未選択は決定的にallowする
- 分類はshellの完全なparseを行わない。segment分割は `;` `&&` `||` `|` と改行を境界とし、command substitution（`$(...)`）内の埋め込みは検出しない（既知の境界。pre-push hook側のref判定と監査付きbypassが残る防御層）
