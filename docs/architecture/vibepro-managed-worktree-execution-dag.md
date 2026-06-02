---
story_id: story-vibepro-managed-worktree-execution-dag
title: VibePro管理worktree Execution DAG Architecture
---

# アーキテクチャ

## 判断

VibePro Execution Stateに管理worktree層を追加し、リポジトリを変更する通常開発の標準経路にする。

Execution DAGはStory開始からmerge/cleanupまでの経路を管理する。

```text
story_selected
  -> worktree_created
  -> branch_bound
  -> implementation_started
  -> implementation_complete
  -> verification_recorded
  -> pr_prepare_ready
  -> pr_created
  -> merge_ready
  -> merged_or_closed
  -> worktree_cleaned
```

## 境界

VibeProは隔離されたgit worktreeを作成・検証し、execution stateを記録し、command localityを強制し、PR/merge readinessを管理する。ただし、VibePro自身は実装エージェントにはならない。Codex、Claude Code、人間、または別runnerが管理worktree内でソースを編集する。

## 設定

project configで強制レベルを制御する。

```json
{
  "execution": {
    "managed_worktree": "required"
  }
}
```

許可するmode:

| Mode | 挙動 |
|------|----------|
| `required` | リポジトリを変更するVibePro commandはStoryの管理worktree内でのみ実行できる。 |
| `preferred` | 管理worktree外のcommandも許可するが、`gate:managed_worktree` warningとして記録する。 |
| `disabled` | 従来互換として管理worktreeを要求しない。 |

## 状態

正本stateは引き続き `.vibepro/executions/<story-id>/state.json` に置き、次の項目を追加する。

- `execution_id`
- `managed_worktree.mode`
- `managed_worktree.path`
- `managed_worktree.branch`
- `managed_worktree.base_ref`
- `managed_worktree.created_from_sha`
- `managed_worktree.current_head_sha`
- `managed_worktree.dirty_fingerprint`
- `managed_worktree.status`
- `execution_dag.nodes`
- `execution_dag.edges`

## 不変条件

- Gate DAGはPR readinessの正本であり続ける。
- Execution DAGは、Gate evidenceを信頼できるだけの監査可能な開発経路だったかを管理する。
- Verification evidenceとAgent Review evidenceは、管理worktreeのHEADとdirty fingerprintに束縛される。
- ルートcheckoutのdirty fileは、ユーザーが明示的にcommitするか管理branchへコピーしない限り、管理worktreeのPR scopeへ入らない。
- `execute merge` はopt-inであり、CI、review、freshness、Gate DAG、push状態、dirty状態が未解決なら拒否する。
- cleanupは、明示的な破壊確認なしに未commitの非VibePro fileを含むworktreeを削除してはいけない。

## 失敗時の扱い

worktree作成に失敗した場合、VibeProはgit command、target path、branch、復旧commandを表示する。`required` modeではexecutionをblockedのままにする。`preferred` modeではworktree外で継続できるが、bypassをExecution DAGとPR evidenceに記録する。
