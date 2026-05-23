---
story_id: story-vibepro-self-dogfood-ci-check
title: VibePro自身のCIでself-dogfood診断を回す
status: active
source:
  type: local_log_audit
  id: codex-claude-vibepro-gate-audit-2026-05-23
architecture_docs:
  - docs/architecture/vibepro-self-dogfood-ci-check.md
spec_docs:
  - docs/specs/vibepro-self-dogfood-ci-check.md
---

# Story

VibePro自身の開発でGate artifactの抜けが後から見つかった。CIでもself-dogfood診断を回し、少なくともOSS公開前にGate運用の劣化を可視化する必要がある。

## Acceptance Criteria

- GitHub Actionsで `vibepro check self-dogfood` が実行される。
- CIでは `vibepro check self-dogfood` を補助診断として実行し、JSON artifactで退行を可視化する。
- 診断結果はJSONとして出力できる。
- 通常の診断共有用途では `--fail-on-findings` 未指定ならexit 0を維持する。
- Storyごとのfinal Gate完了判定はPR作成前の `vibepro pr prepare` / `vibepro pr create` と、必要に応じた `vibepro check self-dogfood --story-id <story-id> --fail-on-findings` で強制する。
- 通常のtypecheck/test/pack checkと同じCI文脈で実行される。

## Tasks

- [x] CI workflowにself-dogfood checkを追加する。
- [x] check pack listにself-dogfoodを出す。
- [x] helpにself-dogfood checkを表示する。
- [x] CIとPR作成前Gateの責務境界を明記する。
