---
story_id: story-vibepro-task-plan-overlap-refs
title: task-plan 0.2.0 に overlap_refs を追加する
status: active
view: dev
period: 2026-10
started_at: 2026-10-17
owner_repository: vibepro
brainbase_task_short_id: 8785f0ff
follow_on_task_short_id: 53a39f78
---

# task-plan 0.2.0 に overlap_refs を追加する

## Storyと利用者成果

Brainbase タスク T3（8785f0ff）の計画である。vibepro の task-plan `0.2.0` に `overlap_refs` を追加し、重なる Task がどの完了契約を共有するかを、契約本文ではなく参照だけで表せるようにする。

`completion_contract` の本文は Brainbase 側に置く。task-plan は `completion_contract_ref`（`id@version`）だけを持つ。後続の T4（53a39f78）は Story から task-plan を作る分解器で、この `overlap_refs` の形を出力する。T4 の分解手順、repo 選択、生成コマンドはこの Story では計画しない。

この文書は計画だけを表す。スキーマ実装、境界テストのコード、draft PR はこの Story の受入条件であり、この計画コミットには含まれない。

## 受入条件

- Unson-LLC/vibepro has a draft PR that adds overlap_refs to task-plan 0.2.0, with boundary tests.
- completion_contract lives on the Brainbase side, and task-plan holds only a reference to it. The schema or tests must show this.
- CI is green on that PR, and Maintainer gives a pass or a conditional pass. (The task text says Inspector; Inspector is retired, so Maintainer replaces it.)

## overlap_refs の形

`overlap_refs` は plan 文書の任意フィールドである。`schema_version` は `0.2.0` のままである。フィールドが無い既存の 0.2.0 plan は、今までどおり妥当である。

ある場合、値はオブジェクトの配列である。空配列は妥当である。各要素のフィールドは次の二つだけで、どちらも必須である。

| フィールド | 型 | 必須 | 意味 |
|---|---|---|---|
| `completion_contract_ref` | 空でない文字列 | 必須 | Brainbase 側 `completion_contract` への参照。`id@version`。最後の `@` で id と version に分ける。id も version も trim 後に空でない。 |
| `task_ids` | 空でない文字列の配列 | 必須 | この plan の中でその完了契約を共有する Task。2 件以上、重複なし。各値は `tasks[].task_id` と一致する。 |

正規化後、`task_ids` は辞書順、配列そのものは `completion_contract_ref` の辞書順になる。同じ `completion_contract_ref` を二度書くことは拒否する。

次は拒否する。

- 要素に `completion_contract`、`description`、`body`、`criteria`、`acceptance_criteria`、その他の未知フィールドがある。
- `completion_contract_ref` が `@` を含まない、または id か version が空である。
- `task_ids` が 2 件未満、重複、または plan に無い `task_id` を含む。
- `schema_version` が `0.2.0` でない。
- 0.1.0 の task authority 文書に `overlap_refs` がある。

`overlap_refs` は着手・検証・統合の停止条件にしない。既存の `dependencies[].kind === "overlap"` は着手を止めない、という現行の意味を変えない。`tasks[].contracts` はローカルの interface 契約本文のままで、`completion_contract` の本文をコピーしない。

`plan_version` は plan の必須文字列のままである。`overlap_refs` の要素は `plan_version` を持たない。`completion_contract_ref` の version は完了契約の版であり、plan の版ではない。

受理済み 0.2.0 authority は、入力にある `overlap_refs` を落とさず保持する。0.1.0 の許可フィールドには追加しない。

## 境界テスト

実装時に `test/task-plan.test.js` と `test/task-authority.test.js` へ追加する。

1. `overlap_refs` の無い 0.2.0 plan は妥当で、正規化結果にこのフィールドは出ない。
2. 妥当な `overlap_refs` は、ソート済み `task_ids` と `id@version` の参照として正規化結果に残る。
3. 要素に `completion_contract` オブジェクトがあると拒否する。
4. `@version` の無い `completion_contract_ref` は拒否する。
5. plan に無い `task_id` は拒否する。
6. `task_ids` が 2 件未満だと拒否する。
7. 同じ `completion_contract_ref` の重複は拒否する。
8. `schema_version` が `0.2.0` でない plan は、`overlap_refs` が妥当でも拒否する。
9. 0.1.0 authority 文書に `overlap_refs` があると未知フィールドとして拒否する。
10. `overlap_refs` があっても着手は止まらない。既存の overlap 依存は着手可能なままである。
11. 0.2.0 の bind と accepted read は `overlap_refs` を保持する。

## 対象外

- T4（53a39f78）の分解器そのもの。入力 Story からの生成手順、コマンド、テストは T4 が所有する。
- `completion_contract` 本文の保存、取得、Brainbase API。
- `schema_version` を `0.3.0` に上げること。
- `overlap_refs` を前提依存や merge を止める gate にすること。
- この計画コミットでの実装コードと PR。

## 開いている問い

同一 plan の `task_ids` だけで T4 の出力は足りる、という前提で形を固定した。一つの `completion_contract` が別 repository の plan に属する Task も束ねる場合、要素に既存 dependency の `target`（`repository`、`story_id`、`task_id`、外部なら `plan_version`）が要る。その要求はこの計画の入力には無かった。
