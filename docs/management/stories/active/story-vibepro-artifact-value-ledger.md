---
story_id: story-vibepro-artifact-value-ledger
title: artifactが支えた判断をledger化する
view: dev
period: 2026-07
parent_design: vibepro-artifact-value-ledger
architecture_docs:
  - docs/architecture/vibepro-artifact-value-ledger.md
spec_docs:
  - docs/specs/vibepro-artifact-value-ledger.md
status: active
created_at: 2026-07-01
updated_at: 2026-07-01
---

# artifactが支えた判断をledger化する

## 背景

日次価値監査ではartifact量が大きいこと自体を価値またはfake-valueとして扱いがちだった。
しかし価値は、artifactがどのconsumerに読まれ、どの判断を支えたかで決まる。

## 受け入れ基準

- [ ] `evidence-reuse.json` が `artifact_value_ledger` を持つ
- [ ] ledgerがartifact path、consumer、decision_supported、head bindingを保持する
- [ ] senior gap judgmentがledger状態をcost contextとdecision cardへ出す
- [ ] usage reportがdecision-bound artifact数とconsumer数を集計する
- [ ] session attributionが取得できる場合、ledgerは対象session数を明示してartifact valueの根拠へ含める
- [ ] session attributionが取得できない場合、ledgerは `not_collected_in_pr_prepare` を明示し、0件や価値なしとして扱わない
- [ ] ledger / senior gap / usage report の read-only audit reporting 変更は agent workflow ではなく developer_tool として分類される
- [ ] read-only audit reporting 責務は high-risk workflow replay ではなく current unit regression と current head binding で証跡充足できる
- [ ] Responsibility Authority の contract entry が primary authority を欠く場合、VibeProは自動充足せず validation error として needs_review に落とす
