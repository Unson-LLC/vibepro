---
story_id: story-vibepro-delivery-reconciliation-state
title: Delivery事実と再調整状態を分離する
status: active
view: dev
period: 2026-07
category: platform
artifact_profile: feature_packet
feature_slug: delivery-reconciliation-state
parent_design: story-vibepro-delivery-reconciliation-state
architecture_docs:
  - docs/architecture/story-vibepro-delivery-reconciliation-state.md
source:
  type: value_audit
  title: "外部マージ済みPRの再読込が、現在HEADのgate driftを隠して成功終了し得る"
related_stories:
  - story-vibepro-cli-status-honesty
  - story-vibepro-gate-decision-outcome-ledger
reason: "alternatives considered: reject every already-merged PR, preserve merged_externally as an unconditional success, or model immutable delivery facts separately from mutable reconciliation state; selected the split state model. compatibility impact: status remains available while delivery and reconciliation become authoritative for new consumers. rollback plan: consumers may ignore the additive fields, while the CLI exit policy can be reverted independently. boundary and scope: this Story observes GitHub/base delivery facts and local follow-up readiness; it does not invent a new gate decision ledger or repair stale evidence automatically."
created_at: 2026-07-17
updated_at: 2026-07-18
---

# Delivery事実と再調整状態を分離する

## Business Context

VibeProをmerge authorityとして使うチームは、GitHub上の配送事実と、後から観測した
ローカル証跡のdriftを同時に扱う。両者を一つのstatusへ潰すと、配送済みを未配送へ
戻すか、stale evidenceを成功として隠すかの二択になる。本Storyはdeliveryの監査可能性と
follow-upの実行可能性を両立させる。

## Success Metric

contract test上で、外部マージのclean/drift/unverifiedを別状態として100%識別し、
drift時は配送事実を保持したままCLIが非0終了して再調整経路を提示する。

## Current Reality

現行の単一 `status` は、GitHub 上で確定した配送事実と、後から変化する local HEAD・
Gate・check・review の整合状態を同じ可変値へ射影している。そのため、外部 merge の
再取込時に「配送済みを未配送へ戻す」か「stale evidence を成功として隠す」かの
どちらかが起き得る。現在の authoritative reality は GitHub の merged view と、
再 fetch 済み base ref に対する merge commit ancestry である。

## Invariants

- 一度 ancestry で確認した immutable delivery は、後続の evidence drift で取消さない。
- current evidence が不足・不整合なら reconciliation は必ず fail closed する。
- delivery 未確認時は branch cleanup や成功 projection を行わない。
- top-level `status` は互換 projection に留め、判断正本にしない。

## Boundaries

- 本 Story は merge delivery と current evidence reconciliation の境界、およびその境界を壊さず復旧するための atomic recovery substrate だけを所有する。
- atomic recovery substrate は (1) state semantics/projection、(2) transaction/concurrency、(3) routed/linked authority の三つの risk lane に限定し、一般用途の lock・CAS・artifact routing platform は所有しない。
- decision outcome ledger の永続化・promotion は関連 Story の責務であり、ここでは実装しない。
- GitHub の merge 自体を取り消さず、stale evidence の自動再生成もしない。
- review owner は merge lifecycle、execution-state、report projection の三面を一つの契約として確認する。

## Coherent Scope Decision

- Decision: delivery observation、execution-state projection、CLI/HTML recoveryと、それらの書込みを保護する三つの risk lane を一つのStoryに保つ。
- Rationale: 三つの lane は同じPR/base identityと同じdelivery/reconciliation invariantを共有する。state lane だけでは concurrent writer を上書きし、transaction lane だけでは linked authority を取り残し、routing lane だけでは配送事実を正しく射影できないため、分割すると「配送済みだが operator state を破壊した」中間状態が生じる。
- Rollback boundary: state lane は additive schema/projection、transaction lane は generation-bound lock と transaction-owned CAS/rollback、routing lane は configured PR route と linked authority の同期だけを個別に戻せるようにする。一般用途 platform と関連Storyのdecision ledger実装は含めない。

### Reviewer map

| Review pass | Primary contract | Source focus | Verification focus | Stop condition |
| --- | --- | --- | --- | --- |
| 1. delivery semantics | immutable delivery と mutable reconciliation の分離 | `src/merge-manager.js`, `src/merge-gate-authorization.js` | managed/external/unverified delivery scenarios | delivery が current gate drift で消える |
| 2. transaction safety | generation-bound lock、CAS、transaction-owned rollback | `src/story-transaction-lock.js`, `src/execution-state.js` | concurrency、partial persistence、rollback ownership | newer operator state を stale writer が上書きする |
| 3. authority routing | configured PR route と local/linked authority の限定同期 | `src/artifact-routing.js`, `src/execution-state.js` | configured route、linked-only baseline、legacy isolation | unrelated/legacy authority を消費または復元する |
| 4. operator contract | CLI/HTML/traceability/release projection | `src/cli.js`, `src/html-report.js`, `src/traceability.js` | public binary、reconcile recovery、compatibility | delivery と follow-up が同じ status に潰れる |

各 pass は上から順に読むが、個別に pass/fail を判定できる。最終判断だけが四つの pass を同じ PR/base identity と delivery/reconciliation invariant に再結合する。これにより、実装を unsafe な中間状態へ分割せず、一人の reviewer が一度に保持する surface を限定する。

## Current Reality

- authoritative delivery signal は GitHub PR merged view と、再取得済み base ref に対する merge commit ancestry の組合せである。
- current authorization signal は current HEAD に拘束された Gate DAG、verification、review、PR lifecycle artifact であり、delivery signal の代替にはしない。
- operator-visible signal は `pr-merge.json`、execution-state、CLI exit code と recovery command であり、top-level legacy `status` 単独を正本にしない。
- delivery 確認前、または reconciliation 未完了時は branch/worktree cleanup を行わない。

## Failure Modes

- `parse_failure`: legacy/corrupt artifact を delivery 確定として誤読する。
- `provider_failure`: GitHub merged view または base fetch が失敗したのに成功扱いする。
- `auth_denied`: current-head gate authority が欠落・競合・stale のまま provider operation を開始する。
- `retry_or_async_failure`: delivery 後の persistence/sync 再試行で PR/base identity を失う。
- `evidence_lifecycle_regression`: stale Gate DAG や別 HEAD evidence が current authority を上書きする。
- `workflow_state_regression`: delivered fact と reconciliation follow-up の一方を derived surface が落とす。
- `transaction_concurrency_regression`: stale lock generation、競合 writer、partial persistence rollback が新しい operator state を上書きする。
- `routed_authority_regression`: configured PR route または linked execution-state authority を取り違え、別経路の artifact を消費・復元する。

## Done Evidence

- unit regression が immutable delivery と legacy compatibility を固定する。
- integration/runtime-path evidence が external/managed merge、provider failure、negative path を固定する。
- story source integrity regression と managed worktree regression が Story-to-code と branch recovery を固定する。
- transaction/concurrency regression が generation fencing、CAS、transaction-owned rollback を固定する。
- routed/linked authority regression が configured route と全 authority の commit/rollback ownership を固定する。
- current-head review と clause/judgment adjudication が、scope と failure policy を独立確認する。

## User Story

**As a** すでにGitHub上でマージされたPRをVibeProへ再取り込みするoperator
**I want** マージ済みという不変事実と、現在のローカルHEAD・gate evidenceを再調整すべき状態を別々に確認したい
**So that** 配送済み事実を消さず、stale evidenceや別HEADを成功として見逃さない

## Scope

- `pr-merge.json`にimmutableな`delivery`とmutableな`reconciliation`を持たせる。
- GitHubのmerge commitがbase上に存在するときだけdeliveryをobservedとして確定する。
- 外部マージ済みでもgate、HEAD、checks、review policyに不整合があれば`reconciliation_required`とし、CLIは非0で返す。
- traceabilityはdelivery事実から`merged`へ進め、execution stateはfollow-upを残す。
- 通常のVibePro mergeではdeliveryとreconciliationの両方を完了状態にする。
- delivery/reconciliation writer は generation-bound transaction lock、observed-value CAS、transaction-owned rollback で concurrent operator state を保護する。
- configured PR route と local/linked execution-state authority を同じ identity-bound transaction で同期し、legacy route や unrelated artifact を消費しない。
- `execute status` は正常な state を変更しない。破損JSONだけは元byteを `state.json.corrupt-*.bak` へ隔離して非0終了し、欠損や推測値を正常な照会結果として返さない。

## Release Operations

- Owner: リリース担当または当番operatorが、外部merge検知後のreconciliation完了まで所有する。
- `release_note`: delivery と reconciliation を分離し、外部 merge 後に未解決理由と復旧 command を owner-visible JSON として公開する。
- Observe: `vibepro execute status . --story-id <story-id> --base <base-ref> --json` の `delivery.status`、`reconciliation.status/reasons`、`current_phase` と終了コードを監視する。正常な照会は未解決状態でも0、破損stateの隔離は1となる。
- `observability_evidence`: 上記 status JSON を単一の authoritative signal source とし、`delivery.status`、`reconciliation.status/reasons`、`current_phase`、終了コードを当番operatorが監視する。
- Recover: 配送事実を確認した上で `vibepro execute reconcile . --story-id <story-id> --base <base-ref> --pr <number-or-url> --json` を実行する。未解決は2、永続化失敗は1、完了は0である。
- Roll back: additiveなdelivery/reconciliation事実は消去しない。問題時はCLIのexit policyまたはprojection consumerだけを戻し、観測済みmerge commitと隔離済み破損byteを保持して再構成可能にする。
- `rollback_plan`: feature gate は増設しない。旧 consumer は additive field を無視でき、upgrade/downgrade 時も保存済み delivery 事実を保持したまま CLI exit policy と projection consumer だけを切り戻す。
- `performance_semantic`: polling、provider call、永続化回数を増やさず、追加処理は既取得 artifact の bounded projection と validation に限定する。既存 execution-state regression suite を perf regression guard とする。

## Acceptance Criteria

- [x] DRS-S-1: merge artifactは`delivery.status`、`merge_commit_sha`、`merged_at`と、独立した`reconciliation.status`、`reasons`を持つ。
- [x] DRS-S-2: 外部マージcommitがbase上にない場合はdeliveryを確定せず、従来どおりblockedになる。
- [x] DRS-S-3: 外部マージcommitが確認できてもcurrent gate/HEAD/check/reviewが不整合ならdeliveryは保持し、reconciliationを`reconciliation_required`にしてCLIを非0終了する。
- [x] DRS-S-4: external mergeのOPEN/base topology由来の期待差分だけではreconciliation_requiredにしない。
- [x] DRS-S-5: traceabilityのdelivery lifecycleとexecution follow-upが分離され、再調整が必要な実配送を未配送へ巻き戻さない。
- [x] DRS-S-6: 通常merge、外部merge clean、外部merge gate drift、merge commit未確認をcontract testで固定する。
- [x] DRS-S-7: provider command/JSON failure、execution-state同期失敗、canonical圧縮、外部merge再試行をfail-closedかつ再構成可能なcontract testで固定する。
- [x] DRS-S-8: delivery/reconciliation persistence は generation-bound lock、全 authority の observed-value CAS、per-write transaction ownership による rollback で concurrent writer を上書きしない。
- [x] DRS-S-9: configured PR route と local/linked authority だけを同期・復元し、legacy route、別 Story、unrelated artifact を消費または破壊しない。
- [x] DRS-S-10: canonical follow-up persistence が失敗した場合も CLI は非0終了する。expected-merge CAS が成立する場合は観測済み delivery と exact PR/base selector を local recovery artifact に残し、後続の `execute reconcile` で canonical authority と execution state を収束できる。CAS が不成立の場合は新しい operator state を保護し、`merge_recovery_state_conflict` と `recovery_persistence=failed` を返す。

## Story Scenarios

- `DRS-STORY-S-001`: Given GitHub が返した managed merge commit が再取得済み base ref の祖先であるとき、VibePro は delivery を確定し、current evidence と整合する場合だけ reconciliation を `reconciled` にする。
- `DRS-STORY-S-002`: Given 外部 merge commit が再取得済み base ref の祖先で current gate、HEAD、checks、review が整合するとき、VibePro は immutable delivery を `merged_externally` として取り込み成功する。
- `DRS-STORY-S-003`: Given delivery は確認済みだが gate、HEAD、checks、review のいずれかが不整合のとき、delivery を保持したまま reconciliation を `reconciliation_required` にし、復旧 command と非0終了を返す。
- `DRS-STORY-UNVERIFIED-004`: Given GitHub が返した merge commit を再取得済み base ref の祖先として確認できないとき、delivery を `unverified` のまま fail closed し、復旧 branch を削除しない。
- `DRS-STORY-S-005`: Given delivery 後の canonical persistence または execution-state 同期に失敗したとき、配送済み事実と PR/base selector を失わず、再実行可能な reconciliation follow-up を表示する。
- `DRS-STORY-S-006`: Given GitHub provider が非0終了またはmalformed JSONを返したとき、VibeProは例外で証跡生成を中断せず、delivery未確認のblocked artifactを永続化する。同じ fail-closed boundary として、responsibility registry entry に `primary_authority.ref` がない場合は `primary_authority is required` を返し、別 authority を推測しない。
- `DRS-STORY-TXN-007`: Given stale lock takeover、concurrent writer、またはpartial persistence failureが発生したとき、generation fencing と observed-value CAS は新しい operator state を保護し、rollback はこの transaction が書いた artifact だけを復元する。
- `DRS-STORY-ROUTE-008`: Given configured PR route と linked execution-state authority が存在するとき、reconciliation はその authority set だけを同期・復元し、legacy route と unrelated artifact を変更しない。
- `DRS-STORY-RECOVERY-009`: Given delivery 後の canonical follow-up persistence が rollback されたとき、VibePro は失敗を成功扱いせず exit 1 を返す。expected-merge CAS が成立すれば `persisted_local` recovery と exact base/PR を使う後続 reconcile で canonical authority と execution state を再構成し、CAS が不成立なら新しい operator state を保持したまま明示的な recovery conflict を返す。

## 実装タスク

1. delivery-reconciliation-state
   - DRS-S-1〜DRS-S-5のdelivery/reconciliation分離を実装する。
   - DRS-S-6のcontract testで通常merge・外部merge clean・drift・未確認を固定する。
   - DRS-S-7のcontract testでprovider failure、再試行、同期失敗の永続面、derived surfaceの非過剰判定を固定する。
   - DRS-S-8のcontract testでgeneration fencing、CAS、transaction-owned rollbackを固定する。
   - DRS-S-9のcontract testでconfigured routeとlinked authorityの所有境界を固定する。

## Non Goals

- decision outcome ledgerのcanonical promotion。
- stale evidenceの自動再生成。
- GitHub上の既成mergeを取り消すこと。
