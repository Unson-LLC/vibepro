---
story_id: story-vibepro-scanner-inconclusive-coverage
title: Scanner Inconclusive Coverage Architecture
parent_design: vibepro-scanner-inconclusive-coverage
---

# アーキテクチャ

## 判断

スキャナ群は「findingsが積まれなければpass」という共通パターンを持ち、検査対象を1件も発見できなかった場合（フレームワーク規約外のリポジトリ、走査rootの不一致）でも `pass` を返す。2026-07-13インシデントではFlow Design GateがUI走査0件のままpassを表示し、「合格」が「検査した上で問題なし」と「何も見ていない」を区別できない状態がゲート不信を生んだ。

対策は判定語彙の分離であり、検出ロジックの変更ではない。共有ヘルパー `resolveScanConclusiveness` が「走査件数・findings・適用可否」から `pass / inconclusive / not_applicable` を決定し、各スキャナは走査実績（`scan_coverage`: 走査root一覧と発見件数）を結果に添付する。inconclusive導入は表示と機械可読状態の正直化が目的で、**本Storyでは非ブロッキング**とする（unresolved集計へ入れない）。ブロッキング化は誤検知率の実績を見てから別Storyで判断する——required gateの即時強制が全下流を壊すことは evidence adjudication gate 導入時のfixture連鎖修正で実証済みのため、段階導入を選ぶ。

**findingsベースの判定が常に優先される**: UI storyの走査0件は既存critical finding（FLOW-NO-UI-CODE）が従来どおり `block` を返し、この blocking 判定を新語彙が弱めることはない（`check --fail-on-findings` の exit code も従来どおり非0）。語彙の置換はfindingsが無く従来なら vacuum pass になっていた場合のみ行い、非UI storyの走査0件は理由付き `not_applicable`、適用対象の0件は `inconclusive` とする（無言のpassにしない）。

## 入力

- 各スキャナの走査実績: 発見ファイル数、走査したroot / glob、findings
- flow-design-scanner の `isUiStory` 判定（既存）
- network-contract-scanner の候補ファイル走査数（routes + client callサイト）
- regression-risk-scanner のテストファイル発見数

## 出力

- スキャナ結果の `status` 語彙拡張: `inconclusive`（適用対象だが走査0件）/ `not_applicable`（適用外かつ走査0件、理由付き）。走査1件以上の従来判定（pass / fail / block / needs_review）は不変
- 各スキャナ結果への `scan_coverage: { scanned_count, roots }` 添付
- story diagnose summary / check packs 表示での区別（inconclusiveは「検査対象を発見できなかった＝合格ではない」と明示）
- `src/scan-status.js` の `resolveScanConclusiveness`（後続スキャナへの展開を可能にする共有実装）

## 境界

- inconclusiveはgate_dagのunresolved集計に入れない（非ブロッキング。既存のready判定・既存fixtureを変えない）
- check-packの集計statusは非failing扱いを維持するが、`inconclusive_count` を集計結果へ添付し、機械消費者が「未検査込みのpass」を区別できるようにする（明示的な設計判断）
- 既存のblock / fail / needs_review判定ロジックは変更しない（0件時の語彙分離のみ）
- UI root規約の拡張（Next.js以外の自動検出）は扱わない。walk対象は既存の `flow_design` 設定で上書き可能
- 対象は flow-design / network-contract / regression-risk の3スキャナ。他スキャナへの展開は共有ヘルパー経由の後続Story
