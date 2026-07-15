# 安全モデル

VibeProの安全モデルは、bounded authority、current-head evidence、独立検査、fail-closedなrelease operationで構成されます。

## Authority境界

- **人間:** product intent、重大なtrade-off、waiver、最終release authority
- **Story / Architecture / Spec:** 成果、構造境界、testable contract
- **Code / runtime:** 実際の挙動。生成文はこれを上書きしない
- **Verification:** commitとdurable artifactに紐づく観測結果
- **Independent reviewer / adjudicator:** 別のexecution identityによる検査と裁定
- **Gate DAG:** readinessの統合。不足証跡を示すが、証拠を創作しない

Brainbaseはupstream contextを供給できます。Graphify、codebase-memory、Journey pack、外部design prompt、生成screenshotは補助証跡です。存在するだけでimplementation truthにはなりません。

## Fail-closedな状態

- 欠落・stale evidenceは `needs_evidence` のままにする
- 必要なinspectionが未実施なら `needs_review` のままにする
- 違反条件は、修正または明示的で帰属可能なdecisionまで `blocked` のままにする
- eligible targetを発見できなかったscannerは、問題なしではなくinconclusiveとする
- review recordには正しいstage、role、status（`pass` / `needs_changes` / `block`）、agent identity、inspection input、closed lifecycleが必要

## Decisionとwaiver

```bash
vibepro decision record . \
  --id <story-id> \
  --type waiver \
  --summary "<accepted residual risk>" \
  --reason "<why this is acceptable>" \
  --artifact <evidence-path> \
  --reviewer <identity> \
  --status accepted
```

waiverは可視化された負債であり、passしたtestではありません。source gate / finding、reason、evidence、owner、statusを明示します。

## Release境界

標準release pathは `guard check`、`pr prepare`、`pr create`、`execute merge` です。raw GitHub PR / merge commandはcurrent-head auditとwaiver auditを迂回するため、通常経路にしません。
