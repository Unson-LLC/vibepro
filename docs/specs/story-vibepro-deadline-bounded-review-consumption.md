---
story_id: story-vibepro-deadline-bounded-review-consumption
title: aggregateDeliveryMetrics deadline-bounded attribution Spec
status: active
parent_design: vibepro-deadline-bounded-review-consumption
---

# aggregateDeliveryMetrics deadline-bounded attribution Spec

正本のSpec artifactは `.vibepro/spec/story-vibepro-deadline-bounded-review-consumption/spec.json`
（clauses: INV-001 / S-001 / S-002 / INV-002 / C-001 / C-003 / S-003 / INV-003 / S-004、
diagrams: flow / threat_model）。
clause idは `vibepro spec write` が入力idを安定化した結果であり、以下では入力時のAC対応名（DBA-S-1〜DBA-S-8）を
括弧で併記する（S-004はacceptance_criteria起源ではないため対応するDBA-S番号を持たない）。
本ファイルはDesign SSOTのlineage束縛用のspec pointerであり、Storyの受け入れ基準・
Inherited Behavior・却下した代替案は
`docs/management/stories/active/story-vibepro-deadline-bounded-review-consumption.md` を、
設計判断の詳細は `docs/architecture/vibepro-deadline-bounded-review-consumption.md` を参照する。

## Contract Summary

- INV-001 (DBA-S-1): `close_reason === 'completed'` の `reviews[]` 項目は、`timeout_ms` を超過していても
  `resolveConsumptionCharge` が `duration` をそのまま返し、常に全区間を計上する（bound対象外）。
- S-001 (DBA-S-2): `close_reason` が `'completed'` 以外（`timeout` / `replaced` / `manual_shutdown` /
  未知値を含む）で `timeout_ms` が有限の正数の場合、`boundAgentConsumption` が
  `charge = min(duration, timeout_ms)` を計上し、超過分 (`duration - charge`) を `deadline_excluded_ms` に、
  件数を `deadline_excluded_count` に加算する。
- S-002 (DBA-S-3): `timeout_ms` が欠落・`null`・`NaN`・非数値文字列・0・負数のいずれかの場合、`close_reason` に
  関わらず `resolveConsumptionCharge` は全区間を返す（新フィールドを渡さない既存呼び出しの後方互換）。
- INV-002 (DBA-S-4): `review_wait_ms` / `subagent_wall_clock_ms` は本Storyの前後で `unionDuration(intervals)` の
  ままであり、`agent_consumption_ms` にのみ適用される deadline bound の対象にならない。
- C-001 (DBA-S-5): `src/agent-review.js` の `authorizeAgentReviewDispatch` と `src/pr-manager.js` の
  `buildDeliveryEfficiencyContext` は、どちらも `reviews[]` 構築時に lifecycle entry の `close_reason` /
  `timeout_ms` をそのまま渡すよう変更されており、`aggregateDeliveryMetrics` 自身の呼び出しシグネチャは
  変わらない。
- C-003 (DBA-S-6): `aggregateDeliveryMetrics` の戻り値に `deadline_excluded_ms`（束縛された全項目の除外
  ミリ秒合計）と `deadline_excluded_count`（束縛された件数）が追加され、両方とも `agent_consumption_ms` が
  `null`（review timing不完全）の場合に限り `null` になり、それ以外は数値になる。`withDeadlineExclusionVisibility`
  （`src/agent-review.js`）が両フィールドを dispatch decision の `budget` オブジェクトへ運び、`pr prepare` が
  それを `gate_dag.summary.efficiency_debt.metrics` と `--summary-json`/`--view blocking-gates`/
  `--view gate-evidence` の正規LLM投影の両方へ伝播させるため、効率性レポートと dispatch decision evidence が
  除外量を黙って落とすことはない。`story-run-portfolio.js` が永続化する `cost_attribution` 形状は意図的に
  この2フィールドを持たない: Portfolio state はgit-ignoredのclosed-schema artifact（`validateState` の
  `hasExactKeys(cost, COST_KEYS)`）であり、フィールドを追加すると rollback の非対称性を生むが、この節が
  要求する可視性保証はそれを必要としない — `gate_dag.summary` と dispatch-decision `budget` オブジェクトは
  `story-run-portfolio.js` を経由せず既に両フィールドを運んでいるため。
- S-003 (DBA-S-7): `story-vibepro-content-scoped-evidence-reuse-key` の実 lifecycle 記録（10件、全件
  `timeout_ms=600000`、9件 `close_reason=completed`、1件 `close_reason=timeout` で 7,017,457ms）を
  そのまま入力とすると、`agent_consumption_ms` は 11,073,531 から 4,656,074 へ縮み、
  `deadline_excluded_count` は `10` ではなく `1` になる（count × timeout_ms への退化がないことの実測証拠）。
- INV-003 (DBA-S-8): `evaluateDeliveryBudget` の `budget_exceeded` fail-closed 停止経路
  （`throwReviewDispatchStop`）と `budget-override-authority.js` の human-only grant 要件
  （`grantor_kind: human` 必須・自己承認拒否・digest 束縛）は本Storyで変更されない。
- S-004: `REVIEW_CLOSE_REASONS`（`completed`/`timeout`/`replaced`/`manual_shutdown`）の4終端状態のうち、
  `resolveLifecycleEffectiveStatus` が扱う状態遷移として `aggregateDeliveryMetrics` が deadline bound の
  対象にするのは `completed` 以外の3状態だけであり、`completed` への遷移が bound で縮められることはない
  （DBA-S-1/DBA-S-2のstate-transition言い換え、専用ACなし）。

## Public Contract Delta (for gate:judgment_axis_public_contract)

このStoryが公開面（モジュール外部から見える契約）に与える変更点を明示する。

1. **新規exportの追加はない**: 本Storyが追加する3関数（`boundAgentConsumption` / `resolveConsumptionCharge`
   / `withDeadlineExclusionVisibility`）はいずれも非exportのモジュール内部ヘルパーであり、`export` された
   関数は既存の `aggregateDeliveryMetrics` のみで変わらない。
2. **`aggregateDeliveryMetrics` の入力契約は後方互換に拡張**: `reviews[]` の各要素は `close_reason` /
   `timeout_ms` という2つのoptionalフィールドを新たに受け付けるが、どちらも渡さない既存呼び出し
   （`story-run-portfolio.js` の `mergeCostAttribution` 経由を含む）は S-002 (DBA-S-3) のフォールバックにより
   旧来どおり全区間合算のまま動作する。
3. **`aggregateDeliveryMetrics` の出力契約は後方互換に拡張**: 戻り値に `deadline_excluded_ms` /
   `deadline_excluded_count` という2つの新規フィールドが追加されるのみで、既存フィールド
   （`agent_consumption_ms` / `review_wait_ms` / `subagent_wall_clock_ms` 等）の意味・型・null判定条件
   （`hasCompleteReviewTiming` の `.every()` ゲート）は変更していない。
4. **呼び出し側2箇所は素通し配線のみ**: `authorizeAgentReviewDispatch` と `buildDeliveryEfficiencyContext` は
   `reviews.push`/`map` の対象オブジェクトに2フィールドを追加するだけで、`min(duration, timeout_ms)` の判断
   ロジック自体は複製していない（C-001/DBA-S-5）。

## Traceability

各節は下表のAC/clauseに対応する。証跡の記録（`vibepro verify record`/`verify run`）は本Story doc/Spec doc
の記述対象外であり、別途オペレーターが行う。

| AC | Spec clause | 要旨 |
|----|-------------|------|
| DBA-S-1 | INV-001 | completed lifecycleは常に全区間計上（bound対象外） |
| DBA-S-2 | S-001 | completed以外 + timeout_ms有限 → `min(duration, timeout_ms)` |
| DBA-S-3 | S-002 | timeout_ms欠落・非有限 → close_reason不問で全区間（後方互換） |
| DBA-S-4 | INV-002 | review_wait_ms/subagent_wall_clock_msはunionDurationのまま不変 |
| DBA-S-5 | C-001 | 呼び出し側2箇所がclose_reason/timeout_msを素通し配線 |
| DBA-S-6 | C-003 | deadline_excluded_ms/countの戻り値追加とdispatch evidence/gate_dag.summaryへの伝播（story-run-portfolio.jsは対象外） |
| DBA-S-7 | S-003 | 実10件ledgerで11,073,531→4,656,074、excluded_count=1の回帰証明 |
| DBA-S-8 | INV-003 | budget fail-closed停止とhuman-only override要件は不変 |
| — | S-004 | close_reasonの4終端状態のうちcompleted以外の3つだけがdeadline bound対象（専用ACなし） |
