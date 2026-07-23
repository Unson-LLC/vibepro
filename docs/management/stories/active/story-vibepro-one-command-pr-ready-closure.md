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
updated_at: 2026-07-23
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
- [ ] OCR-S-8: merge済みPR #377と#382の証跡で先行2 Storyを完了へ整合し、OCR-S-1..8、dogfood、current-HEAD Gate、CIの証跡に基づいて最終Storyと親closure roadmapを完了へ閉じる。明示的な`execute merge`はGit文書完了後の監査確認として記録し、先行機能は再実装しない。

## Non Goals

- PRの自動createまたはmerge。
- 実Runtimeを使わないmock-only証跡によるロードマップ完了宣言。

## Implementation Tasks

1. `[ARCH]` Architecture、canonical Spec、test planを確定する。
   - `docs/architecture/story-vibepro-one-command-pr-ready-closure.md`、`docs/specs/story-vibepro-one-command-pr-ready-closure.vibepro.json`、`docs/specs/story-vibepro-one-command-pr-ready-closure-test-plan.md`がOCR-S-1..8、run-session callback注入、既存connector/review再利用、human authority境界を固定し、Design SSOTで整合する。
2. `[FOUNDATION]` Story scope、Task projection、run-session所属を正本へ登録する。
   - `.vibepro/config.json`、`design-ssot.json`、`src/task-manager.js`、`test/scope-boundary-gate.test.js`、`docs/architecture/target-model.json`、`src/safe-action-orchestrator.js`、`test/safe-action-orchestrator.test.js`がcurrent Story、全変更pathのexact Task target、repair後のverify/review suffix再実行、新ownerのrun-session所属、legacy profile互換を固定する。review継続専用の一時budget amendmentは最終PR surfaceから除去する。
3. `[CORE]` production action ownerとrepair convergenceを実装する。
   - `src/one-command-pr-ready-closure.js`、`src/guarded-run-session.js`、`src/agent-runtime-adapter.js`、`src/agent-runtime-connectors.js`、`src/independent-review-orchestrator.js`が実装objective、current-HEAD rebind、typed stop/resume、repair後のfresh review dispatchを閉じ、新ownerからCLIへの依存を作らない。
4. `[UX]` 1コマンドの公開契約を固定する。
   - `src/cli.js`、`test/one-command-pr-ready-closure.test.js`、`test/guarded-run-session.test.js`が省略時autonomousと`codex,claude-code` provider順、explicit legacy、disable fallback、英日help、dry-run、JSON/human、status/resumeを証明する。
5. `[VERIFY]` acceptance matrixとarchitecture conformanceを記録する。
   - `test/one-command-pr-ready-closure.test.js`、`test/e2e/story-vibepro-one-command-pr-ready-closure-runtime.spec.ts`、`test/guarded-run-session.test.js`、`test/independent-review-orchestrator.test.js`がOCR-T-1..4、workflow-heavy E2E replay、repair後の旧HEAD checkpoint無効化、既存公開help回帰を実装し、focused/full testsと最新main比target architecture conformanceをcurrent HEADへ記録する。
6. `[QA/DOGFOOD]` production connectorとVibePro lifecycleを実証する。
   - `docs/specs/story-vibepro-one-command-pr-ready-closure-test-plan.md`のOCR-T-5を実commit、別identity review lifecycle、Gate、PR、CI import、current HEAD rebindの証跡で閉じ、Git文書完了後に`vibepro execute merge`の監査証跡を永続化する。
   - `docs/management/stories/active/story-vibepro-production-runtime-connectors.md`をmerge済みPR #377の証跡で完了へ更新し、`docs/management/stories/active/story-vibepro-independent-review-orchestration.md`をmerge済みPR #382の証跡で完了へ更新する。先行コードは二重実装しない。
   - `docs/management/stories/active/story-vibepro-one-command-pr-ready-closure.md`をdogfood、current-HEAD Gate、CIの証跡で完了へ更新し、`docs/management/stories/active/story-vibepro-autonomous-implementation-closure-roadmap.md`を同じ証跡で完了へ更新する。roadmapのAIC-S-1..5が4 Storyの既存証跡へ追跡できる状態にし、当該PRのmerge SHAは同一commitの前提にせず、`execute merge`が`.vibepro/pr/.../pr-merge.json`とcanonical auditへpost-merge confirmationとして記録する。
