---
story_id: story-vibepro-execute-merge-command
title: VibePro Execute Merge Command Spec
---

# 仕様

## コマンド

`vibepro execute merge [repo] --story-id <id> [--pr <url|number>] [--strategy merge|squash|rebase] [--delete-branch] [--dry-run] [--json]`

## 必須挙動

- `execute merge` は明示コマンドでのみ動作し、`pr create` や `pr ship` から暗黙実行してはいけない。
- Storyごとの `pr-create.json` から PR URL を解決する。`--pr` が与えられた場合はそれを優先する。
- PR URL も PR selector も解決できない場合、`status=blocked` として artifact を書き、終了コードは非0にする。
- merge前に次を確認する。
  - 最新 `pr-prepare` / `pr-create` artifact 上で Gate DAG が `ready_for_review`
  - local HEAD が remote PR head と一致している
  - latest base ref を fetch した結果、current HEAD が base を含んでいる
  - non-workspace dirty file がない
  - PR が draft ではない
  - PR state が `OPEN`
  - `statusCheckRollup` が全件 `COMPLETED` かつ failure conclusion を含まない
  - `reviewDecision` が `CHANGES_REQUESTED` または `REVIEW_REQUIRED` ではない
- いずれかが未達なら `gh pr merge` を実行せず、`status=blocked` を返す。
- `--dry-run` では external command を実行せず、予定コマンドと precondition summary のみ artifact に残す。
- `--strategy` は `merge|squash|rebase` のみ受け付ける。既定は `merge`。
- `--delete-branch` は opt-in とし、branch deletion failure は merge 成功と分離して `results[]` に残す。

## 生成物

- `.vibepro/pr/<story-id>/pr-merge.json`
- `.vibepro/pr/<story-id>/pr-merge.html`

`pr-merge.json` は少なくとも次を含む。

- `schema_version`
- `created_at`
- `mode=execute_merge`
- `dry_run`
- `story`
- `pr`
- `strategy`
- `delete_branch`
- `preconditions`
- `status`
- `stop_reason`
- `commands`
- `results`
- `merge_commit_sha`
- `merged_at`

## Manifest

`vibepro-manifest.json` に `pr_merges.<story-id>.latest_merge`, `latest_report`, `latest_pr_url`, `latest_merge_commit`, `latest_merged_at`, `latest_dry_run` を保存する。

## Execution State

- merge artifact が存在し、`status=ready_to_merge` の場合、Execution DAG の `merge_ready` は `passed`。
- merge artifact が存在し、`status=merged` の場合、Execution DAG の `merge_ready` と `merged_or_closed` は `passed`。
- merge artifact が存在し、`status=blocked` の場合、`merge_ready` は `blocked`。
- merge artifact が存在しないが `pr_created` の場合、`merge_ready` は `pending`。

## Managed Worktree

- `managed_worktree=required` の場合、`execute merge` は recorded managed worktree 外から拒否する。
- `preferred` の場合、将来の warning surface に備えて execution state の locality binding を維持する。
