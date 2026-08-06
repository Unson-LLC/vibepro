---
title: Target Model Rebaseline — 裁定カード
status: adjudicated
parent_design: vibepro-target-model-governance-rebaseline
adjudicator: sato_keigo
answer_channel: coordinator session AskUserQuestion
answer_provenance: 2026-08-04 に佐藤圭吾が coordinator セッションの AskUserQuestion で全5問に回答（全問とも推奨案=選択肢1を採択）
projected_by_story: story-vibepro-target-model-projection-v2
projected_model_version: 2
answered_at: 2026-08-04
model_version_at_generation: 1
generated_from: .vibepro/architecture/rebaseline/proposal.json
measured_at_head: d4e46eb2
related_stories:
  - story-vibepro-target-model-governance-rebaseline
  - story-vibepro-target-model-projection-v2
---

# Target Model Rebaseline — 裁定カード（回答済み・2026-08-04）

`docs/architecture/target-model.json` の `governance.human_adjudicated` に該当する判断だけを5問に圧縮したもの。**agent はこのカードに回答しない。**

## 回答サマリー

| 問 | 採択 | 内容 |
|---|---|---|
| Q1 | 選択肢1（推奨） | 新モジュール `agent-runtime` を新設し8ファイルを割当。`agent-runtime: [workspace-infra]` と `run-session: [..., agent-runtime]` の2宣言を同時承認 |
| Q2 | 選択肢1（推奨） | 低レベル4件を `workspace-infra` へ、`decision-outcome-ledger`/`outcome-manager` を `gate-pr` へ |
| Q3 | 選択肢1（推奨） | 4件すべて `gate-pr` へ |
| Q4 | 選択肢1（推奨） | declare候補22件を一括宣言し、resolve 19件を負債として残す |
| Q5 | 選択肢1（推奨） | review由来3件を `review` へ、`budget-override-authority` を `gate-pr` へ |

- **裁定者**: sato_keigo（佐藤圭吾）
- **回答日**: 2026-08-04
- **回答経路**: coordinator セッションの AskUserQuestion
- **投影**: `story-vibepro-target-model-projection-v2` が `governance.machine_projection` として `target-model.json` へ反映し、`model_version` を 1 → 2 へインクリメント済み

## 前提（機械が既に処理済み・裁定不要）

- 機械保守範囲として5ファイルを既存モジュールへ割当済み（孤児 27 → 22、未宣言依存は 41 のまま増減なし）:
  `src/architecture-conformance-delta.js`・`src/architecture-rebaseline-proposal.js` → `architecture` / `src/docs-only-change.js` → `evidence` / `src/story-id.js`・`src/managed-command-executor.js` → `workspace-infra`
- 全候補・全根拠・誘発依存の一覧は `docs/architecture/target-model-rebaseline-proposal.md`（再生成可能）にある。カードを読むのにその資料は要らない。

---

## Q1. codex/agent runtime クラスタ（8ファイル）をどう扱うか

対象: `codex-subagent-host.js`, `codex-subagent-host-worker.js`, `codex-subagent-runtime-adapter.js`, `codex-runtime-bridge.js`, `codex-runtime-output-contract.js`, `agent-completion-inbox.js`, `progress-deadline.js`, `verification-runner.js`
（うち5件+2件が孤児同士のimportで連結した独立クラスタ。既存モジュールとの接点は run-session / evidence / graph / workspace-infra に分散）

1. **(推奨) 新モジュール `agent-runtime` を新設し、外部agentプロセスの起動・出力契約・完了通知・進捗期限をここに集める**
   帰結: 孤児22件中8件が解消。`run-session`（自律実行セッション制御）と `agent-runtime`（プロセス実行基盤）の責務が分離する。`allowed_dependencies` に `agent-runtime: [workspace-infra]` と `run-session: [..., agent-runtime]` の2宣言が必要（新規宣言=本裁定で同時承認）。クラスタが既存モジュールへ接点を持つのは run-session 経由が主で、逆転依存は増えない。
2. **`run-session` へ全件吸収する**
   帰結: 新モジュール宣言が不要で最小変更。ただし `run-session` は現在11ファイル・`guarded-run-session.js` 2,575行（予算超過中）で、さらに8ファイルが加わる。分割圧力を先送りする。
3. **codex系5件を `run-session` へ、`progress-deadline.js`/`verification-runner.js` を `evidence` へ分散する**
   帰結: 孤児は同じく解消するが、クラスタ内部のimport（`verification-runner` → `progress-deadline` 等）が `evidence` ↔ `run-session` のモジュール間依存として顕在化し、新規の未宣言依存が発生する。
4. **今回は裁定せず孤児のまま残す**
   帰結: 孤児22件が維持され、ratchet gate 導入時にこの8件は計測対象外のまま残る（不可視の負債が続く）。

**回答（2026-08-04, sato_keigo, coordinator session AskUserQuestion）: 選択肢1を採択。** 新モジュール `agent-runtime`（responsibility: 外部agentプロセスの起動・出力契約・完了通知・進捗期限）を新設し、対象8ファイルを割り当てる。`agent-runtime: [workspace-infra]` と `run-session` への `agent-runtime` 追加の2宣言を本裁定で同時承認する。

---

## Q2. 永続化クラスタ（6ファイル）をどう扱うか

対象: `atomic-file.js`, `canonical-persistence.js`, `process-record-store.js`, `story-transaction-lock.js`, `decision-outcome-ledger.js`, `outcome-manager.js`
（前4件がファイル/ロック/ストアの低レベル永続化、後2件が結果台帳。実測では4件が1クラスタとして連結し、接点は gate-pr / reporting / workspace-infra）

1. **(推奨) 低レベル4件（`atomic-file`, `canonical-persistence`, `process-record-store`, `story-transaction-lock`）を `workspace-infra` へ吸収し、`decision-outcome-ledger`/`outcome-manager` は `gate-pr` へ割り当てる**
   帰結: 孤児6件が解消。`workspace-infra` は「共有カーネル」の責務どおりに肥大するが R-001（他モジュールに依存しない）は維持される（4件は外部モジュールへのimportを持たない）。台帳2件は `gate-outcome-ledger.js` が既に居る `gate-pr` と同居する。
2. **新モジュール `persistence` を新設して6件全部を入れる**
   帰結: `workspace-infra` の肥大を避け、永続化の責務が独立する。`persistence: [workspace-infra]` の新規宣言に加え、台帳2件が gate-pr / reporting から使われるため `gate-pr: [..., persistence]`・`reporting: [..., persistence]` の宣言も必要になる（宣言3件）。
3. **6件すべてを `workspace-infra` へ吸収する**
   帰結: 最小の宣言変更。ただし `decision-outcome-ledger`/`outcome-manager` は gate-pr 側の概念を参照しており、`workspace-infra -> gate-pr`（既に R-001 違反 6 edges）をさらに太らせる可能性がある。
4. **今回は裁定せず孤児のまま残す**
   帰結: 孤児22件が維持される。

**回答（2026-08-04, sato_keigo, coordinator session AskUserQuestion）: 選択肢1を採択。** `atomic-file.js`・`canonical-persistence.js`・`process-record-store.js`・`story-transaction-lock.js` を `workspace-infra` へ、`decision-outcome-ledger.js`・`outcome-manager.js` を `gate-pr` へ割り当てる。新規 allowed_dependencies 宣言は不要。

---

## Q3. merge 授権・公開投影・調停クラスタ（4ファイル）をどう扱うか

対象: `merge-gate-authorization.js`, `merge-public-projection.js`, `reconciliation-action.js`, `task-bound-repo-control.js`

1. **(推奨) `gate-pr` へ全件割り当てる**
   帰結: 孤児4件が解消。`gate-pr` の責務（Gate DAG・PR準備・senior判断・監査）と merge 授権は同一の統治面であり、新規の allowed_dependencies 宣言を要さない。`gate-pr` は14 → 18ファイルになり、`pr-manager.js` 15,955行の分割圧力は変わらない。
2. **`merge-public-projection.js` は `reporting` へ、残り3件は `gate-pr` へ分ける**
   帰結: 公開投影（人間向け出力）と授権判断が分離する。`reporting` は既に `gate-pr` への依存を宣言済みのため新規宣言は不要。ただし投影と授権が同じPRで一緒に変わるたびに2モジュールを跨ぐ。
3. **新モジュール `merge-governance` を新設する**
   帰結: merge 授権が独立した統治面として可視化される。`merge-governance: [workspace-infra, gate-pr]` と、`workspace-infra`（`merge-manager.js`）からの参照をどう扱うかの追加判断が必要になり、R-001 逆転が1件増える恐れがある。
4. **今回は裁定せず孤児のまま残す**
   帰結: 孤児22件が維持される。

**回答（2026-08-04, sato_keigo, coordinator session AskUserQuestion）: 選択肢1を採択。** `merge-gate-authorization.js`・`merge-public-projection.js`・`reconciliation-action.js`・`task-bound-repo-control.js` の4件すべてを `gate-pr` へ割り当てる。新規 allowed_dependencies 宣言は不要。

---

## Q4. 未宣言依存41ペアをどう処理するか

内訳（機械仕分け済み）: **resolve 19件**（rules に抵触するか、宣言すると宣言済み循環になるもの。うち R-001 逆転 6件 = `workspace-infra -> gate-pr` 6 edges 他、R-002 逆転 3件）/ **declare候補 22件**（rules に抵触せず宣言で合法化できるもの。最大は `gate-pr -> uiux-design` 4 edges）

1. **(推奨) declare候補22件を一括で `allowed_dependencies` に宣言し、resolve 19件だけを負債として ratchet gate の対象に残す**
   帰結: 未宣言依存が 41 → 19 に減り、「宣言漏れ」と「規範違反」が混ざらなくなる。以後 R-004 は「未宣言の新規依存が増えたら止める」という執行可能な規範になる。宣言22件は現状のレイヤ構造を追認するもので、規範を緩めるのは `gate-pr -> uiux-design` 等の下向き依存の許容のみ。
2. **declare候補のうち上位5件（edge数2以上）だけ宣言し、残り17件は解消対象に回す**
   帰結: 宣言は最小限に留まるが、17件の1-edge依存が「違反」として残り続け、ratchet gate 導入時のノイズになる。
3. **41件すべてを解消対象（コード修正）として扱い、宣言は一切増やさない**
   帰結: モデルが最も厳格になる。ただし現行コードの41ペアすべてに改修が必要で、収束までの期間は ratchet gate を導入できない。
4. **今回は裁定せず全41件を未宣言のまま残す**
   帰結: R-004 は執行不能なまま維持される。

**回答（2026-08-04, sato_keigo, coordinator session AskUserQuestion）: 選択肢1を採択。** declare候補22件を一括で `allowed_dependencies` に宣言する。resolve 対象19件は宣言せず、負債として ratchet gate の対象に残す（ledger 化は別storyのスコープ）。

---

## Q5. 残余の責務不明瞭な孤児4件と review/gate-pr 境界

対象: `review-inspection-inputs.js`, `review-surface-violations.js`（機械スコアが `review` と `gate-pr` で同点）, `budget-override-authority.js`（`reporting` と `workspace-infra` で同点）, `dispatch-identity.js`（`run-session` 単独だが責務は review dispatch）

1. **(推奨) review 由来の3件（`review-inspection-inputs`, `review-surface-violations`, `dispatch-identity`）は `review` へ、`budget-override-authority` は `gate-pr` へ割り当てる**
   帰結: 孤児4件が解消。名称と責務の一致を優先し、機械スコアの同点をファイル名の意味で破る。`review -> gate-pr`（既に3 edges の違反）が太る可能性があり、Q4の resolve 対象として残る。
2. **4件すべて `gate-pr` へ割り当てる**
   帰結: 孤児は解消し、`review -> gate-pr` を太らせない。ただし `gate-pr` が22ファイルまで肥大し、review の検査入力が gate-pr 側に置かれる責務の逆流が起きる。
3. **`review` と `gate-pr` を1モジュールに統合する規範変更を行う**
   帰結: 同点問題と `review -> gate-pr` 違反3件が同時に消える。ただし rules ではなく modules の統廃合であり、統合後のモジュールは19ファイル・20,000行超になる。
4. **今回は裁定せず孤児のまま残す**
   帰結: 孤児22件が維持される。

**回答（2026-08-04, sato_keigo, coordinator session AskUserQuestion）: 選択肢1を採択。** `review-inspection-inputs.js`・`review-surface-violations.js`・`dispatch-identity.js` を `review` へ、`budget-override-authority.js` を `gate-pr` へ割り当てる。

---

## 回答後に機械が行ったこと（machine_projection・完了）

`story-vibepro-target-model-projection-v2` にて実施。

1. 承認された割当を `modules[].paths` へ反映（22ファイル）
2. 承認された新モジュール `agent-runtime` と新規 `allowed_dependencies` 24宣言（Q1の2件 + Q4の22件）を反映
3. `model_version` を 1 → 2 へインクリメント、`governance.adjudicated_at` を 2026-08-04 へ更新
4. `architecture conformance --base origin/main` を再実行し、`model_version_changed: true` 付きの delta を記録

### 投影後の実測（`vibepro architecture conformance .`）

| 指標 | 投影前 | 投影後 |
|---|---|---|
| 孤児ファイル | 23 | 1 |
| 未宣言依存 | 41 | 22 |
| 予算超過 | 11 | 11 |
| モジュール数 | 16 | 17 |

- 残存孤児1件は `src/scan-ignored-dirs.js`。カード生成（HEAD `d4e46eb2`）以降に追加されたファイルで本裁定5問の対象外。既存モジュールへの割当は `governance.machine_maintainable` に該当するため、別途機械保守で処理できる。
- 未宣言依存は 41 → 22。内訳は Q4 の resolve 対象19件（宣言せず負債として残す裁定どおり）+ **Q1 の新モジュール新設によって誘発された新規3件**:
  - `agent-runtime -> run-session`（3 edges）
  - `agent-runtime -> evidence`（1 edge）
  - `graph -> agent-runtime`（1 edge）
- この3件は Q1 で承認された宣言（`agent-runtime: [workspace-infra]` / `run-session: [..., agent-runtime]`）の範囲外であり、機械は宣言できない（新規 `allowed_dependencies` は `governance.human_adjudicated`）。とくに `agent-runtime -> run-session` は宣言済みの `run-session -> agent-runtime` と逆向きであり、宣言すれば循環になる。**次の裁定の対象**として resolve 側の負債に加わる。
- declare 候補22件はすべて宣言済みで、未宣言として残っているものはゼロ。
