---
story_id: story-vibepro-pr-ship-command
title: VibePro PR ship Command Spec
---

# 仕様

## 必須挙動

- `vibepro pr ship [repo] --story-id <id> --base <ref> --head <branch>` を提供する。
- Shipは毎回 `preparePullRequest` を呼び、`.vibepro/pr/<story-id>/pr-prepare.json` とGate DAGを最新化する。
- Shipは `ship.safe_operations` に実行した `pr_prepare` を記録する。
- Gateがreadyでない場合、Shipは `status=blocked` と `stop_reason` を返す。
- Required Agent Reviewが未完了の場合、Shipは `required_agent_review` と `next_commands` に `review prepare`、`review start`、`review record` を含める。
- Gateがreadyの場合のみ、Shipは `vibepro pr create` 相当の `createPullRequest` に進む。
- `--dry-run` では `createPullRequest` を実行せず、`status=ready_for_pr_create` または `blocked` のJSONを返す。
- Shipは `next_commands` に raw `gh pr create` を含めない。

## JSON契約

`--json` は `ship` オブジェクトを返す。

- `status`
- `stop_reason`
- `safe_operations`
- `human_judgments_required`
- `required_agent_review`
- `next_commands`
- `raw_gh_pr_create_suggested=false`

## 回帰テスト

- CLI/unit: `test/vibepro-cli.test.js` の `pr ship dry-run reruns prepare...` で、dry-run JSON、Agent Review手順、raw GitHub CLI非提示を検証する。
- Story E2E: `test/e2e/story-vibepro-pr-ship-command-main.test.js` と `.spec.ts` で受け入れ基準の文言カバレッジを持つ。
