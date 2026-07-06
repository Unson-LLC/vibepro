---
story_id: story-vibepro-ci-gate-check-mode
title: "外部リポジトリのCIから vibepro の実ゲート計算を直接呼べる read-only `gate check` モードを追加する"
status: active
view: dev
period: 2026-07
source:
  type: operator_feedback
  title: "brainbase / salestailor が CI で gate/scoring ロジックを自前実装しており、vibepro の実ゲート計算に接続していない"
related_stories:
  - story-vibepro-pr-evidence-autopilot
  - story-vibepro-workflow-pre-pr-evidence-gate
spec_docs:
  - docs/specs/story-vibepro-ci-gate-check-mode.md
created_at: 2026-07-06
updated_at: 2026-07-06
---

# Story

`pr prepare` は Gate DAG の実計算を既に持っているが、外部リポジトリ（brainbase、salestailor など）の CI はこれを呼ばずに、自前の scoring/gate 判定スクリプトを手書きしている。brainbase の `scripts/vibepro-score-run.mjs` はその一例で、本番化ギャップ捕捉率やゲート違反流出率のような独自メトリクスを vibepro の Gate DAG と無関係に再実装している。この乖離は、CI から安全に呼べる read-only なゲート評価コマンドが vibepro 側に存在しなかったことが原因である。`vibepro gate check <repo> [--story-id <id>] --ci` を追加し、外部 CI が vibepro の実ゲート計算を直接消費できるようにする。

## User Story

**As a** 外部リポジトリ（brainbase、salestailor 等）の CI を保守する開発者<br>
**I want** `vibepro gate check . --story-id <id> --ci --json` が、実際の Gate DAG 計算結果を正規化された JSON レポートとして返し、ブロッキングなゲート未解消があれば非ゼロ終了すること<br>
**So that** 自前の gate/scoring ロジックを再実装せずに、CI ジョブを vibepro の正本ゲート判定にそのまま接続できる

## Scope

- `vibepro gate check <repo> [--story-id <id>] --ci [--json]`: `pr prepare` と同じ Gate DAG 計算（`preparePullRequest`）を実行し、正規化されたレポート（`schema_version`、`story_id`、`overall_status`、`ready_for_pr_create`、`gates[]`、`unresolved_gate_count`、`critical_unresolved_gate_count`、`generated_at`）を返す。
- read-only 保証: `gate check` の実行前後で `.vibepro/pr/<story-id>/` と `.vibepro/gate-outcomes/` の内容はバイト単位で不変とする（存在しなかった場合は実行後も存在しない）。
- `--story-id` を省略した場合は `checkpoint`/`pr prepare` と同じデフォルトのストーリー解決ロジックに従う。
- `--story-id` が解決できない場合は、スタックトレースではなく分かりやすいエラーメッセージと非ゼロ終了コードを返す。
- exit code: 全ての必須ゲートが解消済み（`ready_for_pr_create` 相当）なら `0`、未解消のブロッキングゲートが残っていれば `1`。ストーリー未解決などのセットアップエラーも `1` とする。
- `--json` なしでも人間可読な短いサマリーを出す。`--ci` を付けない場合も同じ評価を実行できるが、その旨（CI で使う正式な呼び出しではない）を一行注記する。

## Architecture Decision

ADR不要: 既存の `preparePullRequest`（`src/pr-manager.js`）が持つ Gate DAG 計算を、新しい薄いラッパー関数 `evaluateGateReadiness` から呼び出すだけの構成にする。`preparePullRequest` はワークスペース初期化済みの場合 `.vibepro/pr/<story-id>/` と `.vibepro/gate-outcomes/` に必ず書き込むため、副作用を止める改修は行わず、代わりに実行前後でこの2つのサブパスをスナップショット／復元することで read-only を実現する（全リポジトリの `.vibepro/` を丸ごとスナップショットする設計は、無関係な他ストーリーの成果物まで巻き込むリスクがあるため採らない）。ストーリーIDはスナップショット対象を決めるために `preparePullRequest` 呼び出し前に確定させる必要があるため、同モジュール内の既存の（副作用のない）`readWorkspaceState` と `resolveStory` を呼び出し順に再利用する。ゲート判定ロジック自体は一切再実装しない。boundary は `gate check` の CLI 分岐、`evaluateGateReadiness` ラッパー、対応する focused test の範囲に限定し、`pr prepare`・`checkpoint`・self-dogfood CI の既存動作には触れない。rollback plan は `gate` サブコマンドと `evaluateGateReadiness` を revert すれば既存コマンド群に影響なく戻せる構成にする。accepted followups は、`gate check` から waiver やレビュー起動を自動化することは本Storyのスコープ外とし、必要なら別Storyで扱う。

## Acceptance Criteria

- [x] CGC-S-1: 全ての必須ゲートが解消済みのストーリーに対して `gate check --ci --json` を実行すると、exit code 0 で `ready_for_pr_create: true` を含む正規化レポートを返す。
- [x] CGC-S-2: 必須ゲートが未解消のストーリーに対して実行すると、exit code 1 で `overall_status` と未解消ゲート一覧を含むレポートを返す。
- [x] CGC-S-3: `--json` の出力は `schema_version`、`story_id`、`overall_status`、`ready_for_pr_create`、`gates[]`、`unresolved_gate_count`、`critical_unresolved_gate_count`、`generated_at` を含む。
- [x] CGC-S-4: `.vibepro/pr/<story-id>/` が実行前に存在しない場合、実行後も存在しない。実行前に既存の成果物がある場合、実行後もバイト単位で内容が変わらない。
- [x] CGC-S-5: 存在しない `--story-id` を指定した場合、スタックトレースではなく分かりやすいエラーメッセージと非ゼロ終了コードを返す。
- [x] CGC-S-6: テストで pass / blocked / `--json` shape / read-only 保証（新規・既存両方） / story未解決エラー の各分岐を固定する。

## 既存挙動（inherited behavior）

- `checkpoint` command behavior is unchanged.
- `pr prepare` gate evaluation is unchanged.
- Self-dogfood CI (`.github/workflows/ci.yml`'s `check self-dogfood` and `checkpoint --json` steps) is unchanged.

## Non Goals

- waiver・split・レビュー verdict などの人間判断の自動化（`gate check` は評価のみを行い、判断は記録しない）。
- ゲート判定基準そのものの変更や新しいゲートの追加。
- brainbase の `vibepro-score-run.mjs` を含む外部リポジトリ側スクリプトの書き換え（このStoryは vibepro 側に read-only な接続口を用意するところまでを扱う）。
