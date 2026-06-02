---
story_id: story-vibepro-managed-worktree-execution-dag
title: VibePro管理worktree Execution DAG Spec
---

# 仕様

## 必須挙動

- `vibepro execute start <repo> --story-id <id> --target pr_create --base <ref>` は、`execution.managed_worktree` が `required` または `preferred` の場合、管理worktreeを作成または再利用する。
- デフォルトのworktree pathは、project configで上書きされない限り `.worktrees/vibepro/<story-id>-<shortid>` 配下にする。
- 管理branchは、ユーザーが `--branch` を渡さない限り `vibepro/<story-id>-<shortid>` のような決定的prefixを使う。
- VibeProはworktree metadataを `.vibepro/executions/<story-id>/state.json` に書き込む。
- `vibepro execute status/next/reconcile` はExecution DAG statusと管理worktree statusを含める。
- `vibepro task execute`, `vibepro verify record`, `vibepro review record`, `vibepro pr prepare`, `vibepro pr create` は、state fileが存在する場合、Storyの管理worktree内で実行されているかを検証する。
- `vibepro execute merge` をVibePro管理のmerge経路として導入する。ただし明示的なユーザー意図を必須にし、`pr create` から暗黙実行してはいけない。
- `vibepro execute cleanup` は、recorded executionとbranch/HEAD/stateが一致するVibePro所有worktreeだけを削除する。

## 管理worktree mode

| mode | command挙動 | Gate挙動 |
|------|---------------------------|---------------|
| `required` | 管理worktree外では拒否する。 | commandが管理worktree内で再実行されるか、supported emergency bypassが記録されるまで `gate:managed_worktree` がblockする。 |
| `preferred` | 管理worktree外では警告する。 | `gate:managed_worktree` は `needs_review` になり、PR body / Gate DAGへ表示される。 |
| `disabled` | localityを強制しない。 | `gate:managed_worktree` は省略または `not_applicable` になる。 |

## Execution DAGノード

最小node:

- `story_selected`
- `worktree_created`
- `branch_bound`
- `implementation_started`
- `implementation_complete`
- `verification_recorded`
- `agent_review_recorded`
- `pr_prepare_ready`
- `pr_created`
- `merge_ready`
- `merged_or_closed`
- `worktree_cleaned`

各nodeは次を含む。

- `id`
- `status`: `pending`, `passed`, `needs_evidence`, `needs_review`, `blocked`, `not_applicable`
- `required`
- `reason`
- `evidence`
- `next_commands`

## merge前提条件

`vibepro execute merge` は、次がすべてtrueでない限り拒否する。

- PR URLがVibePro `pr create` stateまたは明示PR lookupから分かる
- Gate DAGが `ready_for_review`
- Execution GateがPR作成を許可している、またはsupported waiverが記録されている
- 管理worktree branchがpush済み
- local HEADがremote PR headと一致している
- base branch freshness gateが満たされている
- 必須CI/check statusがpassing、またはdecision recordで明示waiveされている
- human/platform review policyが設定されている場合、それを満たしている
- 管理worktreeに非VibePro dirty fileがない

## 証跡の束縛

- Verification evidenceは管理worktree id/path、branch、HEAD、dirty fingerprintを記録する。
- Agent Review evidenceも同じbindingを記録する。
- PR prepareは、bindingが現在の管理worktree HEADまたはdirty fingerprintと異なる場合、evidenceをstale扱いにする。
- PR bodyは、管理worktree隔離が満たされたか、bypassされたか、disabledだったかを表示する。

## 互換性

- `execute start` なしの既存リポジトリは、`preferred` または `disabled` modeで動き続ける。
- worktree隔離の価値が薄いCIでは、`execution.managed_worktree=disabled` または明示CI mode flagを使える。
- Emergency bypassには理由が必要で、decision recordとして保存する。
- 実装は、ユーザー作成worktreeや非VibePro branchを削除してはいけない。

## MVP実装範囲

このPRでは、次の挙動を実装対象にする。

- `execution.managed_worktree` の初期値を `preferred` とし、`.worktrees/vibepro/` をignoreする。
- `vibepro execute start` が管理worktreeを作成または再利用し、`managed_worktree.mode/status/path/branch/base_ref/created_from_sha/current_head_sha/dirty/dirty_fingerprint` をstateへ保存する。
- `execute status/next/reconcile` が管理worktree状態とExecution DAGを返す。
- 管理worktreeが有効な場合、`pr_prepare` と `pr_create` のrequired commandおよび該当next actionは管理worktreeへの `cd` を含む。

`required` modeの拒否制御、PR evidence binding、merge、cleanup、emergency bypassは、このSpecの必須挙動として残すが後続Storyで実装する。
