---
story_id: story-vibepro-canonical-audit-artifacts
title: "Merge後の監査コアartifactをcanonicalに昇格する"
status: active
view: dev
period: 2026-06
source:
  type: value-audit
  id: VP-VALUE-AUDIT-2026-06-18-CANONICAL-AUDIT
architecture_docs:
  - docs/architecture/vibepro-canonical-audit-artifacts.md
spec_docs:
  - docs/specs/vibepro-canonical-audit-artifacts.md
---

# Story

VibeProの価値は、Gateがgreenになることではなく、merge後に別engineer/agentが判断経路を再構成できることにある。

現状は `.vibepro/` がgitignoreされ、PR準備・検証・review・mergeの証跡がworktree localに分散しやすい。これにより、main checkoutだけで `usage report` を実行すると、本来は別worktreeに存在する証跡を missing artifact と誤判定しやすい。

VibeProは成功した `execute merge` の後、監査に必要な最小JSON artifactを tracked な canonical audit bundle へ昇格し、main checkoutだけでもStory-to-PR-to-mergeの証跡を読める必要がある。

## Acceptance Criteria

- `execute merge` が `merged` になったとき、`docs/management/audit-artifacts/<story-id>/audit-bundle.json` を生成する。
- bundleは `pr-prepare.json`、`pr-create.json`、`gate-dag.json`、`verification-evidence.json`、`traceability.json`、`pr-merge.json` のうち存在するJSONを canonical path にコピーする。
- bundleは review の `review-summary.json`、`review-result-*.json`、`lifecycle.json` のうち存在するJSONを canonical path にコピーする。
- dry-run、blocked、failed mergeでは canonical昇格を行わない。
- `usage report` は `.vibepro/` が無い checkout でも canonical audit bundle を読み、merged storyを missing PR artifact と誤判定しない。
- canonical bundleはHTML、raw log、dispatch scratch、途中状態を含めず、監査コアJSONだけを永続化する。

## Non Goals

- `.vibepro/` 全体をgit管理すること。
- raw transcriptや一時ログをすべてmainへ保存すること。
- merge後のcanonical bundleを自動commit/pushすること。
