---
story_id: story-vibepro-gate-outcome-classification-coverage
title: Gate解消時のoutcome分類を閉じてROI台帳のunclassifiedを削減する
status: active
view: dev
period: 2026-07
category: quality
source:
  type: operator_feedback
  title: "gate ROI台帳692件中654件(94.5%)がunclassifiedで、Gateが本質修正を生んだのか紙作業だけ課したのか判定できない"
related_stories:
  - story-vibepro-gate-outcome-roi-ledger
  - story-vibepro-roi-measurement-loop-closure
  - story-vibepro-verification-evidence-roi
  - story-vibepro-usage-report
pr_scope_strategy: atomic_single_pr
pr_scope_reason: "The four surfaces form one indivisible loop: derive the outcome at record time, prompt for the undecidable remainder, let the operator answer it, then measure the residue. Shipping any half leaves the loop inert, because a classifier with no input path still accumulates unclassified entries and an input path with no classifier has nothing to answer. The misc-follow-up lane is the generated CLI reference, which scripts/generate-cli-reference.mjs emits from src/cli.js and test/cli-reference-docs.test.js enforces as non-stale, so splitting it out would make the runtime-behavior lane fail its own suite. The e2e-gate lane replays the same loop through the shipped binary and asserts the runtime lane's behaviour, so it cannot precede or follow it as a separate PR. The repo-control lane is workflow bookkeeping with no runtime dependency in either direction: it only flips brainbase.current_story_id, which no source file reads; it is declared as a facet because merging carries that default Story selection onto main."
pr_scope_review_facets:
  - requirements-ssot
  - runtime-behavior
  - e2e-gate
  - misc-follow-up
  - repo-control
pr_scope_dependency_boundaries:
  - "requirements-ssot -> runtime-behavior"
  - "runtime-behavior -> e2e-gate"
  - "runtime-behavior -> misc-follow-up"
  - "runtime-behavior -> repo-control"
reason: "alternatives considered: leave --outcome as an optional manual override (status quo keeps 94.5% unclassified), classify everything manually at monthly tuning (does not scale and loses context), or derive the classification deterministically at resolution time from diff/evidence/waiver records and demand explicit input only for genuinely ambiguous cases; selected deterministic-first classification. compatibility impact: ledger schema and the existing outcome vocabulary (source_fix/evidence_added/rewording_only/waiver) are unchanged; unclassified remains a valid legacy value. rollback plan: revert the classifier and the pr prepare prompt path in one commit; ledger entries written with classifications remain valid. boundary and scope: classification at recording time only; central-ledger promotion stays owned by roi-measurement-loop-closure and gate tuning decisions stay human."
created_at: 2026-07-25
updated_at: 2026-07-25
---

# Gate解消時のoutcome分類を閉じてROI台帳のunclassifiedを削減する

## Background

`gate-outcomes` 台帳は blocked→resolved 遷移を記録するが、outcomeの分類は
`pr prepare --outcome` の任意上書きに依存しており、2026-07-01以降の692エントリ中
654件(94.5%)が `unclassified` のまま積まれている。この状態では
「どのGateが本物の欠陥を止め、どのGateが証跡の書き足しだけを課しているか」を
データで判定できず、Gateの降格・fast lane拡張の判断が体感頼みに戻る。

## User Story

**As a** Gate構成をデータで育てたいVibePro運用者
**I want** Gate解消の記録時に、diff・証跡・waiver記録から決定的に分類できるものは自動分類され、曖昧なものだけ明示入力を要求されてほしい
**So that** unclassifiedが静かに積み上がらず、Gate別のROI（実修正率・文言解消率・waiver率）が実データになる

## Acceptance Criteria

- [ ] GOC-S-1: Gate解消エントリの記録時に、解消前後のdiff有無・evidence追加有無・waiver記録から `source_fix` / `evidence_added` / `rewording_only` / `waiver` を決定的に導出できる場合は自動付与される。
- [ ] GOC-S-2: 決定的に導出できない場合、`pr prepare` は分類の明示入力を `next_command` として提示し、無応答のまま `unclassified` が新規に積まれる件数を可視化する。
- [ ] GOC-S-3: `usage report --gate-roi` がgate別・story別のunclassified率を出力し、閾値超過を `value_signals` へ載せる。
- [ ] GOC-S-4: 台帳schemaと既存outcome語彙は変更せず、`roi-measurement-loop-closure` の中央台帳昇格契約にも変更を要求しない。

## Non Goals

- Gateの降格・enforce昇格の自動実行（判断は月次チューニング定例の人間の責務）。
- 過去エントリの遡及再分類（legacy `unclassified` はそのまま保持する）。
- 新しいoutcome語彙の追加。
