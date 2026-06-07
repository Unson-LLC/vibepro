---
story_id: story-vibepro-execute-merge-command
title: VibePro Execute Merge Command Architecture
---

# 設計

`execute merge` は `pr create` の延長ではなく、Execution DAG の `pr_created -> merge_ready -> merged_or_closed` を実体化する別フェーズとして置く。責務は「merge可否の最終監査」と「merge結果の記録」であり、実装フェーズやreview evidenceの代替ではない。

## 境界

- `pr create` は PR を作るところで止まる
- `execute merge` は PR URL 解決、GitHub state 取得、freshness/check/review/dirty の前提確認、merge 実行、artifact 記録を持つ
- `execute cleanup` は今回の対象外

## 依存データ

- `.vibepro/pr/<story-id>/pr-prepare.json`
- `.vibepro/pr/<story-id>/pr-create.json`
- `.vibepro/executions/<story-id>/state.json`
- `git fetch origin <base>`
- `gh pr view`
- `gh pr merge`

## 判断モデル

merge可否は、VibeProがすでに持っている「PR作成時点の判断」と「merge直前のlive platform state」の積で決める。

- PR作成時点の判断: Gate DAG, execution gate, base ref, Story binding
- merge直前のlive state: remote head, mergeability, checks, review decision, draft/open state

どちらか一方だけでは不十分で、両方を artifact に残すことで「なぜこのPRをmergeしたか」を後から再構成できる。

## 非目標

- merge queue 連携
- auto-merge
- branch deletion の完全保証
- closed without merge の詳細追跡

MVPでは、manual/agent-driven merge の監査可能性を確立することを優先する。
