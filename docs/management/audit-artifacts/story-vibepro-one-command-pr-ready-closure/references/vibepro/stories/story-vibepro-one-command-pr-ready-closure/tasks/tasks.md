# VibePro 生成タスク

| 項目 | 内容 |
|------|------|
| Story | 1コマンド自律実装を実Runtime E2Eで閉じる |
| Story ID | story-vibepro-one-command-pr-ready-closure |
| Run ID | 2026-07-24T013903Z |
| Gate | needs_review |
| タスク数 | 8 |

| ID | Finding | 優先度 | 対象 | 方針 | 状態 |
|----|---------|--------|------|------|------|
| story-vibepro-one-command-pr-ready-closure-01-arch-architecture-canonical-spec-test-plan | - | medium | 3件 | story-explicit-task | done |
| story-vibepro-one-command-pr-ready-closure-02-foundation-story-scope-task-projection-run-session | - | medium | 7件 | story-explicit-task | done |
| story-vibepro-one-command-pr-ready-closure-03-core-production-action-owner-repair-convergence | - | medium | 5件 | story-explicit-task | done |
| story-vibepro-one-command-pr-ready-closure-04-ux-1 | - | medium | 3件 | story-explicit-task | done |
| story-vibepro-one-command-pr-ready-closure-05-verify-acceptance-matrix-architecture-conformance | - | medium | 3件 | story-explicit-task | done |
| story-vibepro-one-command-pr-ready-closure-06-qa-dogfood-production-connector-vibe-pro-lifecycle | - | medium | 5件 | story-explicit-task | done |
| story-vibepro-one-command-pr-ready-closure-source-alignment-review | - | high | 12件 | source-alignment-review | done |
| VP-TASK-ARCH-001 | VP-ARCH-001 | medium | 1件 | split-runtime-boundaries | todo |

## story-vibepro-one-command-pr-ready-closure-01-arch-architecture-canonical-spec-test-plan: [ARCH] Architecture、canonical Spec、test planを確定する。

- Source: story_explicit_task / story-vibepro-one-command-pr-ready-closure-01-arch-architecture-canonical-spec-test-plan
- Execution: proposal_only / mutates_repository=false
- Target files: docs/architecture/story-vibepro-one-command-pr-ready-closure.md, docs/specs/story-vibepro-one-command-pr-ready-closure-test-plan.md, docs/specs/story-vibepro-one-command-pr-ready-closure.vibepro.json
- Target groups: -
- Read first: docs/management/stories/active/story-vibepro-one-command-pr-ready-closure.md
- Recommended strategy: story-explicit-task

完了条件:
- docs/architecture/story-vibepro-one-command-pr-ready-closure.md、docs/specs/story-vibepro-one-command-pr-ready-closure.vibepro.json、docs/specs/story-vibepro-one-command-pr-ready-closure-test-plan.mdがOCR-S-1..8、run-session callback注入、既存connector/review再利用、human authority境界を固定し、Design SSOTで整合する。

## story-vibepro-one-command-pr-ready-closure-02-foundation-story-scope-task-projection-run-session: [FOUNDATION] Story scope、Task projection、run-session所属を正本へ登録する。

- Source: story_explicit_task / story-vibepro-one-command-pr-ready-closure-02-foundation-story-scope-task-projection-run-session
- Execution: proposal_only / mutates_repository=false
- Target files: .vibepro/config.json, design-ssot.json, docs/architecture/target-model.json, src/safe-action-orchestrator.js, src/task-manager.js, test/safe-action-orchestrator.test.js, test/scope-boundary-gate.test.js
- Target groups: -
- Read first: docs/management/stories/active/story-vibepro-one-command-pr-ready-closure.md
- Recommended strategy: story-explicit-task

完了条件:
- .vibepro/config.json、design-ssot.json、src/task-manager.js、test/scope-boundary-gate.test.js、docs/architecture/target-model.json、src/safe-action-orchestrator.js、test/safe-action-orchestrator.test.jsがcurrent Story、全変更pathのexact Task target、repair後のverify/review suffix再実行、新ownerのrun-session所属、legacy profile互換を固定する。review継続専用の一時budget amendmentは最終PR surfaceから除去する。

## story-vibepro-one-command-pr-ready-closure-03-core-production-action-owner-repair-convergence: [CORE] production action ownerとrepair convergenceを実装する。

- Source: story_explicit_task / story-vibepro-one-command-pr-ready-closure-03-core-production-action-owner-repair-convergence
- Execution: proposal_only / mutates_repository=false
- Target files: src/agent-runtime-adapter.js, src/agent-runtime-connectors.js, src/guarded-run-session.js, src/independent-review-orchestrator.js, src/one-command-pr-ready-closure.js
- Target groups: -
- Read first: docs/management/stories/active/story-vibepro-one-command-pr-ready-closure.md
- Recommended strategy: story-explicit-task

完了条件:
- src/one-command-pr-ready-closure.js、src/guarded-run-session.js、src/agent-runtime-adapter.js、src/agent-runtime-connectors.js、src/independent-review-orchestrator.jsが実装objective、current-HEAD rebind、typed stop/resume、repair後のfresh review dispatchを閉じ、新ownerからCLIへの依存を作らない。

## story-vibepro-one-command-pr-ready-closure-04-ux-1: [UX] 1コマンドの公開契約を固定する。

- Source: story_explicit_task / story-vibepro-one-command-pr-ready-closure-04-ux-1
- Execution: proposal_only / mutates_repository=false
- Target files: src/cli.js, test/guarded-run-session.test.js, test/one-command-pr-ready-closure.test.js
- Target groups: -
- Read first: docs/management/stories/active/story-vibepro-one-command-pr-ready-closure.md
- Recommended strategy: story-explicit-task

完了条件:
- src/cli.js、test/one-command-pr-ready-closure.test.js、test/guarded-run-session.test.jsが省略時autonomousとcodex,claude-code provider順、explicit legacy、disable fallback、英日help、dry-run、JSON/human、status/resumeを証明する。

## story-vibepro-one-command-pr-ready-closure-05-verify-acceptance-matrix-architecture-conformance: [VERIFY] acceptance matrixとarchitecture conformanceを記録する。

- Source: story_explicit_task / story-vibepro-one-command-pr-ready-closure-05-verify-acceptance-matrix-architecture-conformance
- Execution: proposal_only / mutates_repository=false
- Target files: test/guarded-run-session.test.js, test/independent-review-orchestrator.test.js, test/one-command-pr-ready-closure.test.js
- Target groups: -
- Read first: docs/management/stories/active/story-vibepro-one-command-pr-ready-closure.md
- Recommended strategy: story-explicit-task

完了条件:
- test/one-command-pr-ready-closure.test.js、test/guarded-run-session.test.js、test/independent-review-orchestrator.test.jsがOCR-T-1..4、repair後の旧HEAD checkpoint無効化、既存公開help回帰を実装し、focused/full testsと最新main比target architecture conformanceをcurrent HEADへ記録する。

## story-vibepro-one-command-pr-ready-closure-06-qa-dogfood-production-connector-vibe-pro-lifecycle: [QA/DOGFOOD] production connectorとVibePro lifecycleを実証する。

- Source: story_explicit_task / story-vibepro-one-command-pr-ready-closure-06-qa-dogfood-production-connector-vibe-pro-lifecycle
- Execution: proposal_only / mutates_repository=false
- Target files: docs/management/stories/active/story-vibepro-autonomous-implementation-closure-roadmap.md, docs/management/stories/active/story-vibepro-independent-review-orchestration.md, docs/management/stories/active/story-vibepro-one-command-pr-ready-closure.md, docs/management/stories/active/story-vibepro-production-runtime-connectors.md, docs/specs/story-vibepro-one-command-pr-ready-closure-test-plan.md
- Target groups: -
- Read first: docs/management/stories/active/story-vibepro-one-command-pr-ready-closure.md
- Recommended strategy: story-explicit-task

完了条件:
- docs/specs/story-vibepro-one-command-pr-ready-closure-test-plan.mdのOCR-T-5を実commit、別identity review lifecycle、Gate、PR、CI import、current HEAD rebindの証跡で閉じ、Git文書完了後にvibepro execute mergeの監査証跡を永続化する。
- docs/management/stories/active/story-vibepro-production-runtime-connectors.mdをmerge済みPR #377の証跡で完了へ更新し、docs/management/stories/active/story-vibepro-independent-review-orchestration.mdをmerge済みPR #382の証跡で完了へ更新する。先行コードは二重実装しない。
- docs/management/stories/active/story-vibepro-one-command-pr-ready-closure.mdをdogfood、current-HEAD Gate、CIの証跡で完了へ更新し、docs/management/stories/active/story-vibepro-autonomous-implementation-closure-roadmap.mdを同じ証跡で完了へ更新する。roadmapのAIC-S-1..5が4 Storyの既存証跡へ追跡できる状態にし、当該PRのmerge SHAは同一commitの前提にせず、execute mergeが.vibepro/pr/.../pr-merge.jsonとcanonical auditへpost-merge confirmationとして記録する。

## story-vibepro-one-command-pr-ready-closure-source-alignment-review: Story/Spec/ADR不整合をレビューする

- Source: source_alignment_finding / story-vibepro-one-command-pr-ready-closure-source-alignment-review
- Execution: proposal_only / mutates_repository=false
- Target files: src/agent-runtime-adapter.js, src/agent-runtime-connectors.js, src/code-quality-scanner.js, src/nocodb-story-sync.js, src/one-command-pr-ready-closure.js, src/runtime-info.js, src/story-candidate-generator.js, src/story-catalog-generator.js, src/story-html.js, src/story-manager.js, src/story-run-portfolio.js, src/story-task-generator.js
- Target groups: -
- Read first: src/agent-runtime-adapter.js, src/agent-runtime-connectors.js, src/code-quality-scanner.js, src/nocodb-story-sync.js, src/one-command-pr-ready-closure.js, src/runtime-info.js, src/story-candidate-generator.js, src/story-catalog-generator.js
- Recommended strategy: source-alignment-review

完了条件:
- 各潜在バグ候補について、Story/Spec/ADR/コードのどれを修正するか判断している
- Graphifyのhub/communityを読んだ上で影響範囲を説明できる
- 要件が正しい場合はレビュー済み理由を正本またはPR本文に残している

## VP-TASK-ARCH-001: responsibility split campaignをStory化する

- Source: action_candidate / VP-ACTION-ARCH-001
- Execution: proposal_only / mutates_repository=false
- Target files: src/session-efficiency-audit.js
- Target groups: -
- Read first: src/session-efficiency-audit.js, src/cli.js, src/workspace.js, src/run-context-capsule.js, src/run-lineage.js, src/evidence-cost-budget.js, src/merge-manager.js
- Recommended strategy: split-runtime-boundaries

完了条件:
- campaign内の機会がStory単位として実装順に並んでいる。
- 最初に直す機会と後続に回す機会の判断根拠がscore/reasonで説明できる。
- 修正後のVibePro診断で対象findingまたはopportunityの件数差分を確認できる。
- 混在していた責務が読み取れる単位へ分離されている。
- 既存テストまたは型検査で入出力互換性が確認されている。
- VibePro診断で責務混在候補の根拠が減っている。