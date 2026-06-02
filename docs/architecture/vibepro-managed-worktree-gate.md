---
story_id: story-vibepro-managed-worktree-gate
title: VibePro管理worktree Gate Architecture
---

# アーキテクチャ

## 判断

`gate:managed_worktree` をPR Gate DAGの正式ノードとして追加し、PR本文、PR作成前検査、証跡記録、Agent Review記録で同じlocality判定を使う。

## 境界

VibeProは管理worktree内で作られた証跡かを判定する。実装エージェントを起動したり、外部runnerを管理したり、任意のユーザーworktreeを削除したりしない。

## Gate DAG

`gate:managed_worktree` は `gate:pr_body_contract` の後、`gate:change_classification` の前に置く。これはPR本文の判断材料と、その判断がどのcheckoutで作られたかを結びつけるため。

```text
gate:pr_route_classification
  -> gate:pr_body_contract
  -> gate:managed_worktree
  -> gate:change_classification
```

## Mode

| mode | DAG status | PR本文 | command enforcement |
| --- | --- | --- | --- |
| `required` outside | `block` | `needs_review` | `verify record` と `review record` を拒否する |
| `required` inside | `passed` | `passed` | 許可する |
| `preferred` outside | `needs_review` | `needs_review` | 許可する |
| `disabled` | `not_applicable` | `disabled` | 許可する |
| accepted waiver | `bypassed` | `bypassed` | 許可する |

## Bypass

Emergency bypassは `decision record --type waiver --source gate:managed_worktree` のaccepted decisionだけを認める。理由なしのwaiverは既存decision record側のバリデーションで拒否される。

## 状態解決

管理worktree内でコマンドを実行すると、execution stateが親checkout側にある場合がある。そのためlocal `.vibepro/executions/<story-id>/state.json` がない場合は、`git worktree list --porcelain` から同一Gitリポジトリの他worktreeを探索し、`managed_worktree.path` が現在のrepoを指すstateを採用する。

## 不変条件

- `required` の外部実行はPR作成でcritical unresolved gateになる。
- `preferred` は既存利用者を止めないが、人間向けPR本文とGate DAGに露出する。
- `disabled` は互換モードとして明示される。
- 証跡記録とAgent Review記録は、PR準備とは別入口でも同じlocality gateを通る。
