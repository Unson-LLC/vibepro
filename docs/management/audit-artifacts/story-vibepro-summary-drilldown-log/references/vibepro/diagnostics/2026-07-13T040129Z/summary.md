# VibePro 診断サマリー

| 項目 | 内容 |
|------|------|
| Run ID | 2026-07-13T040129Z |
| Story | summary-first と深掘り理由の記録 |
| Story ID | story-vibepro-summary-drilldown-log |
| 診断フェーズ | pre_implementation |
| VibePro Runtime | vibepro@0.1.0-beta.0 commit=9570218c667a dirty=true |
| 種別 | unknown |
| 描画方式 | - |
| 適用チェック | secrets, xss, dependency-graph, code-quality |
| graphify nodes | 4108 |
| graphify edges | 9097 |
| 共通スキャン対象 | 2996件 |
| 秘密情報候補 | 1071件 (block: 0件, review: 0件, info: 1071件) |
| XSSリスク候補 | 215件 (block: 0件, review: 0件, info: 215件) |
| UI旧トークン候補 | 0件 (block: 0件, review: 0件, info: 0件) |
| UI操作信頼性候補 | 0件 (block: 0件, review: 0件, info: 0件) |
| UIコンポーネント種別 | - |
| Gesture Interaction Gate | not_generated |
| Gesture Interaction候補 | 0件 (block: 0件, review: 0件, info: 0件) |
| Terminal Link契約 | ok |
| Terminal Link候補 | 0件 (block: 0件, review: 0件, info: 0件) |
| Flow Design Gate | pass |
| Flow Design UI走査 | 0件 |
| Flow Design検出候補 | 0件 |
| 重いdev script候補 | 0件 (block: 0件, review: 0件, info: 0件) |
| runtime probe plan | available (1 commands) |
| DB未ページング候補 | 0件 (block: 0件, review: 0件, info: 0件) |
| 認可前bulk DB候補 | 0件 (block: 0件, review: 0件, info: 0件) |
| 重複query形状候補 | 0件 (block: 0件, review: 0件, info: 0件) |
| 責務混在候補 | 21件 (block: 0件, review: 21件, info: 0件) |
| リファクタリング機会 | 21件 |
| リファクタリングcampaign | 2件 |
| API route | 0件 |
| Network Contract | pass |
| API client call | 0件 |
| API route欠落 | 0件 |
| Requirement Gate | pass |
| 要件不変条件 | 8件 |
| シナリオ確認候補 | 0件 |
| 要件矛盾候補 | 0件 |
| Performance Metrics | 0件 |
| Performance Comparable | 0件 |
| Performance Unknown | 0件 |
| 検出事項 | 1件 |

## アーキテクチャView

| View | 判定 |
|------|------|
| Structure | - |
| Runtime | 0 entrypoints |
| Data | - |
| Security | 0 auth boundaries, 0 secret files |
| Deployment | - |
| Quality | .github/workflows/ci.yml, .github/workflows/codeql.yml, .github/workflows/npm-publish.yml |

## API境界

- api-boundary は適用されていない

## Network Contract

- Status: pass
- Routes: 0
- API client calls: 0
- Missing routes: 0
- Dynamic calls: 0
- Server function replacements: 0
- 問題なし

## ゲート状態

- production-readiness: needs_review - 文脈品質または適用チェックに確認が必要な項目がある

## Requirement Consistency

- Status: pass
- Invariants: 8
- Scenario Gaps: 0
- Contradictions: 0

## Flow Design

- Status: pass
- UI Files: 0
- Silent Noops: 0
- Selection Side Effects: 0
- Question Dead Ends: 0
- Dead UI States: 0
- Value Alignment: 0

## Performance Evidence

# VibePro Performance Evidence

Story: story-vibepro-summary-drilldown-log
Metrics: 0
Runs: 0
Comparable: 0
Not comparable: 0

- No performanceMetrics are defined for this story.


## 主な検出事項

- VP-ARCH-001: 責務が混在している大きなruntime file候補がある（Medium）

## 文脈品質ノート

- VP-GRAPH-002: 推論された依存関係がある（info）

## 診断レビュー

- Status: needs_review
- 未レビュー: 1件
- suggested implementation_gap: 1件
- suggested detector_gap: 0件
- 正本: finding-review.md と evidence.json の finding_review

## リファクタリング差分

- 前回の同一Story診断runがないため、差分は未算出

## 次アクション候補

| ID | 対応する検出事項 | 候補 | 対象 | Impact | Community | 読むファイル | 方針 |
|----|------------------|------|------|--------|-----------|------------|------|
| VP-ACTION-ARCH-001 | VP-ARCH-001 | responsibility split campaignをStory化する | 1件 | 0.0242 (220 edges) | 13(file: 1, node: 92, edge: 220) | src/session-efficiency-audit.js<br>src/cli.js<br>src/workspace.js | proposal_only / mutates_repository=false |

### 実装手順

#### VP-ACTION-ARCH-001: responsibility split campaignをStory化する

- 優先度: medium
- 理由: VP-CAMPAIGN-REF-001 は 1件の機会を束ねるStory候補。最初に VP-OPP-ARCH-018 を確認する。
- 読むファイル: src/session-efficiency-audit.js（リファクタリングcampaign VP-CAMPAIGN-REF-001 の対象ファイル）, src/cli.js（Graphifyで対象ファイルと直接つながる周辺ファイル）, src/workspace.js（Graphifyで対象ファイルと直接つながる周辺ファイル）, src/evidence-cost-budget.js（Graphifyで対象ファイルと直接つながる周辺ファイル）, src/merge-manager.js（Graphifyで対象ファイルと直接つながる周辺ファイル）

修正前ブリーフィング:
- リファクタリング機会: VP-OPP-ARCH-018 / responsibility_split
- Campaign: VP-CAMPAIGN-REF-001 / rank=1
- 推奨抽象化: runtime責務を境界ごとに分離する
- 対象ファイル: src/session-efficiency-audit.js
- 推奨方針: split-runtime-boundaries - 責務混在候補は重複削減より先に、認可、DB、検証、外部I/Oの境界を固定する価値が高い。
- 方針: 方針A: runtime責務をroute/action/service/helperへ分離する / 方針B: 外部I/Oや通知など副作用境界から切り出す

1. 現在の挙動を棚卸しする: 対象ファイルごとにquery条件、返却shape、fallback、例外処理、呼び出し元期待値を確認する。Graphifyの関連ファイルがある場合は先に呼び出し方向と共有hubを確認する。
2. 共通境界を決める: 同じ用途なら共通service/helper/repositoryへ集約する。複数communityに跨る場合は、共通化前にflow単位の責務差分をStory内で分ける。
3. 呼び出し元を置き換える: 既存の返却shapeを保ったまま、対象箇所を共通境界へ接続する。
4. 診断を再実行する: 型検査・関連テスト・VibePro診断で対象機会が減ったこと、Graphify上の影響範囲外を不用意に変更していないことを確認する。

完了条件:
- campaign内の機会がStory単位として実装順に並んでいる。
- 最初に直す機会と後続に回す機会の判断根拠がscore/reasonで説明できる。
- 修正後のVibePro診断で対象findingまたはopportunityの件数差分を確認できる。
- 混在していた責務が読み取れる単位へ分離されている。
- 既存テストまたは型検査で入出力互換性が確認されている。
- VibePro診断で責務混在候補の根拠が減っている。
