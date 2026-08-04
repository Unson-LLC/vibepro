---
story_id: story-vibepro-pr-human-summary-dead-chain-removal
title: 死んだ人間向けPRサマリーレンダラーチェーンを削除する
status: active
area: pr-readiness
reason: |
  Alternatives: (1) renderPrDecisionSection を renderPrBody へ再配線して人間向け判断セクションを復元する（coordinating sessionの当初推奨）— 却下。現行のconcise本文契約はPR #228以降テストで固定されており、`Engineering Judgment:` の本文出現そのものを禁止（test/vibepro-cli.test.js の concise body 契約）、判断過程narrativeの `#### 共通spineの確認` を禁止（test/risk-adaptive-gate.test.js）、suppressed axis詳細（`suppressed=` / `suppressed_candidates:`）を禁止（test/engineering-judgment-activation-precision.test.js。#228がmatch→doesNotMatchへ意図的に反転）し、本文20KB上限とセクション順序も固定している。dead chainの固有内容は大半がこの契約で禁止されるか、既にconcise本文（分割判断・Gate状況・Scope判断・実装/テストリンク・Story解釈）または review-cockpit.html / gate-dag.html（人間向けcontrol plane）に存在する。再配線は「復元」ではなく、より新しくテストで裏付けられた設計決定の巻き戻しになる。(2) 一部だけ（証跡ダイジェスト等）を圧縮再配線 — 却下。契約適合部分は既存本文と重複し、新規価値がartifact表面との二重管理コストを下回る。
  Compatibility: 削除対象は全てproduction呼び出し元ゼロ（story-vibepro-uiux-intake-gate-pr-summary-surfaces の3独立レビューと本Storyのcall graph再確認で確認済み）。実行時挙動・生成artifact・pr-body.md出力は変化しない。exported関数 renderPrGateSummary / buildHumanEvidenceDigest はテストのみが参照しており、当該テストも本Storyで削除する。
  Rollback: 単一commitのrevertで全関数とテストが復元される。データ・schema・artifact形式の変更なし。
  Boundary: src/pr-manager.js の未参照レンダリング関数群と、その契約を固定していた2テストファイルのみ。live表面（renderPrBody、gate-dag/review-cockpit生成、gate評価・readiness判定）は不変更。共用helper（collectSuppressedJudgmentAxes / buildHumanSplitDigest / formatHumanGateSummary / summarizePrGateReason / collectContractDocFiles / collectCapabilityFiles 等、liveな呼び出し元を持つもの）は削除しない。
---

# 死んだ人間向けPRサマリーレンダラーチェーンを削除する

## Problem

PR #228「render concise VibePro PR bodies」で `renderPrDecisionSection` と `renderPrGateSummary` の呼び出し元が本文レンダリングから除去されて以降、人間向けPRサマリーの2系統はproduction未参照のdead codeとして残っている（story-vibepro-uiux-intake-gate-pr-summary-surfaces の3独立レビューで確認済み）。PR #416 はcuratedラベル一覧を実gateノード集合へ揃えたが、再配線可否を本Storyで判定した結果、現行のconcise本文契約（`Engineering Judgment:` 出現禁止・判断narrative禁止・suppressed詳細禁止・20KB上限）が再配線内容を明示的に排除しており、同内容は review-cockpit.html / gate-dag.html が人間向け正本として提供している。よって dead chain は復元先を持たず、削除して迷いの原因（将来の再配線期待・二重curation負担）を除去する。

削除対象（全てproduction呼び出し元ゼロ、chain内相互参照のみ）:

- `renderPrDecisionSection` とその専用helper: `buildHumanMergeDecision` / `buildHumanReviewQuestion` / `formatPrRouteForHuman` / `formatEngineeringJudgmentForHuman`
- `renderEngineeringJudgmentReasoning` とその専用helper: `collectEngineeringJudgmentRouteGates` / `buildJudgmentAxisReasoning` / `buildCommonSpineReasoning` / `formatEvidenceArtifactSuffix` / `formatEngineeringJudgmentGateForHuman` / `describeEngineeringJudgmentGate` / `buildEngineeringSignalDigest` / `describeEngineeringSignal` / `buildEngineeringEvidenceReasoningDigest` / `buildEngineeringMergeBoundary`
- `renderHumanDecisionGraph` とその専用helper: `buildHumanDecisionFileLinks` / `formatGithubFileLink` / `githubRepositoryUrl` / `encodePathForGithub` / `buildHumanChangeIntent` / `buildHumanEvidenceDigest`（export）
- `renderPrGateSummary`（export）
- 上記2 exportの契約を固定していたテスト: `test/pr-human-summary-uiux-intake-gate.test.js` / `test/e2e/story-vibepro-uiux-intake-gate-pr-summary-surfaces-main.test.js`

## Acceptance Criteria

- src/pr-manager.js に上記関数の定義・参照が残らず、`renderPrGateSummary` / `buildHumanEvidenceDigest` はモジュールからexportされない。
- liveな呼び出し元を持つ共用helper（`collectSuppressedJudgmentAxes` / `buildHumanSplitDigest` / `formatHumanGateSummary` / `summarizePrGateReason` / `isUnresolvedGateStatus` / `collectContractDocFiles` / `collectCapabilityFiles` / `buildPrimaryReviewAreas` / `formatPrStoryLabel` / `buildScopeDecisionNote` / `summarizeBlockerWaiverMissingFields`）は削除されず、既存テストが通る。
- pr prepare が生成する pr-body.md のconcise契約（セクション順序・禁止文字列・20KB上限）は変化しない（既存の contract テストがそのまま通ることで担保）。
- 削除された2 export を参照するテストは残らない。

## Out of Scope

- concise本文契約そのものの変更（セクション追加・削除）。
- `formatEvidenceReferenceForHuman`（独立して未参照だが、確認済みdead chainの外にあるため別Storyで扱う）。
- review-cockpit.html / gate-dag.html 側の表示強化。
