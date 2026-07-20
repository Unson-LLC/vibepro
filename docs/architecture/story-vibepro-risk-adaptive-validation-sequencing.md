---
title: "Risk-adaptive Validation Sequencing Architecture"
status: accepted
created_at: 2026-07-20
updated_at: 2026-07-20
related_stories:
  - story-vibepro-risk-adaptive-validation-sequencing
  - story-vibepro-risk-adaptive-gate-dag
  - story-vibepro-scoped-evidence-invalidation
---

# Risk-adaptive Validation Sequencing Architecture

## Intent

高コスト検証の後に境界欠陥が見つかる手戻りを減らしつつ、最終ReviewとPR readinessのcurrent-HEAD拘束を弱めない。

## Decision

`validation-sequencing`を、既存のChange Risk Classifier、Verification Evidence、Agent Review、Scoped Evidence Invalidationの上に置く小さな状態機械とする。phaseは`targeted_validation`、`preflight_review`、`code_frozen`、`expensive_verification`、`final_review`の順序を持つ。workflow-heavy、API contract、またはboundary-sensitiveな変更では、risk surfaceからpreflight roleと対象surfaceを決定する。

preflightのrecord typeは常に`advisory_preflight`であり、`satisfies_final_review=false`を保持する。findingがある場合は全findingのdispositionがなければfreezeできず、disposition済み状態にも正規verification evidenceを要求する。freezeはHEAD、test fingerprint、verification commandの三つ組を保存し、expensive verificationとfinal reviewは同じ三つ組だけを受理する。passing phaseの証跡はStory固有の正規`.vibepro/pr/<story-id>/verification-evidence.json`だけを読み、Storyと三つ組へのbindingを検証する。final reviewは正規Agent Review storeでcurrent/pass/closedと解決できるresultだけを受理する。これにより同一bindingではexpensive verificationを再利用でき、異なるbindingは再実行になる。CI importも`source=ci_import`のexpensive evidenceとして同じbinding条件で扱うが、公開import経路だけが生成できる内部receiptを要求し、coverage mappingはcaller引数を証明にせず、同じHEADにcommit済みの`.github/vibepro-ci-coverage.json`とのworkflow・check・command・fingerprint完全一致を要求するため、ローカルFull Suiteの再実行を必須にしない。

mutationはchanged surfaceに応じてphaseを失効する。Story/Spec/Architecture/contract metadataはpreflight以降を戻し、source、test、repo-control、other、unknownは全phaseをfail closedで戻す。理由と変更fileをinvalidations ledgerへ残す。

`vibepro sequence plan|record|invalidate|status`が状態を`.vibepro/validation-sequencing/<story-id>/state.json`へ保存する。`pr prepare`は保存済みplanを現在のChange Risk Classifier出力と照合し、profileまたはrisk surfaceが異なれば全phaseを失効して現在のplanへ置換する。その上でrequired sequenceが未完了、final reviewがcurrent HEADでない、またはbinding不一致なら`gate:validation_sequencing`を未解決にする。保存済みのlight planを現在のhigh-risk判定より強いauthorityとして扱わない。

## Compatibility and Rollback

light profileではGateをtyped N/Aとし、既存フローを維持する。sequencingを無効化するruntime switchは設けない。未マージ時は機能コミットをrevertし、リリース後は当該リリースまたはmerge commitをrevertして既存Verification・Agent Review Gateへ戻す。状態ファイルの削除だけでは次回`pr prepare`がplanを再生成するためrollbackにはならない。preflightからfinal review passを生成する互換経路は設けない。

## Verification

early boundary finding、disposition後freeze、exact reuse、Spec限定失効、unknown fail-closed、CI import相当のexpensive evidence、current-head final reviewをunitとStory acceptance replayで検証する。
