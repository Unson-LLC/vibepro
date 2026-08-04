---
story_id: story-vibepro-target-model-projection-v2
title: "target model projection v2 — 佐藤裁定済みの5問を target-model.json へ機械的に投影し model_version を 2 へ上げる"
status: active
view: dev
period: 2026-08
category: quality
parent_design: vibepro-target-model-governance-rebaseline
related_stories:
  - story-vibepro-target-model-governance-rebaseline
  - story-vibepro-conformance-delta-ledger
reason:
  decision: "docs/architecture/adjudication/target-model-rebaseline-cards.md の5問すべてに 2026-08-04 に佐藤圭吾が回答した（全問とも推奨案を採択）。この回答を target-model.json へ反映する操作は governance.machine_projection（人間が承認した裁定結果の target-model への反映 + 承認された改訂に伴う model_version のインクリメント）に該当するため、機械が投影する。具体的には (1) 新モジュール agent-runtime を新設して codex/agent runtime クラスタ8ファイルを割当、(2) 永続化クラスタ6ファイルを workspace-infra 4 / gate-pr 2 に分割、(3) merge 授権・公開投影クラスタ4ファイルを gate-pr へ、(4) 未宣言依存41ペアのうち declare 候補22件を allowed_dependencies へ一括宣言、(5) 残余孤児4件を review 3 / gate-pr 1 へ割当し、model_version を 1 -> 2、governance.adjudicated_at を 2026-08-04 へ更新する"
  alternatives: "(a) agent が裁定カードに自分で答えて反映する案は governance.human_adjudicated（モジュールの新設・allowed_dependencies への新規依存の宣言）に正面から抵触するため採らない。本storyは既に人間裁定が完了した結果の投影のみを行う。(b) 裁定結果を裁定カードにだけ記録して target-model.json へ反映しない案は、カードと正本モデルの二重管理を生み、conformance が旧モデルで計測し続けるため採らない。(c) declare候補22件を段階的に（edge数上位から）宣言する案は Q4 の選択肢2として提示され、佐藤が選択肢1（一括宣言）を採択したため採らない。(d) resolve 対象19件をこのstoryでコード修正する案は、裁定が『負債として ratchet gate の対象に残す』であり、投影の範囲を超えるため採らない。(e) model_version を据え置く案は governance.model_version_policy（human_adjudicated な改訂が反映されたときに +1）に反するため採らない"
  compatibility: "変更は docs/architecture/target-model.json のデータ変更と裁定カードのfrontmatter/本文追記のみで、コードの挙動変更は行わない。target-model.json のスキーマは既存フィールドを維持し、modules[] に1要素、allowed_dependencies に1キーと既存キーへの値追加のみを行う。model_version は 1 -> 2 の整数インクリメントであり loadTargetModel の検証（正の整数）を満たす。conformance の出力スキーマは変更しない。rules[] 本文・scope_roots・budgets は byte 単位で無変更"
  rollback: "docs/architecture/target-model.json と裁定カードの2ファイルを revert すれば model_version 1 の状態へ完全に戻る。コード変更・CLI変更・gate定義変更を含まないため、revert に伴う副作用は conformance の計測値が旧モデル基準へ戻ることのみ"
  boundary: "rules[] 本文の変更はしない（統治上の human_adjudicated 領域であり、今回の裁定対象外）。ratchet gate（新規悪化block）の導入はしない。resolve 対象19件のコード修正はしない。裁定カードの新規設問追加はしない。孤児/未宣言依存の ledger 化はしない（ratchet gate story のスコープ）。agent review の dispatch・adjudication・pr create・merge はこのstoryでは行わない（coordinator 担当）"
created_at: 2026-08-04
updated_at: 2026-08-04
---

# target model projection v2 — 佐藤裁定済みの5問を target-model.json へ機械的に投影し model_version を 2 へ上げる

## User Story

**As a** target architecture model を実際に執行可能な規範として使いたい開発者
**I want** 人間が裁定済みの5問の回答が target-model.json の正本へ漏れなく投影され、モデルに version が付き、投影前後の conformance delta が実測で確認できること
**So that** 「裁定は済んだがモデルには入っていない」状態が消え、以後の conformance 計測と ratchet gate 導入が、人間が承認した規範を基準に行えるようになる

## Context and Gap

- 前段 story（`story-vibepro-target-model-governance-rebaseline`, PR #424）で `governance` 三分法・`model_version`・rebaseline proposal generator・裁定カードが導入された。カードは `status: pending_adjudication` / `answered_at: null` のまま残されており、`docs/architecture/target-model.json` は `model_version: 1` のままである。
- 2026-08-04、佐藤圭吾が coordinator セッションの AskUserQuestion 経路で5問すべてに回答し、全問とも推奨案（選択肢1）を採択した。この回答は現時点でどのファイルにも記録されていない。
- 裁定の反映先は2箇所ある。裁定カード（回答の provenance を残す監査面）と target-model.json（conformance が読む正本）。片方だけを更新すると、正本とカードが乖離する。
- 前段 story 時点の実測（`vibepro architecture conformance .`）: 孤児 22 ファイル、未宣言依存 41 ペア。裁定の投影により孤児は 22 件中 22 件（Q1: 8, Q2: 6, Q3: 4, Q5: 4）が割当され、未宣言依存は declare 候補22件が宣言されて 41 -> 19 へ減る見込みである。ただし孤児をモジュールへ割り当てる操作は、それまで孤児ゆえに不可視だった import をモジュール間依存として顕在化させるため、投影後の実測で新規誘発が起きていないかを確認する必要がある。

## Acceptance Criteria

- [ ] TMP-S-1: `target-model.json` は新モジュール `agent-runtime` を持ち、その `responsibility` は外部agentプロセスの起動・出力契約・完了通知・進捗期限を表す。`paths` には Q1 の対象8ファイル（`codex-subagent-host.js`, `codex-subagent-host-worker.js`, `codex-subagent-runtime-adapter.js`, `codex-runtime-bridge.js`, `codex-runtime-output-contract.js`, `agent-completion-inbox.js`, `progress-deadline.js`, `verification-runner.js`）がすべて含まれる。
- [ ] TMP-S-2: Q2/Q3/Q5 の割当が `modules[].paths` に反映される。`atomic-file.js`・`canonical-persistence.js`・`process-record-store.js`・`story-transaction-lock.js` は `workspace-infra`、`decision-outcome-ledger.js`・`outcome-manager.js`・`merge-gate-authorization.js`・`merge-public-projection.js`・`reconciliation-action.js`・`task-bound-repo-control.js`・`budget-override-authority.js` は `gate-pr`、`review-inspection-inputs.js`・`review-surface-violations.js`・`dispatch-identity.js` は `review` に属する。
- [ ] TMP-S-3: `allowed_dependencies` に `agent-runtime: ["workspace-infra"]` が追加され、`run-session` の許可先に `agent-runtime` が含まれる（Q1 で承認された2宣言）。
- [ ] TMP-S-4: Q4 で承認された declare 候補22ペアがすべて `allowed_dependencies` で許可されている。resolve 対象19ペアは宣言されない（負債として残る）。
- [ ] TMP-S-5: `model_version` が 2 であり、`governance.adjudicated_at` が `2026-08-04` である。
- [ ] TMP-S-6: `rules[]`・`scope_roots`・`budgets` は前段 story（governance rebaseline 時点、`origin/main`）の内容と完全一致する（投影が規範本文を書き換えていない）。
- [ ] TMP-S-7: 裁定カード `docs/architecture/adjudication/target-model-rebaseline-cards.md` は `status: adjudicated` / `answered_at: 2026-08-04` を持ち、5問すべてについて採択された選択肢と回答 provenance（adjudicator: sato_keigo、経路: coordinator session AskUserQuestion）が記録される。
- [ ] TMP-S-8: 投影後に `architecture conformance . --base origin/main` を再実行した実測で、孤児件数と未宣言依存件数の減少、および `model_version_changed: true` が確認できる。新規に誘発された未宣言依存があれば宣言済みリストと突合して報告する。

## Inherited Behavior

- `loadTargetModel` の `model_version` 検証（正の整数、欠落は null に degrade）を維持する。
- conformance の import scan 方式（PR #387）と既存出力スキーマを維持する。
- `governance` 三分法の定義本文は変更しない（`adjudicated_at` の日付更新のみ machine_projection に含まれる）。

## Non Goals

- rules[] 本文の改訂。
- ratchet gate（新規悪化 block）の導入。
- resolve 対象19件のコード修正・モジュール間依存の解消。
- 孤児/未宣言依存の ledger 化。
- 裁定カードへの新規設問の追加。

## 初期タスク

1. 裁定結果の投影
   - `agent-runtime` モジュール新設と8ファイル割当
   - Q2/Q3/Q5 の14ファイルを既存モジュールへ割当
   - 承認済み allowed_dependencies 24宣言（Q1の2件 + Q4の22件）の反映
   - `model_version` 1 -> 2、`governance.adjudicated_at` 更新
2. 裁定カードへの回答記録
   - frontmatter（status / answered_at / provenance）と各問の採択選択肢
3. 投影の回帰テスト
   - モジュール存在・割当・宣言数・model_version・カード回答・rules[] 不変の検証
4. 実測の再取得
   - `architecture conformance . --base origin/main --json` で delta と誘発の有無を確認
