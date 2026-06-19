# Architecture: PR Create Existing PR Refresh

## Boundary

変更対象は `vibepro pr create` の実行経路に限定する。

`pr prepare` は従来通りPR本文、Gate DAG、review cockpitを再生成し、`pr create` はその成果物をGitHub操作と `pr-create` artifactへ結び付ける。

## Flow

1. `vibepro pr create` は従来通り `pr prepare` を先に実行し、Gate/dirty worktreeを検査する。
2. feature branchをpushする。
3. `gh pr create` が成功すれば従来通り新規PR作成artifactを書く。
4. `gh pr create` が「既存PRあり」を示して失敗した場合だけ、同一base/headのopen PRを `gh pr list` で検索する。
5. 既存PRが見つかり、`headRefOid` が現在headと一致する場合、`gh pr edit --body-file` でPR本文を最新化し、`status: updated_existing_pr` の `pr-create.json` を書く。
6. 既存PRが見つからない、またはremote headが現在headと一致しない場合は失敗artifactを書いて停止する。

## Data Model

`pr-create.json` に次の情報を追加する。

- `status: updated_existing_pr`: 新規作成ではなく既存PRを更新したことを示す。
- `existing_pr`: `number`, `url`, `state`, `base_ref_name`, `head_ref_name`, `head_ref_oid`, `merge_state_status`, `body_updated` を持つ。
- `warnings`: 既存PR refreshであることをhuman-readableに残す。

## Risk Controls

- remote head不一致時はPR本文を更新しない。古いremote PRに最新bodyを載せると、artifactとGitHub実体の対応が崩れるため。
- 既存PR検索は `gh pr create` の既存PRエラー時だけ行う。通常PR作成経路の互換性と既存テストへの影響を抑えるため。
- `results` には失敗した `gh pr create`、既存PR検索、本文更新の各コマンド結果を残し、handoff先が経路を再構成できるようにする。
