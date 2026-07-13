---
story_id: story-vibepro-release-surface-guard
title: "blocked状態のrelease操作を決定的に停止するRelease Surface Guardを追加する"
view: dev
period: 2026-07
source:
  type: incident-analysis
  id: VP-INCIDENT-2026-07-13-SALESTAILOR-BLUEPRINT-ADVISORY-BYPASS
  title: "execution gate blockedのまま、エージェントが直接git push / raw PR作成 / デプロイでVibeProを素通りした"
parent_design: vibepro-release-surface-guard
related_stories:
  - story-vibepro-evidence-adjudication-gate
architecture_docs:
  - ../../../architecture/vibepro-release-surface-guard.md
spec_docs:
  - ../../../specs/vibepro-release-surface-guard.md
status: active
created_at: 2026-07-13
updated_at: 2026-07-13
---

# blocked状態のrelease操作を決定的に停止するRelease Surface Guardを追加する

## User Story

**As a** VibeProをハーネスとして使うAIコーディングエージェントの運用者
**I want to** execution gateがblockedの間は、raw `gh pr create`・protected branchへの直接push・デプロイコマンドが「注意書き」ではなく「終了コード」で止まってほしい
**So that** 2026-07-13インシデントのように、エージェントがVibeProの停止信号を読み飛ばしてrelease操作へ進む経路を、決定的ガードで塞げる

## 背景

VibeProのenforcementは現在 `vibepro pr create` 内部のthrowだけで、直接 `git push` / `gh pr create` /
デプロイを実行するエージェントには何の強制力もない（advisory）。2026-07-13のSalesTailor Blueprint
インシデントでは、`execution_gate: blocked`・`ready_for_pr_create: false` のまま本番デプロイまで
進んだ。再発防止は「気をつける」ではなく「止まる」仕組みで実装する。

止められる面は2つ: (1) git pre-push hook（protected branchへの直接push）、
(2) エージェントハーネスのPreToolUse hook（Claude Codeが実行するBashコマンドの事前検査）。
どちらも `vibepro guard check` という単一の決定的判定器へ委譲する。判定器は
release-surfaceコマンドのパターン分類（決定的コード）と、選択Storyのgate readiness評価を行う。
迂回路は残すが、無音では通れない（bypass理由の記録を強制する）。

## Scope

- `vibepro guard check`: コマンド文字列（`--command <cmd>` / pre-pushモード / PreToolUse stdinモード）をrelease-surfaceパターンと照合し、該当かつ選択Storyの `ready_for_pr_create` がfalseのとき非0で終了して blocking gates と復旧コマンドを出力する
- release-surfaceパターンの既定: raw `gh pr create`、protected branch（既定 main / master）への `git push`、デプロイコマンド（`fly deploy` / `vercel deploy` / `npm publish` 等）。`vibepro` 自身のコマンドは対象外
- `VIBEPRO_GUARD_BYPASS=<reason>` によるbypassは通すが、`.vibepro/guard/bypass-log.jsonl` へ reason・command・head_sha・時刻を追記記録する（無音の迂回を構造的に不可能にする）
- `vibepro guard install`: marker付きmanaged pre-push hookを `.git/hooks/pre-push` へ設置。既存の非vibepro hookは上書きせず明示エラー。`--claude` で `.claude/settings.json` の PreToolUse hook（Bash matcher → `vibepro guard check --pretooluse`）をマージ追加し、既存エントリを保持する
- `vibepro guard status` / `vibepro guard uninstall`
- `.vibepro/config.json` の `guard` キー（`enabled` / `protected_branches` / `release_patterns`）で上書き可能

## 非目標

- GitHubブランチ保護等のサーバー側enforcementの代替（defense in depth の一層として追加する）
- Codex等、hookインターフェースを持たないハーネスへの強制（AGENTS.md指示はadvisoryのまま）
- デプロイ先サービス側での停止（ローカルからのコマンド起動面のみ扱う）
- `vibepro pr create` / `execute merge` 内部経路の変更（既存のthrow enforcementを維持）

## 受け入れ基準

- [ ] `vibepro guard check --command "gh pr create ..."` は、選択Storyのgate readinessが `ready_for_pr_create: false` のとき非0で終了し、出力に blocking gate と復旧コマンドが含まれる
- [ ] release-surfaceに該当しないコマンド（通常のbuild/test/読み取り系）は gate readiness を評価せず即 exit 0 になる
- [ ] gate readinessが `ready_for_pr_create: true` のとき、release-surfaceコマンドでも exit 0 になる
- [ ] `.vibepro` workspaceが無い・Storyが未選択のリポジトリでは常に exit 0 になる（vibepro管理外へ干渉しない）
- [ ] `VIBEPRO_GUARD_BYPASS` に非空のreasonを設定するとblockは通過するが、bypassが `.vibepro/guard/bypass-log.jsonl` へ reason・command・head_sha 付きで追記され、reasonが空なら通過しない
- [ ] `vibepro guard install` はmarker付きpre-push hookを設置し、再実行は冪等、既存の非vibepro hookがある場合は上書きせず明示エラーになる
- [ ] 設置されたpre-push hookは、protected branchへのpush refをguard checkへ委譲し、blocked時に非0で終了する（protected以外のbranch pushは通す）
- [ ] `vibepro guard install --claude` は `.claude/settings.json` へ PreToolUse hook（Bash matcher）をマージ追加し、既存のhooks・他設定キーを保持し、再実行は冪等になる
- [ ] `--pretooluse` モードはstdinのtool入力JSONからコマンドを抽出し、block時は exit 2 とstderrへの理由出力で応答する
- [ ] `.vibepro/config.json` の `guard.enabled: false` で全guard surfaceが無効になり、`protected_branches` / `release_patterns` で既定を上書きできる
- [ ] `vibepro guard status` は hook設置状態・有効設定・bypass記録件数を表示する
- [ ] テストは「パターン分類（該当/非該当）」「blocked/readyのblock・allow」「管理外repoの素通し」「bypass記録と空reason拒否」「install冪等性と衝突エラー」「settingsマージ保持」「pre-push refフィルタ」「pretooluse stdinモード」を含む

## 検証メモ

証拠記録では自動テストで検証した事実のみをverify recordへ記録し、人間成果の主張を
自動テストのscenarioへ貼らない。裁定（evidence_adjudication gate）は独立fresh context
subagentへdispatchする。
