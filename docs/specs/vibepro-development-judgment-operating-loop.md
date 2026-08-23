---
story_id: story-vibepro-development-judgment-operating-loop
title: Development Judgment Operating Loop Spec
architecture_ref: docs/architecture/vibepro-development-judgment-operating-loop.md
status: accepted
---

# Development Judgment Operating Loop Spec

## CLI

```bash
vibepro judgment applicability record [repo] --id <story-id> --applicable yes|no --reason <text> [--recorded-by <actor>] [--json]
vibepro judgment prepare [repo] --id <story-id> [--run-id <id>] [--output <path>] [--json]
vibepro judgment input adopt [repo] --id <story-id> --input <input.json> --reviewed-by <actor> --authority <source> --summary <text> [--json]
vibepro judgment evaluate [repo] --id <story-id> --input <adopted-input.json> [--json]
vibepro judgment status [repo] --id <story-id> [--json]
vibepro judgment disposition record [repo] --id <story-id> --run <run-id> --human-decision <accepted|modified|rejected> --effect <changed_plan|changed_review_focus|escalated_to_human|no_effect> --summary <text> [--evidence <ref>]... [--recorded-by <actor>] [--json]
vibepro judgment outcome record [repo] --id <story-id> --run <run-id> --status <confirmed|mixed|falsified|unknown> --summary <text> [--evidence <ref>]... [--observed-outcome <id:observation>]... [--json]
vibepro judgment pending [repo] [--json]
```

## Applicability

`judgment prepare`は`applicable=true`の記録がある場合だけ実行する。`applicable=false`は正常な終端であり、理由を必須とする。未記録は`not_started`として扱う。

## Input adoption

`judgment input adopt`はSenior Judgment schema `0.3.0`を検証し、入力byte列のSHA-256、reviewer、authority、summary、source HEADを保存する。同じrun IDを異なる入力で再採択できない。

`judgment evaluate`は採択済みinputとhashが一致する場合だけ実行する。

## Actionability

次を満たす評価をactionableとする。

- problem frameが`valid`
- development modeが選択済み
- 推薦が`revise_problem`または`human_decision_required`ではない
- 実行可能なnext actionが存在する

## Story plan binding

`story plan`は最新operational projectionを読み、actionableなら次を保存する。

- run ID
- mode / recommendation
- input SHA-256 / source HEAD
- judgment artifact / evaluation artifact
- `effect=changed_plan|no_effect`

actionable時はmode別の`development_judgment` task candidateを先頭へ追加する。非該当またはunactionableでは追加しない。

## Disposition and Outcome

Dispositionは人間の採否とdeliveryへの影響を記録する。Outcomeは後日の観測結果を記録する。Outcome未記録または`unknown`は`outcome_pending`として`judgment pending`へ表示する。

## Feedback

次回prepareは直近feedbackを次のように投影する。

| Outcome | history/adopted batch |
|---|---|
| confirmed | verified boundaryへ進め、adopted batchを空にする |
| mixed | previous batchを`external_outcome=unchanged`で残す |
| falsified | previous batchを`external_outcome=regressed`で残す |
| unknown / disposition only | previous batchを`external_outcome=unknown`で残す |

## PR projection

`pr prepare`はlifecycle、applicability、input adoption、actionability、plan binding、disposition、pending outcome、next actionsを表示する。いずれも`gate_status`、`blocking_reasons`、merge、releaseを変更しない。
