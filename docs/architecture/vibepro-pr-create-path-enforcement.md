---
story_id: story-vibepro-pr-create-path-enforcement
title: PR Create Path Enforcement Architecture
---

# Architecture

PR作成のhard gateは既存の `vibepro pr create` に置く。追加実装では、docs/skills/agent-instructionsの誘導文をself-dogfoodで監査し、raw `gh pr create` 推奨が混入した場合にfinding化する。

ローカル証跡だけでは、VibeProを通さないGitHub PRやinline bodyで本文が壊れたPRを見落とす。self-dogfoodは `gh pr view` が使える環境では現在branchのGitHub PR本文も読み、VibeProのdecision brief / Gate DAG / Execution Gateと `.vibepro/pr/<story-id>/pr-create.json` の対応を確認する。

## Decisions

- `gh pr create` 自体を禁止するshell wrapperは作らない。
- VibePro artifactとSkillsで正しい経路を強制する。
- self-dogfoodは否定文やguardrail文をfindingにしない。
- GitHub PR本文監査はbest-effortにする。`gh` 未導入、未認証、PR未作成はself-dogfoodのsetup failureにはせず、既存のローカルartifact監査を継続する。
- PRが見える場合、VibePro本文でないPR、literal `\n` を含むinline body、対応する有効な `pr-create.json` がないPRはblocking findingにする。有効な `pr-create.json` は non-dry-run、`mode: pr_create`、失敗status/errorなし、GitHub側URLと `pr_url` が一致し、GitHubが返すPR head SHAと `toolchain.source_git.commit` が一致する証跡に限定する。
