---
story_id: story-vibepro-ci-evidence-fast-lane
title: "CI結果のevidence再利用とrisk-tiered fast laneで監査固定費を変更リスクに比例させる"
view: dev
period: 2026-06
source:
  type: cost-audit
  id: VP-COST-AUDIT-2026-06-12-AUDIT-OVERHEAD
  title: "story 2-4 実測で監査固有コストが全体の3-4割・ほぼ固定費。小変更では実装1:監査9に逆転する"
related_stories:
  - story-vibepro-verification-observation-artifacts
  - story-vibepro-engineering-judgment-surface-evidence
architecture_docs:
  - ../../../architecture/vibepro-ci-evidence-fast-lane.md
spec_docs:
  - ../../../specs/vibepro-ci-evidence-fast-lane.md
status: active
created_at: 2026-06-12
updated_at: 2026-06-12
---

# CI結果のevidence再利用とrisk-tiered fast laneで監査固定費を変更リスクに比例させる

## User Story

**As a** VibePro フローで日常的に出荷する開発者（人間・エージェント）
**I want to** CI が同じ HEAD で実行したテスト結果を verification evidence として再利用し、低リスク変更では review subagent を求められないでほしい
**So that** 監査コストが変更リスクに比例し、1行修正でも品質保証を落とさずにフローを通せる

## 背景

2026-06-12 のセルフドッグフード実測（PR #177〜#179）で、story サイクル 24〜37分のうち
監査固有コストは約3〜4割、その内訳の最大要素は2つだった:

1. **フルスイートの三重実行**: 証跡用ローカル1回 + レビュー前確認1回 + CI（node 20/22）2回。
   1回約3分 × 重複分 ≒ story あたり約10分が純粋な重複。
2. **一律の review subagent**: 変更の大小・リスクに関わらず 3〜6分 + 約10万トークン。
   実測4回の review は blocking finding 0件で、実装を変えさせたのは安価な gate 側だった。

監査コストはほぼ固定費のため、変更が小さいほど比率が悪化する（1行修正なら実装1:監査9）。
品質装置を外すのではなく、**証拠の同一性**（同じテストを CI が同じ HEAD で実行した事実）と
**リスク比例原則**（既存の surface/risk 判定）でコストを変更リスクに比例させる。

## Scope

- 新コマンド `vibepro verify import-ci` で、現在 HEAD に束縛された CI check 結果を verification evidence として取り込む
- pr prepare の gate 判定で、低リスク変更の Agent Review Gate を typed N/A にする fast lane を追加する
- fast lane の適用を gate-dag / usage report 上で可視化する（silent にしない）

## 受け入れ基準

- [ ] `vibepro verify import-ci . --id <story-id> [--pr <number>]` が gh 経由で対象 PR / HEAD の check 結果を取得し、verification evidence として記録する
- [ ] import-ci は check の head SHA が現在 HEAD と一致する場合のみ受け入れ、不一致は記録せずエラー詳細を返す
- [ ] check の conclusion が success の場合のみ status pass として記録し、failure は pass として記録できない。pending / queued は記録せず「CI 未完了」を返す
- [ ] 取り込んだ evidence は取得した check rollup JSON を artifact として保存し、observation（check 名・conclusion・run URL・head SHA）を持ち、artifact_check が verified / observation_check が recorded になる
- [ ] check 名から kind へのマッピングはデフォルト（test* → integration）を持ち、`--check <name>=<kind>` で上書きできる。マッピングのない check は取り込まれず skipped として報告される
- [ ] CI evidence は generic command 規律の対象であり、フルスイート相当の CI 結果は judgment spine の focused 証拠としては加点されない（unit/integration verification gate の充足にのみ使える）
- [ ] fast lane: PR route が docs_only、または change risk profile が light かつ risk surface が空の場合、`gate:agent_review` が typed N/A（理由つき）となり、review subagent なしで ready_for_pr_create に到達できる
- [ ] fast lane は runtime / auth / security / workflow / api 等の risk surface が1つでも検出されたら適用されない
- [ ] fast lane の適用は gate-dag に専用ノード（fast_lane、typed N/A、判定根拠つき）として記録され、pr-prepare.json の gate_status にもフラグが出る
- [ ] `usage report` の value_signals に `fast_lane_story_count` が追加され、fast lane で出荷された story が常時可視になる
- [ ] human-review.json テンプレートは fast lane でも引き続き生成される（人間の最終判断面は省略しない）
- [ ] 既存テストが全て通り、テストは「import-ci の head 束縛」「failure/pending の拒否」「kind マッピング」「fast lane 適用/非適用の境界」「gate-dag 可視化」「usage report カウント」を含む

## 非目標

- CI 結果の改竄検出（gh API の応答を信頼する。署名検証・attestations は別 story）
- review subagent の品質自体の変更（fast lane は適用範囲の制御であり、review 内容には触れない）
- ローカルフルスイート実行の禁止（import-ci は代替手段の提供であり、ローカル実行も引き続き有効な evidence）
- 監査時間の計測・ダッシュボード化（コスト計測の自動化は別 story）
