---
story_id: story-vibepro-development-control-loop
title: Development Control Loop Spec
parent_design: story-vibepro-development-control-loop
---

# Spec

## Required Behavior

- `DCL-001`: Story frontmatterの`development_intent`は`value`、`validation`、`simplification`のみを受理し、Story planへdevelopment control statusとともに投影する。
- `DCL-002`: 採用batch snapshotは`story_id + adopted_commit`で一意かつimmutableであり、同一keyへの再記録を拒否する。
- `DCL-003`: current projection、直近20件までのconsumption summary、最新の改善receiptはboundedなtracked stateへ投影し、clone/worktree間で次batch判断を共有する。raw snapshot/receiptはlocal audit用とする。
- `DCL-004`: 構造評価はLOC/import edgeの`+5% warning`・`+10% SIMPLIFY`、file countの`+3% warning`・`+5% SIMPLIFY`を既定値にする。
- `DCL-005`: 新規dependency cycleまたはworkflow-control surfaceの純増は即時`SIMPLIFY`にする。
- `DCL-006`: 消費評価はfresh input token、agent execution、repair batch、expensive verification、verification durationを独立に扱う。
- `DCL-007`: 指標の観測値が不明な場合は0またはbudget内へ変換せず`VALIDATE`にする。
- `DCL-008`: 履歴値が存在する指標は`max(直近5件median * 2, 直近20件p95)`をcapとし、存在しない指標だけbootstrap capを使う。
- `DCL-009`: bootstrap capはfresh input token 8,000,000、agent execution 6、repair batch 3、expensive verification 1、verification duration 2,700,000msとする。
- `DCL-010`: modeの強さは`SIMPLIFY > VALIDATE > VALUE`とし、構造と消費の強い方を次batch判断にする。
- `DCL-011`: `SIMPLIFY`は`simplification` intentのみ、`VALIDATE`は`validation|simplification`、`VALUE`は全intentを許可する。
- `DCL-012`: `shadow`は不一致をartifactへ出すがcommandを止めず、`enforced`はStory plan、PR prepare、PR create admissionで不一致をfail closedする。
- `DCL-013`: admissionはagent並列度やreview途中実行を変更しない。
- `DCL-014`: `judgment status`、`judgment snapshot`、`judgment outcome record`を公開CLIとして提供する。
- `DCL-015`: outcome receiptはimmutableで、`improved`だけを次baselineの候補として明示する。
- `DCL-016`: legacy `budgets.delivery_efficiency`と`budgets.delivery_efficiency_by_story`を設定正本から削除し、Story別上書きを新モデルへ持ち込まない。

## Code and Test References

- Code: `src/development-control.js` (`evaluateStructuralBudget`, `evaluateConsumptionBudget`, `deriveDevelopmentControlDecision`, `createDevelopmentSnapshot`, `evaluateDevelopmentAdmission`).
- CLI: `src/cli.js` (`judgment status`, `judgment snapshot`, `judgment outcome record`, PR admission).
- Story plan: `src/story-manager.js` (`createStoryPlan`).
- Tests: `test/development-control.test.js`.

## Invariants

- snapshotの既存ファイルは上書きしない。
- unknownは0ではない。
- budget超過は現在実行中のreviewを中断しない。
- parallel agent executionは許可したまま、その総消費と次intentだけを制御する。
- outcome receiptなしにbaselineを前進させない。

## Non Goals

- correctnessやbusiness outcomeをbudgetだけで証明すること。
- Story単位のcap amendment。
- 新しいGate DAG node。
- strict HEAD bindingによる再計測。
- 旧delivery-efficiency実装の全面復活。
