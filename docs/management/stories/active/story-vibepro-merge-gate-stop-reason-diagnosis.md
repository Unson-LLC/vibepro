---
story_id: story-vibepro-merge-gate-stop-reason-diagnosis
title: "execute merge が gate_not_ready と言う時、実際の原因を stop_reason で名指しする"
status: active
parent_design: story-vibepro-merge-waiver-propagation
architecture_docs:
  - ../../../architecture/vibepro-merge-gate-stop-reason-diagnosis.md
reason:
  finding: >
    2026-08-01 の PR #406 着地作業で、`vibepro execute merge` が
    `stop_reason: gate_not_ready` を返し続けた。実測状態は critical gate 0 件、
    waiver 有効、CI 8 チェック全 green、他の precondition
    (clean_worktree / base_freshness / remote_head_match / checks_ready /
    review_policy / open_pull_request) すべて passed。VibePro 自身の
    `buildMergeGateAuthorization` を node から直接呼ぶと
    `{"allowed":true,"source":"pr_create_gate_override"}` を返した。つまり
    ゲート結果は問題ではなく、`executeMerge` が artifact を current HEAD へ
    束縛する段階（`isCurrentPrLifecycleArtifact` による pr-create / pr-prepare の
    絞り込み）で拒否が発生していた。`src/merge-manager.js` は
    `gate_authorization.reason`（`gate_override_not_allowed` /
    `current_gate_status_unknown` など、原因を区別できる値）を持っていながら、
    `stop_reason` には一律 `gate_not_ready` を書き、warnings は公開 projection で
    "Merge processing produced a warning." 1 行へ潰される。担当エージェントは
    この誤誘導で 3 つの診断仮説（.vibepro-store の古い state / execute reconcile の
    不具合 / managed worktree の linked copy 未 populate）を立てて全部外し、
    数時間を費やした。
  alternatives: >
    (a) `gate_not_ready` を残したまま別フィールドに理由を足す案は、誤誘導の
    本体が「stop_reason を読んだ人が gate 評価結果だと信じる」ことなので
    退けた。(b) warnings の文言だけ厚くする案は、公開 projection が warnings を
    定型 1 行へ潰す設計（機密漏洩防止）と衝突するため退けた。採用: 拒否原因を
    分類する診断層 `src/merge-gate-diagnosis.js` を新設し、gate 証跡そのものが
    block している場合だけ `gate_not_ready` を返し、artifact 束縛・waiver 品質・
    gate status 解決不能はそれぞれ固有の stop_reason を返す。診断は
    `merge.gate_authorization_diagnosis` として artifact に残し、公開 projection の
    許可キーへ追加する。
  compatibility: >
    gate 証跡が実際に unresolved / critical な場合の stop_reason は
    `gate_not_ready` のまま不変。`gate_authorization` の形と
    `preconditions.gate_ready`（boolean）も不変。変わるのは (1) 非 gate 原因の
    stop_reason 値、(2) `gate_authorization_diagnosis` の追加、
    (3) `execute merge --explain` の追加。`--explain` は read-only で
    git fetch / gh / artifact 書き込みを一切行わない。
  rollback: >
    `src/merge-gate-diagnosis.js` を削除し、`src/merge-manager.js` の
    `diagnosis.stop_reason` を文字列 `'gate_not_ready'` へ戻し、
    projection と CLI の `--explain` 分岐を落とせば戻る。永続済み artifact の
    `gate_authorization_diagnosis` は読み手のない追加キーとして無害に残る。
  boundary: >
    `buildMergeGateAuthorization` の許可判定ロジック自体は変更しない
    (fail-closed の性質を保つ)。`execution-state.js` の completion_status 導出、
    `execute reconcile`、`.vibepro-store` の hydrate 経路は範囲外。
    PR #406 で最終的に merge が通った直接原因の特定も範囲外
    (本 Story は「次に同じ状態が起きた時に原因が即座に読める」ことを保証する)。
created_at: 2026-08-01
updated_at: 2026-08-01
---

# Story: execute merge が gate_not_ready と言う時、実際の原因を stop_reason で名指しする

## User Story

**As a** VibePro の self-dogfood フローで PR を着地させるエージェント / 人間
**I want to** `vibepro execute merge` が block した時、stop_reason が実際の原因クラスを名指しし、
どの artifact がどの HEAD に束縛されているか・どのゲートがどの状態で block しているかを
1 コマンドで読める
**So that** ゲートが全部通っているのに「ゲート未達」と言われて誤った仮説を立てる時間を失わない

## Background

`src/merge-manager.js` の `executeMerge` は 5 箇所で `'gate_not_ready'` を
literal として stop_reason / reconciliation reason に積む
(`merge-manager.js:285`, `:301`, `:334`, `:413`, `:821`)。
一方 `buildMergeGateAuthorization` は拒否理由を 12 種類に区別している
(`gate_override_not_allowed`, `current_gate_status_unknown`,
`current_gate_status_not_ready`, `current_gate_status_contains_critical_gates`,
`gate_override_targets_mismatch` ほか)。この区別は
`merge.gate_authorization.reason` に残るが、stop_reason へは伝わらない。

さらに `executeMerge` は artifact を `isCurrentPrLifecycleArtifact` で
current HEAD に束縛してから `buildMergeGateAuthorization` へ渡すため、
「gate 評価は通るが artifact が stale」という状態が
`gate_override_not_allowed` → `gate_not_ready` に縮退する。これが PR #406 で
観測された誤誘導の物理そのものである。

## Acceptance Criteria

- [ ] AC-1: gate 証跡そのものが unresolved / critical で block している場合に限り
      `stop_reason` は `gate_not_ready` を返す
- [ ] AC-2: pr-create.json が存在しない / current HEAD に束縛されていないことが原因の場合、
      `stop_reason` は `pr_create_artifact_missing` / `pr_create_artifact_stale` を返す
- [ ] AC-3: pr-prepare.json の欠落・stale・routed gate-dag との surface 不一致が原因の場合、
      `stop_reason` は `pr_prepare_artifact_missing` / `pr_prepare_artifact_stale` /
      `gate_status_unresolved` を返す
- [ ] AC-4: waiver の不備・陳腐化が原因の場合、`stop_reason` は
      `gate_waiver_incomplete` / `gate_waiver_stale` を返す
- [ ] AC-5: `merge.gate_authorization_diagnosis` に cause / stop_reason /
      artifact 束縛状況 (pr_prepare / pr_create / gate_dag の current|stale|missing|unreadable と head sha) /
      blocking gate の id・severity・status / next_actions が構造化で記録される。
      pr-merge.json と `execute merge --explain` はこの全項目を読める。
      text summary と pr-merge.html は
      cause / stop_reason / explanation / blocking gate / artifact 束縛 (head sha 込み) を読めるが、
      next_actions は公開 projection (`--json`) と pr-merge.html には載せない。
      buildNextActions が出す 4 種のうち 3 種
      (`pr prepare --view blocking-gates` / `pr create` / `execute merge --explain`) は
      `PUBLIC_RECOVERY_COMMAND` allowlist を通らない。素の `pr prepare` だけは通るが、
      一部だけを公開面へ出すと「復旧手順の全体」に見えて誤誘導になるため、
      公開面では next_actions を丸ごと落とす方針を採る。
      text summary では reconciliation action が存在する時だけ抑止する
      (DRS-SCENARIO-008 は execute reconcile 単一 action に prepare/merge 系を
      混ぜないことを要求するが、その適用範囲は execution-state sync 失敗経路であり、
      gate block 経路では reconciliation action 自体が存在しない)。
      よって gate block 時の text summary は next_actions を出す —
      出さなければ原因だけがあってコマンドが 1 つも無い面になる。
      pr-merge.json と `execute merge --explain` は常に全項目を持つ
- [ ] AC-6: `vibepro execute merge <repo> --story-id <id> --explain` が read-only で診断を出力し、
      `git fetch` / `gh` を一切実行せず pr-merge.json を書き換えない
- [ ] AC-7: 公開 projection (`--json`) で新しい stop_reason と
      `gate_authorization_diagnosis` が定型文へ潰されない
- [ ] AC-8: 上記を固定する回帰テストがある
- [ ] AC-9: gate 証跡を 1 件も名指しできない状態で `gate_not_ready` を報告しない。
      unresolved gate を列挙できないまま authority が拒否された場合は
      `gate_status_unresolved` を返し、waiver 文書が critical gate を名乗っていても
      current gate status が critical を挙げていなければ `gate_waiver_stale` を返す

## Implementation Notes

- 新規: `src/merge-gate-diagnosis.js`（分類器 + artifact 束縛コンテキスト解決）
- 変更: `src/merge-manager.js`, `src/merge-public-projection.js`,
  `src/html-report.js`, `src/cli.js`
- 既存テスト `test/vibepro-cli.test.js` の `gate_not_ready` 断言のうち、
  fixture が artifact 束縛失敗・waiver 不備であるものは新しい stop_reason へ更新する
