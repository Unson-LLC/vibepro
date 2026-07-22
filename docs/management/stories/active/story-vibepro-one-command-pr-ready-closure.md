---
story_id: story-vibepro-one-command-pr-ready-closure
parent_design: vibepro-autonomous-implementation-closure-roadmap
vibepro_story_id: story-vibepro-autonomous-implementation-closure-roadmap
title: 1コマンド自律実装を実Runtime E2Eで閉じる
status: active
view: dev
period: 2026-07
category: quality
related_stories:
  - story-vibepro-autonomous-action-dag
  - story-vibepro-production-runtime-connectors
  - story-vibepro-independent-review-orchestration
  - story-vibepro-guarded-autonomy-hardening
reason: "selected a real mutation-and-repair closure test instead of declaring completion from unit composition. compatibility: pr prepare Gate DAG remains the only PR-ready authority and merge remains explicit. rollback: keep the new actions behind the expanded DAG feature switch. boundary: final integration, operator UX and proof; component behavior stays owned by prior Stories."
created_at: 2026-07-21
updated_at: 2026-07-21
---

# 1コマンド自律実装を実Runtime E2Eで閉じる

## Acceptance Criteria

- [ ] OCR-S-1: 公開CLIはagentを起動しないという旧説明を削除し、guarded実行範囲と停止境界を正確に示す。
- [ ] OCR-S-2: 1コマンドでworktree作成、不足artifact準備、実装commit、検証、独立Review、修正commit、再検証、再Review、final prepareを実行する。
- [ ] OCR-S-3: current HEADの`pr-prepare.json`が`ready_for_pr_create=true`の場合だけRunが`pr_ready`になる。
- [ ] OCR-S-4: merge、critical waiver、external side effectは実行せずHuman Checkpointまたは明示操作へ残す。
- [ ] OCR-S-5: success、resume、human decision、verification failure、repair convergence、no-progress、quota、timeout、CI pending、cancelのE2E matrixがpassする。
- [ ] OCR-S-6: production connector smokeが実commitと独立Review identityを証明する。
- [ ] OCR-S-7: self-dogfoodでこのStory自身または専用fixture StoryがTrusted PR-readyへ到達する。

## Non Goals

- PRの自動createまたはmerge。
- 実Runtimeを使わないmock-only証跡によるロードマップ完了宣言。
