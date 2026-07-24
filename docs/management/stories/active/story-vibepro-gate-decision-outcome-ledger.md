---
story_id: story-vibepro-gate-decision-outcome-ledger
title: "gate findingから挙動変更とdownstream outcomeまでをcompact decision ledgerで追跡する"
status: active
view: dev
period: 2026-07
source:
  type: value_audit_followup
  title: "実欠陥を捕捉したgate findingが実装修正・PR・mergeへ接続した価値を監査から再構成しにくい"
related_stories:
  - story-vibepro-evidence-decision-ledger
  - story-vibepro-decision-record-gate
  - story-vibepro-roi-measurement-loop-closure
  - story-vibepro-delivery-reconciliation-state
parent_design:
  - vibepro-artifact-value-ledger
  - vibepro-gate-decision-outcome-ledger
architecture_docs:
  - docs/architecture/vibepro-gate-decision-outcome-ledger.md
spec_docs:
  - docs/specs/story-vibepro-gate-decision-outcome-ledger.md
created_at: 2026-07-15
updated_at: 2026-07-18
reason: "alternatives considered: infer value from changed lines or pass/fail counts, keep the chain only in review prose, or add an additive compact trace; selected the additive trace. compatibility impact: well-formed existing ledgers remain valid and legacy multiplicity-bound selectors are accepted as read aliases while new output uses the stable selector; malformed or partially structured ledgers previously tolerated by canonical promotion now fail closed before persistence. bug-physics wording is changed only through an explicit positive/negative Japanese regression matrix. rollback plan: stop operator retry and revert validator/builder/views/wiring/selector alias/wording changes without deleting or rewriting historical ledgers. boundary: VibePro records observed links and provenance; it never invents downstream outcomes or business value. design-ssot.json is part of the requirements SSOT lane."
---

# Story

VibeProのgateが実欠陥を捕捉しても、finding、判断、修正、PR、merge、downstream結果は別々のartifactに分散している。後日の価値監査が大量artifactを再読しないと「何を捕まえ、どの挙動が変わったか」を説明できず、実価値ではなくgate pass件数だけが残る。

既存正本を逆更新しないhead-bound derived read modelとして、findingから判断、挙動変更、公開結果までを一行単位で再構成する。観測できない結果は`null`と不足理由を保持し、成功扱いに丸めない。

## User Story

**As a** gateの価値を監査・調整するsenior engineer
**I want** findingから挙動変更とPR/merge/downstream outcomeまでの判断連鎖を小さな正本で読めること
**So that** pass件数や巨大証跡ではなく、実際に改善された判断を根拠にgateを維持・降格できる

## Acceptance Criteria

- [x] `GDL-S-1`: story内で一意なstable source keyがあるtraceは決定的な`decision_trace_id`を持つ。key不足または同じnormalized subjectが複数role/stage/source instanceへ衝突するtraceは推測IDを付けず、`decision_trace_id: null`、決定的な`collision_group`、`incomplete`と不足理由を持ち、canonical dedupeで消失しない。
- [x] `GDL-S-2`: traceは`finding_id`、`gate_id`、`detected_by`、`disposition`と各値の`source_ref`を保持し、競合を隠さない。
- [x] `GDL-S-3`: `behavior_delta`は変更前後、変更参照、current-head検証参照を保持し、未確認時は`null`と理由を保持する。
- [x] `GDL-S-4`: traceはevidence head、PR番号・URL・状態、merge SHA・状態を観測可能な範囲で接続する。
- [x] `GDL-S-5`: downstream outcome statusは`observed`、`not_observed`、`not_applicable`の三値だけを取り、unreadable/untrustedは`source_errors[]`で区別し、未確認を成功・失敗・価値ゼロへ変換しない。
- [x] `GDL-S-6`: bounded summaryが`finding → decision → behavior delta → PR/merge → downstream outcome`を最大20 traceだけ返す。`conflicting → incomplete → partial → complete`、次にstable IDの昇順で決定的に選び、review/pr-prepare/usage-reportの全surfaceがnull-ID traceの`collision_group + trace_source_ref`、`total_count`、`returned_count`、`omitted_count`、`truncated`とfull ledgerのpath/digestを返して正本へdrill-downできる。
- [x] `GDL-S-7`: legacy、欠損、壊れたsourceを空の成功へ丸めず、既存ledger schema/consumer outputを壊さない。
- [x] `GDL-S-8`: 同一trace revisionはcanonical側でdedupeし、head・merge・downstream観測が変われば新revisionとして保存する。canonical persistenceの各外部commandは非対話環境・段階別deadline・所有process group・`SIGTERM`から`SIGKILL`への有限cleanupを持ち、cleanupはprimary failureと独立したdeadlineで実行する。push timeoutはremote postconditionを`applied|not_applied|indeterminate`の三値で確認し、推測成功や無制限待機にしない。
- [x] `GDL-S-9`: operatorはbounded summaryに露出した一意trace ID、またはnull-ID traceの`collision_group + trace_source_ref`、parent revision、eligible outcome sourceを使って`outcome record`できる。selectorはparent revision内で厳密に1件へ解決できなければ非zeroで拒否する。候補は最大5件のkind/ref/digestと件数を返し、1件だけならsourceを自動解決し、0件または複数件は候補を示して拒否する。producerは必須とし、曖昧・stale・未merge・untrusted入力は既存artifactを変更しない。公開`--id`はstory-scoped pathへ使う前に安全なStory ID形式へ検証し、path traversal・encoded separatorを非zeroで拒否する。observationは完全schema・canonical ID・安全なsource ref・許可済みauthorityを共通validatorで検証し、refresh時にmanaged source bytes/current authorityへ再束縛する。local manifestは不整合を検出するintegrity境界であり、同一OSユーザーへの暗号学的authenticityは保証しない。local ledger更新はsame-directoryのfsync済みtempからatomic renameし、失敗時は旧bytesを保つ。best-effort delivery warningはparser本文やcredential-like入力を含まない固定message/recoveryだけを返す。live GitHub/git authorityと注入runnerは有限deadlineでfail-closedになり、timeout時も既存observationを変更しない。`outcome refresh`は共有canonical persistence経路だけを使い、promotion失敗は公開CLIプロセスでexit 1となる。既定text/`--json`の両出力は生stdout/stderr、command、args、env、primary command result、temporary worktree pathを出さず、boundedな失敗理由、push postcondition、cleanup status、temp worktree残存可能性の有無、復旧手順を示す。`outcome`/`record`/`refresh`のhelpは各scopeに限定する。
- [x] `GDO-S-1`: merge artifactとcanonical auditは、immutableな配送identityと、repo-local gate outcome ledgerをcentral canonical ledgerへ結合した結果を`decision_outcome_binding`として同じ配送revisionに保持する。
- [x] `GDO-S-2`: local entryが存在するときは`promoted_count + duplicate_count === expected_entry_count`だけを`bound`とし、件数不一致やpromotion未実行を成功へ丸めない。
- [x] `GDO-S-3`: strict binding失敗後も`delivery`とmerge SHAを変更せず、`reconciliation_required`と`decision_outcome_binding_failed`を返して後続の復旧対象を明示する。
- [x] `GDO-S-4`: local entryが0件のstoryは`not_applicable`であり、判断記録のないstoryへ架空の失敗を作らない。
- [x] `GDO-S-5`: derived decision-outcome read modelのbest-effortな`decision_outcome_delivery`と、記録済みgate outcomeのfail-closeな`decision_outcome_binding`を別field・別失敗契約として維持する。

## Non Goals

- changed-line比から価値を推定すること。
- downstreamの売上や利用効果を観測なしに推定すること。
- gate verdict、waiver判断、merge可否をderived ledgerから変更すること。

## Runtime Evidence

- `current_reality`: finding、判断、挙動差分、PR/merge、downstream outcome は複数の既存正本に分散している。実装はそれらを逆更新しない head-bound derived read model と、repo-local gate outcome を central canonical ledger へ同一配送revisionで結ぶ strict binding に限定する。
- `invariants`: 観測できない outcome は `not_observed` のまま保持し、immutable な delivery identity は binding 失敗で消さない。local entry がある場合だけ全件 promotion または duplicate を要求し、0件は `not_applicable` とする。
- `boundaries`: derived read model の best-effort `decision_outcome_delivery` と、記録済み判断の fail-close `decision_outcome_binding` は別field・別失敗契約である。canonical persistence は共有serviceだけが所有する。
- `failure_modes`: timeout、parse/schema failure、auth denial、partial promotion、stale authority、evidence lifecycle drift、workflow state regression は空の成功へ丸めず、bounded error または `reconciliation_required` として残す。
- `done_evidence`: focused unit/integration/E2E、current-head Agent Review、AC別 evidence adjudication、judgment adjudicationが同じHEADへ束縛され、compact bundle・replay・decision index・value auditの4 surfaceでbindingを再構成できること。

## Release Operations

- `release_note`: `vibepro outcome record` / `vibepro outcome refresh` と compact decision-outcome projection を追加する。
- `rollback_instruction`: 問題時は新commandの利用を停止して当該変更commitをrevertし、既存ledgerを削除・上書きせず従来projectionへ戻す。
- `observability_evidence`: ownerは bounded JSON と canonical revision の `decision_outcome_binding.status`、件数、process exit codeを一次信号として監視する。
- `release note`: `vibepro outcome record` / `vibepro outcome refresh` と compact decision-outcome projection を追加する。既存ledgerは読み取り互換を保ち、migrationや履歴の書き換えは不要である。
- `operator action`: リリース時の必須操作はない。後日観測を結びたい operator だけが bounded summary の selector と current parent revision を確認し、authority-valid source を指定して `outcome record`、続いて `outcome refresh` を実行する。0件・複数件・stale・untrusted・未mergeの場合は候補または固定recoveryを確認し、入力を直して再実行する。自動的な成功扱いや手動JSON編集はしない。
- `observability evidence`: owner-visibleな一次信号は `.vibepro/pr/<story>/decision-outcome-ledger.json`、各commandのbounded JSON、canonical revisionの `decision_outcome_binding.status` / `reason` / `expected_entry_count` / `promoted_count` / `duplicate_count` である。`bound`、`not_applicable`、`reconciliation_required` と process exit code を監視し、raw stdout/stderrやsecretを監視面へ再掲しない。
- `support / rollback owner`: VibePro maintainer が owner。問題時は新commandの利用を停止して当該変更commitをrevertし、既存ledgerを保持したまま従来の review/pr-prepare/usage-report projectionへ戻す。canonical promotionが途中なら immutable delivery identity を保ち、`reconciliation_required` の対象revisionを owner が再実行または手動調査する。履歴ledgerの削除・上書きはrollback手順に含めない。
- `state transitions`: `not_observed -> observed|not_applicable` は current authorityの検証とrecord成功時だけ、local outcomeは `pending -> bound|not_applicable|reconciliation_required` を取り、refresh/promotion失敗は必ず `reconciliation_required` に留まる。

## Review Budget Amendment

- 2026-07-24 の current-HEAD architecture preflight は、`execute merge --json` が canonical persistence の内部 command 結果、一時 worktree path、raw stdout/stderr を公開し得る P1 境界漏れを検出した。
- 修正は公開 merge result を bounded projection に通し、既存の公開契約を保ちながら内部 diagnostic key を除外する回帰テストを追加する。
- 修正で HEAD が変わるため、同じ `architecture_boundary` role による独立再確認を1回だけ許可する。waiver、無関係な role、反復 replacement loop には使わない。
- その再確認で、内部診断の一律除外が公開 recovery command まで削除する契約破壊を検出した。`343e54c8` の文脈依存 projection 修正だけを再確認する最終 `architecture_boundary` dispatch を1回追加し、追加ループには使わない。
- その修正確認では実装契約は解消済みだったが、実 `runCli --json` stdout 経路の恒常テスト不足が残った。依存注入した実 CLI 経路テストの確認に限り、最終 dispatch を1回追加する。
- frozen candidate の通過後、`origin/main` 前進により PR freshness が正しく rebase を要求した。rebase 後の current-head sequence、最終 gate、adjudication の再束縛に限って5 accounting unit と1 architecture preflight を追加し、実装変更には使わない。
