---
story_id: story-vibepro-scanner-inconclusive-coverage
title: "検査対象を発見できなかったスキャナ結果をpassとして扱わない（inconclusive第3状態の導入）"
view: dev
period: 2026-07
source:
  type: incident-analysis
  id: VP-INCIDENT-2026-07-13-SALESTAILOR-BLUEPRINT-VACUUM-PASS
  title: "Flow Design GateがUI走査0件のままpassを返し、UIの構造問題を一切見ないまま合格扱いになった"
parent_design: vibepro-scanner-inconclusive-coverage
related_stories:
  - story-vibepro-evidence-adjudication-gate
  - story-vibepro-release-surface-guard
architecture_docs:
  - ../../../architecture/vibepro-scanner-inconclusive-coverage.md
spec_docs:
  - ../../../specs/vibepro-scanner-inconclusive-coverage.md
status: active
created_at: 2026-07-14
updated_at: 2026-07-14
---

# 検査対象を発見できなかったスキャナ結果をpassとして扱わない（inconclusive第3状態の導入）

## User Story

**As a** VibePro診断を成果物品質の判断材料にする運用者
**I want to** スキャナが検査対象を1件も発見できなかったとき、結果が `pass` ではなく「判定不能（inconclusive）」として区別されてほしい
**So that** 「証拠の不在」が「不在の証拠」として扱われるvacuum passを排除し、フレームワーク規約外のリポジトリで診断が空回りしていることに気づける

## 背景

2026-07-13 SalesTailor Blueprintインシデントで、Flow Design Gateは「UI走査ファイル0件」のまま
`pass` を返した。対象リポジトリは素のNode.jsでHTMLを生成する構成で、Next.js規約の
ディレクトリ（`app/`, `pages/`, `components/`等）にUIファイルが存在せず、スキャナは
何も検査していなかった。この「検査対象なし=問題なし」はスキャナ全般に共通する
`findings.length > 0 ? fail : pass` パターンの帰結であり、ゲートへの信頼を破壊する
（合格表示が「検査した上で問題なし」なのか「何も見ていない」なのか区別できない）。

対策は状態語彙の分離: findingsベースの判定（block / fail / needs_review / pass）が常に優先され、
走査0件でfindingsが無く従来 `pass` になっていた場合のみ **`inconclusive` / `not_applicable`** へ
置換する。UI storyでの0件は既存critical finding（FLOW-NO-UI-CODE）による `block` を弱めない。
inconclusiveは今回の導入では非ブロッキング（表示・機械可読状態の正直化が目的）。

## Scope

- 共有ヘルパー `resolveScanConclusiveness`（新規 `src/scan-status.js`）: `{scanned_count, findings, applicable}` から `pass | inconclusive | not_applicable` と scan_coverage（走査root・発見ファイル数）を決定する
- `flow-design-scanner`: findingsベースの判定が常に優先される。UI storyの走査0件は既存critical finding（FLOW-NO-UI-CODE）による `block` を従来どおり維持し、findingsが無く `pass` になる場合のみ語彙を置換する（非UI storyの0件は明示 `not_applicable`、適用対象でfindingsなしの0件は `inconclusive`）。走査root一覧と件数を `scan_coverage` として結果に含める
- `network-contract-scanner`: ルート・クライアント呼び出しの候補ファイルが1件も走査できなかったとき `inconclusive`（既存のblock判定は維持）
- `regression-risk-scanner`: call graphで評価可能なmodule（scored modules）が0件のとき `inconclusive`（coverage不在時の既存degrade/skippedは不変）
- 診断summary（story diagnose）とcheck packsの表示で `inconclusive` を `pass` と区別して表示する（「検査対象を発見できなかった＝合格ではない」を明記）
- inconclusiveは本Storyでは非ブロッキング（unresolved扱いにしない）。ブロッキング化は採用実績を見て別Storyで判断する

## 非目標

- inconclusiveのブロッキング化（gate_dagのunresolved集計への追加）
- Next.js以外のフレームワーク規約の検出追加（UI root設定の拡張は既存 `flow_design` 設定で可能）
- 対象3スキャナ以外（oss-readiness / public-discovery / self-dogfood等）への展開（同ヘルパーで後続展開可能にするのみ）
- 既存のblock / fail判定ロジックの変更（0件時の語彙分離のみ）

## 受け入れ基準

- [ ] `resolveScanConclusiveness` は、走査0件かつ適用対象なら `inconclusive`、走査0件かつ適用外なら `not_applicable`、走査1件以上かつfindingsなしなら `pass` を返す
- [ ] flow-design-scannerはUI走査0件のとき `pass` を返さない: UI storyなら既存critical finding（FLOW-NO-UI-CODE）による `block` を維持し、非UI storyなら理由付き `not_applicable` になる
- [ ] flow-design-scannerの結果に走査root一覧と発見ファイル数を含む `scan_coverage` が入る
- [ ] UIファイルを1件以上走査しfindingsが無い場合は従来どおり `pass` になる（既存挙動の回帰なし）
- [ ] network-contract-scannerは候補ファイル走査0件のとき `inconclusive` になり、client呼び出し欠落の既存 `block` 判定は変わらない
- [ ] regression-risk-scannerはcall graphで評価可能なmodule（scored modules）が0件のとき `inconclusive` になる
- [ ] story diagnoseのsummary表示はinconclusiveをpassと区別し「検査対象を発見できなかった」ことを明示する
- [ ] inconclusiveはgate_dagのunresolved集計に入らず、既存のready判定を変えない（非ブロッキング）
- [ ] 既存テストが全てpassし、Next.js規約リポジトリの走査結果（pass/fail/block）は変化しない
- [ ] テストは「3状態の分離」「UI story 0件のinconclusive+critical維持」「非UI story 0件のnot_applicable」「走査ありpassの回帰」「network/regressionの0件inconclusive」「表示の区別」を含む

## 検証メモ

証拠記録では自動テストで検証した事実のみをverify recordへ記録する。裁定は独立fresh context
subagentへdispatchする。
