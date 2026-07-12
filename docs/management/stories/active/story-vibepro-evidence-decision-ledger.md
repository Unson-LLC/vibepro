---
story_id: story-vibepro-evidence-decision-ledger
title: evidence ledgerに判断利用を記録する
status: active
parent_design:
  - vibepro-artifact-value-ledger
reason: consumer文字列だけではartifactが判断を変えたか監査できないため、互換追加で明示し、未確認をfalseに丸めずrollback可能にする。
architecture_docs:
  - docs/architecture/vibepro-evidence-decision-ledger.md
spec_docs:
  - docs/specs/story-vibepro-evidence-decision-ledger.md
---

# evidence ledgerに判断利用を記録する

## 受け入れ基準

- [ ] 各entryが安定した`decision_id`と`consumer_gate`を持つ。
- [ ] `decision_changed`は確認できない場合に`null`を保持する。
- [ ] summaryと主要consumer surfaceが判断変更、未確認、未使用artifactを別々に集計し、`false`を確認済み未使用、`null`を未確認として扱う。
- [ ] 既存consumerとdecision-bound集計の互換性を維持する。

## シナリオ

### EDL-S1 / AC-1, AC-4

- Given: 既存4 artifactがcanonical inventoryに存在する。
- When: evidence ledgerを生成する。
- Then: 全entryに判断利用フィールドがあり、既存集計は4のままになる。

### EDL-S2 / AC-2, AC-3

- Given: 判断変化が観測されていない。
- When: evidence ledgerを集計する。
- Then: 4件を未確認として数え、`decision_changed=false`の確認済み未使用件数と区別する。

### EDL-S3 / AC-3, AC-4

- Given: session evidenceが1件以上存在する、または存在しない。
- When: evidence ledgerを集計する。
- Then: `sessions.length > 0`の場合だけ既存のsession replay集計を補助情報として生成し、存在しない場合もcanonical inventoryの判断利用集計は維持する。
