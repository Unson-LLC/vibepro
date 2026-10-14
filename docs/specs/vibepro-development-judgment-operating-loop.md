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
vibepro judgment audit [repo] [--json]
vibepro judgment input adopt [repo] --id <story-id> --input <input.json> --reviewed-by <actor> --authority <source> --summary <text> [--json]
vibepro judgment evaluate [repo] --id <story-id> --input <adopted-input.json> [--json]
vibepro judgment status [repo] --id <story-id> [--json]
vibepro judgment disposition record [repo] --id <story-id> --run <run-id> --human-decision <accepted|modified|rejected> --effect <changed_plan|changed_review_focus|escalated_to_human|no_effect> --summary <text> [--evidence <ref>]... [--reviewed-by <actor>] [--recorded-by <actor>] [--json]
vibepro judgment outcome record [repo] --id <story-id> --run <run-id> --status <confirmed|mixed|falsified|unknown> --summary <text> [--evidence <ref>]... [--observed-outcome <id:observation>]... [--json]
vibepro judgment pending [repo] [--json]
```

## Applicability

`judgment prepare`は`applicable=true`の記録がある場合だけ実行する。`applicable=false`は正常な終端であり、理由を必須とする。未記録は`not_started`として扱う。

## Input adoption

`judgment input adopt`はSenior Judgment schema `0.3.0`を検証し、入力byte列のSHA-256、reviewer、authority、summary、source HEADを保存する。同じrun IDを異なる入力で再採択できない。

`judgment prepare`はStoryの `## Problem Frame`、`## Constraints`、`## Options`、`## Current Constraint`、`## Observations`、`## Axes` を判断入力へ写す。見出しが無い項目はuncertainまたは空のままで、本文から推論しない。形式は `docs/specs/vibepro-development-judgment-workflow.md` の Story judgment headings に従う。

`judgment prepare`の公開CLIは`--run-id`を拒否する。`VIBEPRO_ALLOW_JUDGMENT_RUN_ID=1`のテストだけが`--run-id`を渡せ、その値は`^judgment-\d{14}-[0-9a-f]{8}$`に一致しなければならない。`judgment input adopt`と`judgment evaluate`は、この形式でないrun ID、`.vibepro/`の外の`source_input`、欠落した`drafts/<runId>.json`、draft receiptのlineage hashまたはartifact pathが採択入力と一致しない場合を拒否する。意味のレビューでproblem frameやoptionsを同じartifactへ足す場合、story、run、goalのlineageが一致するときだけreceiptの`input_sha256`を採択byte列へ更新する。

`judgment evaluate`は採択済みinputとhashが一致し、かつdraft receiptの`input_sha256`と一致する場合だけ実行する。

`judgment audit`は`.vibepro/reviews/**/adoptions/current.json`を読み、run ID形式、`.vibepro/`外の`source_input`、draft receiptの欠落、input hashまたはartifactの不一致が一つでもあれば終了コード1で返す。不一致がなければ0で返す。採択ごとに `development-judgment/drafts/<runId>.json`、`development-judgment/runs/<runId>.json`、記録された `source_input` が `HEAD` のコミット済みツリーに含まれるかも見る。作業ツリーにだけあるファイルは失敗とし、欠けているパスを表示する。

`vibepro init` と `vibepro doctor --fix` が書く `.gitignore` は `.vibepro/*` のあとで `!.vibepro/reviews/` を戻す。これにより `.vibepro/reviews/**` の drafts、runs、inputs、adoptions、evaluations をコミットできる。

移行: 既存リポジトリの `.gitignore` が `.vibepro/*` と `!.vibepro/config.json` だけのとき（brainbase-organization がこの形）、判断記録はCIに乗らない。`.vibepro/*` の後へ `!.vibepro/reviews/` を足す。`vibepro doctor --fix` がその行を追記する。その変更は各リポジトリ自身のPRで行う。

```gitignore
.vibepro/*
!.vibepro/config.json
!.vibepro/reviews/
```

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

Dispositionは人間の採否とdeliveryへの影響を記録する。`--reviewed-by` が非空なら前後の空白を trim した値を `reviewed_by` に保存する。フラグが無い、空文字、空白のみ、または値なしで引数の末尾にあるときはエラーにせず `reviewed_by` を null にする。値なしの末尾フラグは無視する。`--recorded-by` の意味は変えない。`reviewed_by` を持たない既存レコードは読み取り時に補完しない。applicability が記録済みの `judgment outcome record` が `--human-decision` または `--effect` とともに disposition を書くときも、同じ規則で `reviewed_by` を保存する。Outcomeは後日の観測結果を記録する。Outcome未記録または`unknown`は`outcome_pending`として`judgment pending`へ表示する。

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
