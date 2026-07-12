---
story_id: story-vibepro-evidence-decision-ledger
title: evidence ledgerに判断利用を記録する
status: active
reason: consumer文字列だけではartifactが判断を変えたか監査できないため、互換追加で明示し、未確認をfalseに丸めずrollback可能にする。
architecture_docs:
  - docs/architecture/vibepro-evidence-decision-ledger.md
spec_docs:
  - docs/specs/vibepro-evidence-decision-ledger.md
---

# evidence ledgerに判断利用を記録する

## 受け入れ基準

- [ ] 各entryが安定した`decision_id`と`consumer_gate`を持つ。
- [ ] `decision_changed`は確認できない場合に`null`を保持する。
- [ ] summaryが判断変更、未確認、未使用artifactを別々に集計する。
- [ ] 既存consumerとdecision-bound集計の互換性を維持する。
