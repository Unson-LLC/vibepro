---
story_id: story-vibepro-execution-judgment-status-integrity
title: Execution and Judgment Status Integrity Architecture
---

# Architecture

## Decision

VibeProの status surface は、artifact の存在より楽観的な phase/status を表示してはいけない。
そのため execution state、review summary lifecycle、judgment axis status を
「別々に都合よく推定する」のではなく、共通の artifact facts から再計算する。

## Execution / Review SSOT

- execution state は `pr-prepare.json`, `pr-create.json`, `pr-merge.json`,
  `review-summary.json`, `verification-evidence.json` を読む派生viewである。
- merge 済みなら、PR作成と merge readiness を逆算して `pending` を残さない。
- review summary lifecycle は `lifecycle.json` が正本だが、
  review result が closed provenance を持つのに lifecycle entry が無い場合は、
  current result と矛盾しない synthesized closed entry を補う。

## Judgment Axis Strictness

- axis status は `matched_evidence`, `missing_evidence`, accepted decision の3点から決まる。
- 一部の required evidence が揃っていても、missing が残る限り `active_passed` にしない。
- `active_accepted_followup` は「accepted decision があり、なおかつ不足分が今の安全性を壊さない」と表明できる場合だけに使う。

## Invariants

- merged Storyの state surface は、未完了 node を見せない。
- review provenance が strong/closed なら、summary lifecycle もそれを否定しない。
- judgment axis の human-readable surface と machine-readable gate status は同一ロジックを使う。
