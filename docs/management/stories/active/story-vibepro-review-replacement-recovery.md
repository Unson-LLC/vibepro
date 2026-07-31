---
story_id: story-vibepro-review-replacement-recovery
title: manual_shutdown後のAgent Reviewをdelivery efficiency policy下でも安全にreplacementできるようにする
status: active
parent_design: vibepro-review-replacement-recovery
architecture_docs:
  - docs/architecture/story-vibepro-review-replacement-recovery.md
spec_docs:
  - docs/specs/story-vibepro-review-replacement-recovery.md
reason: 既存のreview lifecycleとdispatch authorizationを拡張し、新しいrunnerや別の承認経路は導入しない。結果のないcompleted closeだけを回収待ちとして保持し、timeout/replaced/manual_shutdownは既存のreplacement_for契約へ戻す。互換性境界はrunningとcompleted passの重複抑止を維持すること、rollbackは正規化条件と回帰テストの単一コミットをrevertすること。
---

# Story: manual_shutdown後のAgent Reviewを安全にreplacementできるようにする

## 背景

delivery efficiency policyが有効なStoryでAgent Review lifecycleを
`manual_shutdown`として証跡付きcloseすると、dispatch正規化が結果artifactのない
全closeを`result_uncollected`へ変換する。そのため`review authorize`は
`await_result`でreplacementを拒否する一方、`review record`は
`manual_shutdown` lifecycleへの結果添付を拒否し、正規の回復経路がなくなる。

既存Architecture/Specは、timeoutまたはmanual shutdown後に旧lifecycleを証跡付きで
closeし、`replacement_for`付きreplacementをstartできることを契約している。

## User Story

VibePro coordinatorとして、完走しなかったAgent Reviewを不正な結果後付けなしで
replacementへ進めたい。これにより、重複dispatch抑止を維持したまま正規の
review lifecycleを完了できる。

## Acceptance Criteria

- [ ] `completed`としてcloseされ結果artifactが未回収のlifecycleだけが
  `result_uncollected`として再dispatchを待機する。
- [ ] `timeout`、`replaced`、`manual_shutdown`として証跡付きcloseされた最新
  lifecycleは、予算を含む他のauthorization条件も満たす場合に限り、
  delivery efficiency policy下でもreplacement authorizationを
  `action: dispatch`として取得できる。予算超過は従来どおりfail-closedとする。
- [ ] replacementは既存どおり`--replacement-for`で最新の同一role lifecycleへ
  束縛され、無指定・古いlineage・証跡なしcloseはfail-closedのままとする。
- [ ] `manual_shutdown`と`replaced`の非空`close_evidence`は、coordinatorが旧agentの
  停止完了を確認した証跡である。独立した同一HEAD用cancellation flagは追加せず、
  実停止未確認のclose evidenceを記録してはならない。
- [ ] `running`、結果未回収の`completed`、current passの重複dispatch抑止は
  変更しない。`result_status: pass`でもresult artifactがなければ
  `completed_pass`として再利用しない。`needs_changes`または`block`のresult
  artifactを持つcompleted lifecycleは、修正後の再reviewを従来どおりauthorize
  できる。再authorizeで得たIDを`--dispatch-authorization`へ渡し、
  `--replacement-for`なしで通常のcorrection reviewをstartできる。
- [ ] stale HEADの`orphaned_agent`は本Storyのterminal replacement分類へ含めず、
  既存の`--cancellation-confirmed`とcancellation evidenceを要求する
  fail-closed境界を維持する。
- [ ] status、review repair、PR recovery、英日両方の`parallel-dispatch.md`が、
  `review authorize`を先に実行し、返却されたauthorization IDを
  `--dispatch-authorization`と`--replacement-for`へ渡す順序付き復旧手順を
  生成する。statusは履歴中の古いterminal entryを復旧対象にせず、
  roleごとの最新lifecycleだけにauthorize/startを案内する。
- [ ] CLI回帰テストがmanual shutdown→authorize→replacement startを再現し、
  修正前に失敗、修正後に成功する。unknown reasonはartifactなし・pass・
  needs_changes・blockの全artifact状態で`result_uncollected`とし、artifact欠落pass、
  budget exceededはfail-closedを維持する。

## Tasks

1. VP-TASK-REVIEW-REPLACEMENT-001: terminal closeのreplacement経路を回復する
   - 対象: `src/agent-review.js`、`src/review-repair.js`、`src/pr-manager.js`、`test/review-inspection-first.test.js`、`test/review-repair.test.js`、`test/vibepro-cli.test.js`、`test/delivery-efficiency-guardrail.test.js`
   - 事前条件: planning/spec reviewとimplementation-start checkpointが通っている。
   - 実装: dispatch向けlifecycle正規化で結果未回収の`completed`だけを`result_uncollected`へ変換し、operator-facing recovery面はauthorize→authorization ID付きreplacement startの順序を案内し、生成される英日両方の`parallel-dispatch.md`も同じ実行契約へ含める。
   - TDD: `manual_shutdown`、`timeout`、`replaced`からreplacementを開始できるCLI回帰テストを先にREDにし、`completed`結果未回収と全artifact状態のunknown reasonのfail-closed、pass statusでもartifact欠落時の`await_result`、budget超過時のdispatch拒否、non-pass result後にauthorization IDを使い`replacement_for`なしでstartするcorrection review、stale HEAD cancellation、role別dispatch上限、古い同一role terminal履歴の除外、全復旧コマンド面のauthorize-firstを固定する。
   - 完了条件: targeted test、unit、typecheck、build、Spec drift、current-HEAD Agent Review、VibePro Gateがすべて通る。
   - 非対象: `src/session-efficiency-audit.js`の汎用診断候補、review schema、productのdelivery budget既定値・role policy、subagent runtime。

## 非対象

- timeout/manual shutdown lifecycleへ結果を後付けすること。
- delivery efficiency budgetやreview role policyを緩和すること。
- VibeProがsubagent runtimeを直接spawnすること。

## Story-local review execution budget

`.vibepro/config.json`の本Story専用overrideは、実装対象となるproduct contractの
変更ではない。実装前レビューで見つかった設計欠陥を修正し、ユーザーの継続指示に
従って必須review lifecycleを完了するための、追跡可能かつ有限の実行予算である。
既定budget・role policyの意味、authorization時の予算計算、超過時のfail-closedは
変更せず、overrideは本Story以外へ波及しない。
