---
story_id: story-vibepro-gate-outcome-roi-ledger
title: "ゲートのブロック結末を分類記録し、ゲートごとの精度をデータで判定可能にする"
status: active
view: dev
period: 2026-07
source:
  type: operator_feedback
  title: "70 超のゲートのうち、どれが本物の欠陥を止め、どれが文言修正と waiver しか生んでいないかのデータが存在しない"
related_stories:
  - story-vibepro-verification-evidence-roi
  - story-vibepro-subagent-roi-audit
  - story-vibepro-usage-report
  - story-vibepro-ci-evidence-fast-lane
spec_docs:
  - docs/specs/story-vibepro-gate-outcome-roi-ledger.md
parent_design: vibepro-gate-outcome-roi-ledger
created_at: 2026-07-05
updated_at: 2026-07-05
---

# Story

運用方針は「1 ゲートずつ計測して育てる」だが、ゲートがブロックした後に何が起きたか（実コードが直ったのか、証跡の書き直しだけで解けたのか、waiver されたのか）は記録されていない。このため fast lane の拡張対象や advisory→enforce 昇格の判断が勘に依存している。ゲートごとのブロック→解消の結末を分類して台帳化し、usage report でゲート精度（実修正率・文言解消率・waiver 率)を集計できるようにする。

## User Story

**As a** VibePro のゲート構成を育てる開発者<br>
**I want** 各ゲートの blocked→resolved 遷移が「コード修正 / 証跡追加 / 記述修正のみ / waiver」のいずれで解消されたか分類記録され、ゲート別に集計されること<br>
**So that** 誤検知製造機になっているゲートの降格・修正と、fast lane 拡張・enforce 昇格の判断をデータで行える

## Scope

- 記録: ゲートが blocked/needs_* から解消されたとき、解消区分を台帳に記録する。区分は (a) source_fix（解消コミットに source 変更が含まれる）、(b) evidence_added（新規の検証・レビュー証跡で解消）、(c) rewording_only（story/spec/summary 等の記述変更のみで解消）、(d) waiver。
- 自動分類: (a)(b)(d) は解消時点の diff と証跡・decision record から機械的に判定する。判別不能な場合は unclassified として残し、operator が `--outcome` で上書きできる。
- 集計: usage report にゲート別の解消区分分布（期間指定つき）を追加する。rewording_only 率が高いゲートを降格候補として一覧化する。
- 台帳は計測専用とし、新しいブロック条件を一切追加しない。
- ベースライン: 導入時点から Story 1 本あたりの blocked 発生数と解消区分を蓄積し、fast lane / enforce 判断の事前宣言目標に使える形で出力する。

## Acceptance Criteria

- [ ] GRL-S-1: source 変更を含むコミットで解消されたゲートは source_fix として台帳に記録される。
- [ ] GRL-S-2: 記述変更のみで解消されたゲートは rewording_only として記録される。
- [ ] GRL-S-3: waiver で解消されたゲートは waiver として記録され、decision record と相互参照できる。
- [ ] GRL-S-4: 判別不能ケースは unclassified となり、operator の明示指定で上書きできる。
- [ ] GRL-S-5: usage report にゲート別の解消区分分布と降格候補（rewording_only 率上位）が表示される。
- [ ] GRL-S-6: 台帳の導入によって新たに blocked になるゲートが存在しない（計測専用であることをテストで固定する）。
- [ ] GRL-S-7: テストで各解消区分の自動分類・上書き・集計表示を固定する。

## 既存挙動（inherited behavior）

- Gate evaluation, activation conditions, and blocking semantics are unchanged; the ledger is measurement only.
- Waiver recording via decision records is unchanged; the ledger references existing records without altering them.
- Usage report existing sections and their e2e-tested next_command strings are unchanged; the ledger adds a new section only.

## Non Goals

- 集計結果に基づくゲートの自動降格・自動 fast lane 化（判断は人間が行い、変更は個別 Story で実施する）。
- ストーリー横断の工数・トークンコスト計測（session-efficiency-audit 系の責務）。
- 過去 Story への遡及分類。
