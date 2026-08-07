---
story_id: story-vibepro-conformance-delta-ledger
title: "conformance delta ledger — base/head差分でアーキテクチャ逸脱を再現可能に観測する"
status: active
view: dev
period: 2026-08
category: quality
parent_design: vibepro-conformance-delta-ledger
related_stories:
  - story-vibepro-import-based-conformance
  - story-vibepro-scanner-inconclusive-coverage
  - story-vibepro-senior-gap-judgment
reason:
  decision: "architecture conformanceを単発の件数スナップショットから、stable violation IDに基づくbase/head差分観測へ拡張し、pr prepareのshadow stage（info専用・非ブロック）として毎PRで実行・永続化する。スキャン不能はviolation 0ではなくinconclusiveとして記録する"
  alternatives: "最初からratchet gate（新規悪化block)を入れる案は、計測の再現性・base/head比較・統治ルールが未確立のままblockを導入すると誤ブロックと例外運用が先に固まるため採用しない（後続storyへ分離）。violation総件数を距離指標にする案は、軽微2件解消+重大逆転1件追加が『改善』に見える混同を起こすため採用しない。graphify callsエッジで判定する案はPR #387実測でノイズ過多が確定済みのため採用しない（import scan維持）"
  compatibility: "既存の vibepro architecture conformance コマンドの出力スキーマは維持し、violation id・delta・inconclusive・cycleを追加フィールドとして拡張する。target-model.json（2026-07-22裁定）は変更しない。senior-gap judgmentのideal_stateが読む conformance_summary の供給経路（.vibepro/architecture/conformance/conformance.json）は現行の読み取り契約のまま実データを供給する"
  rollback: "pr prepareのshadow stageはinfo専用ノードのため、stage登録を外すだけで従来のpr prepare挙動へ戻る。conformance CLIの追加フィールドは後方互換の追加であり、無視すれば従来スナップショット運用に戻る"
  boundary: "本storyはblockしない（ratchet gateは後続story）。target-modelの改訂・孤児の再割当・baseline裁定はしない（governance-rebaseline storyへ）。violationからのStory候補導出はしない（candidate-derivation storyへ）。merge後の再計測はしない（post-merge-reconciliation storyへ）。recorded evidence（review/verify record）を新設せずderive-onlyに留め、strict-head束縛の証跡を持ち込まない"
created_at: 2026-08-04
updated_at: 2026-08-04
---

# conformance delta ledger — base/head差分でアーキテクチャ逸脱を再現可能に観測する

## User Story

**As a** VibeProを「あるべき姿へ継続収束させる制御系」へ進化させたい開発者
**I want** すべてのPRで、裁定済みtarget architectureに対するbase/headの逸脱差分が、安定したviolation IDと多次元サマリーで自動観測・永続化されること
**So that** 「新規悪化」「解消」「既存負債」「測定不能」を混同せずに区別でき、後続のratchet gate・Refactoring Story導出・モデル再裁定が信頼できる計測土台の上に構築できる

## Context and Gap

- `docs/architecture/target-model.json` は2026-07-22に人間裁定済みだが、計測器 `vibepro architecture conformance` は手動・dry_runのまま誰も実行しておらず、実リポジトリに `.vibepro/architecture/conformance/conformance.json` が存在しない。その結果 senior-gap judgment の ideal_state は `conformance_summary: null` のまま全PRを判定している。
- 裁定から13日で、R-003凍結13ファイル中8ファイルが凍結行数を超過（pr-manager +873行等）し、孤児24ファイル・未宣言依存41件が蓄積した。観測されない理想は執行されないことが実証された。
- violation件数はHEADごとに 91 / 86 / 85 / 84 / 76 と揺れる（audit-artifacts実測）。件数スナップショットは固定baselineにできず、base/headの再現可能な差分証跡が必要。
- `vibepro check architecture .` はdirty実環境（`.claude/worktrees/` 27万ファイル）でスキャナがクラッシュした実績があり、スキャン不能が「違反0」と区別されない計測は偽陰性を生む。

## Acceptance Criteria

- [ ] CDL-S-1: 各violationは、その要素自身の意味値（kind・from/to module・関与ファイル等）から決定論的に導出されるstable violation IDを持ち、配列順序・無関係な他violationの増減に影響されない。
- [ ] CDL-S-2: 同一commitを2回スキャンすると、violation ID集合・全次元カウントが完全一致する（再現性の回帰テストで証明）。
- [ ] CDL-S-3: base refとhead refを与えると、violation IDベースで new / resolved / unchanged に分類されたdeltaが得られる。
- [ ] CDL-S-4: サマリーは単一のviolation_countではなく、次元別に分離される: 新規違反（severity別）/ 解消 / 既存 / 孤児 / 予算超過 / モジュール循環依存 / inconclusive。
- [ ] CDL-S-5: スキャン失敗・対象ファイル0件・target-model欠落は、violation 0ではなく理由付きの `inconclusive` として記録される。
- [ ] CDL-S-6: モジュールレベルの循環依存（import edgeの有向閉路）が独立次元として検出される。
- [ ] CDL-S-7: pr prepareにshadow stageが追加され、base/head deltaを実行し `.vibepro/architecture/conformance/` 配下へ永続化し、info専用のgateノード（block/needs_reviewに遷移しない）としてgate DAGサマリーに載る。senior-gap judgmentのideal_stateはnullではなく実conformance_summaryを受け取る。
- [ ] CDL-S-8: shadow stageはderive-only（実行のたびに再計算）であり、recorded evidenceを新設しない。無関係なdocs-only commit後のpr prepare再実行で、本stageに起因するstale化・needs_verification転落が発生しないことを回帰テストで証明する。

## Inherited Behavior

- import scanによる依存判定（PR #387: graphify callsエッジのノイズ実測に基づく決定）を維持する。
- `vibepro architecture conformance` の既存出力スキーマ・`--strict` フラグ・graph.json任意文脈の扱いを維持する。
- senior-gap judgmentの `loadTargetArchitectureContext` の読み取り契約（model + conformance.jsonのsummary）を維持する。

## Non Goals

- 新規悪化のblock（ratchet gate）。後続story。
- target-modelの改訂・孤児の再割当・既存負債baselineの裁定。後続のgovernance-rebaseline story。
- violationクラスタリングとRefactoring Story候補導出。後続story。
- merge後の再計測とbaseline更新。後続story。
- graphify callsエッジによる依存判定の復活。

## 初期タスク

1. Stable violation identity + reproducibility
   - violation IDを要素自身の意味値から導出（グループ序数・配列indexを使わない）
   - 同一commit二重スキャンの同一性回帰テスト
2. Delta computation + multi-dimensional summary
   - base/head二点計測とID差分による new / resolved / unchanged 分類
   - 次元別サマリー（severity別新規・解消・既存・孤児・予算・循環・inconclusive）
   - モジュール循環検出
3. Inconclusive semantics
   - スキャナ例外・対象0件・model欠落を理由付きinconclusiveへ
4. pr prepare shadow stage
   - derive-onlyのinfo専用stage追加、artifact永続化、senior-gapへのconformance_summary供給
   - docs-only commit再実行のstale非発生テスト
