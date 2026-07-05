---
story_id: story-vibepro-pr-evidence-autopilot
title: "pr autopilot で evidence-plan の消化を 1 コマンド化し、証跡取得の儀式を人間判断だけに絞る"
status: active
view: dev
period: 2026-07
source:
  type: operator_feedback
  title: "verify record / import-ci / review prepare〜record / decision record の十数コマンドを暗記した順序で手打ちしないと PR に到達できない"
related_stories:
  - story-vibepro-content-scoped-evidence-freshness
  - story-vibepro-evidence-depth-planner
  - story-vibepro-review-lifecycle-repair-loop
  - story-vibepro-ci-evidence-fast-lane
spec_docs:
  - docs/specs/story-vibepro-pr-evidence-autopilot.md
created_at: 2026-07-05
updated_at: 2026-07-05
---

# Story

`pr prepare` は不足している証跡を evidence-plan として既に知っているが、それを充足する作業は operator が verify record・verify import-ci・review prepare→start→close→record・再 prepare を暗記した順序で手打ちする儀式になっている。record の kind ごと上書きや review lifecycle の agent-id ズレなど、手順の罠も operator 側に露出している。不足証跡を自動で取りに行く実行系 `vibepro pr autopilot` を追加し、人間の入力が本当に必要な判断点（waiver、split、レビュー verdict の裁定）でだけ停止するようにする。

## User Story

**As a** 実装を終えて PR を出したい VibePro ユーザー<br>
**I want** `vibepro pr autopilot --story-id <id>` が evidence-plan を読み、検証コマンド実行→証跡記録→CI 取り込み→レビュー dispatch 生成→ゲート再評価までを自動で進めること<br>
**So that** コマンド列を暗記せず、判断が必要な箇所だけに時間を使って `ready_for_pr_create` に到達できる

## Scope

- `vibepro pr autopilot [repo] --story-id <id>`: 直近の `pr prepare` の evidence-plan と blocked gates を読み、次を自動実行する — (1) 定義済み検証コマンドの実行と exit code に基づく verify record、(2) PR が存在する場合の `verify import-ci`、(3) review dispatch 指示の生成（`review prepare`）、(4) 各ステップ後のゲート再評価。
- 停止点: waiver 判断・split 判断・レビュー verdict の裁定・検証コマンド未定義のゲートでは、次に必要な入力と正確なコマンドを提示して停止する。
- 安全規則: 検証が fail した場合は fail のまま記録し、pass への昇格や再試行による揉み消しをしない。既存の本物の record をテスト実行で上書きしない。
- `--dry-run` で実行予定のステップ列を表示する。再実行は冪等で、充足済みのゲートをスキップする。
- 実行サマリーに、自動化されたステップ数と operator に残った判断点の一覧を出す。

## Acceptance Criteria

- [ ] EAP-S-1: 検証コマンドが定義済みの Story で `pr autopilot` を 1 回実行すると、手動の verify record なしで検証系ゲートが解消される。
- [ ] EAP-S-2: 検証コマンドが fail した場合、fail として記録され、autopilot は該当ゲートを未解消のまま停止点として報告する。
- [ ] EAP-S-3: waiver または split 判断が必要な状態では、autopilot は判断内容と実行すべきコマンドを提示して停止し、勝手に waiver を記録しない。
- [ ] EAP-S-4: 既存の passing record が存在する kind に対して、autopilot は上書き実行をしない。
- [ ] EAP-S-5: `--dry-run` は実際の記録を一切行わず、実行予定ステップ列を表示する。
- [ ] EAP-S-6: 2 回目の実行は充足済みステップをスキップし、同一の最終状態に収束する。
- [ ] EAP-S-7: テストで全充足 / fail 停止 / 判断点停止 / dry-run / 冪等の各分岐を固定する。

## 既存挙動（inherited behavior）

- Manual `verify record`, `verify import-ci`, and the review prepare/start/close/record lifecycle remain existing supported paths and are unchanged.
- Waiver recording semantics and critical-gate non-waivability are unchanged.
- Evidence-plan and gate evaluation logic in `pr prepare` are unchanged; autopilot is a consumer.

## Non Goals

- レビュー subagent の自動起動・自動 verdict（レビュー実行自体は coordinator の責務のまま）。
- 検証コマンドの自動推定（未定義なら停止点として人間に返す）。
- ゲート判定基準の変更。
