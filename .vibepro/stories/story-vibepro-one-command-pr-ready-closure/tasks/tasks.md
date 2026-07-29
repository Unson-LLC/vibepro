# VibePro 生成タスク

| 項目 | 内容 |
|------|------|
| Story | 1コマンド自律実装を実Runtime E2Eで閉じる |
| Story ID | story-vibepro-one-command-pr-ready-closure |
| Run ID | dispatch-76d744478e3f04bc |
| Gate | stale_evidence |
| タスク数 | 3 |

| ID | Finding | 優先度 | 対象 | 方針 | 状態 |
|----|---------|--------|------|------|------|
| story-vibepro-one-command-pr-ready-closure:prepare-artifacts | gate:artifact_consistency | medium | 10件 | planning-artifact-recovery | planned |
| story-vibepro-one-command-pr-ready-closure-07-delivery-reconciliation-schema-0-2-0-post-merge-authority | - | medium | 7件 | story-explicit-task | done |
| VP-TASK-ARCH-001 | VP-ARCH-001 | medium | 1件 | split-runtime-boundaries | todo |

## story-vibepro-one-command-pr-ready-closure:prepare-artifacts: Prepare missing planning artifacts for current-head artifact consistency recovery

- Source: runtime_dispatch / dispatch-76d744478e3f04bc
- Execution: planning_artifacts_only / mutates_repository=true
- Target files: .vibepro/stories/story-vibepro-one-command-pr-ready-closure/tasks/tasks.json, .vibepro/stories/story-vibepro-one-command-pr-ready-closure/tasks/tasks.md, .vibepro/stories/story-vibepro-one-command-pr-ready-closure/tasks/story-vibepro-one-command-pr-ready-closure:prepare-artifacts/briefing.json, .vibepro/stories/story-vibepro-one-command-pr-ready-closure/tasks/story-vibepro-one-command-pr-ready-closure:prepare-artifacts/briefing.md, .vibepro/stories/story-vibepro-one-command-pr-ready-closure/tasks/story-vibepro-one-command-pr-ready-closure:prepare-artifacts/plan.json, .vibepro/stories/story-vibepro-one-command-pr-ready-closure/tasks/story-vibepro-one-command-pr-ready-closure:prepare-artifacts/plan.md, .vibepro/stories/story-vibepro-one-command-pr-ready-closure/tasks/story-vibepro-one-command-pr-ready-closure:prepare-artifacts/handoff.json, .vibepro/stories/story-vibepro-one-command-pr-ready-closure/tasks/story-vibepro-one-command-pr-ready-closure:prepare-artifacts/handoff.md, .vibepro/stories/story-vibepro-one-command-pr-ready-closure/tasks/story-vibepro-one-command-pr-ready-closure:prepare-artifacts/execution.json, .vibepro/stories/story-vibepro-one-command-pr-ready-closure/tasks/story-vibepro-one-command-pr-ready-closure:prepare-artifacts/execution.md
- Target groups: -
- Read first: docs/management/stories/active/story-vibepro-one-command-pr-ready-closure.md, docs/architecture/story-vibepro-one-command-pr-ready-closure.md, docs/specs/story-vibepro-one-command-pr-ready-closure.vibepro.json, .vibepro/pr/story-vibepro-one-command-pr-ready-closure/pr-prepare.json
- Recommended strategy: planning-artifact-recovery

完了条件:
- Task package exists for story-vibepro-one-command-pr-ready-closure:prepare-artifacts.
- Task package is bound to current HEAD a9109350819af99df22448d6ed8bd75adf611e36.
- Task package references the existing Story, Architecture, and Spec sources.
- Change surface is limited to VibePro planning artifacts.

## story-vibepro-one-command-pr-ready-closure-07-delivery-reconciliation-schema-0-2-0-post-merge-authority: [DELIVERY RECONCILIATION] schema 0.2.0でpost-merge authority同期を閉じる。

- Source: story_explicit_task / story-vibepro-one-command-pr-ready-closure-07-delivery-reconciliation-schema-0-2-0-post-merge-authority
- Execution: proposal_only / mutates_repository=false
- Target files: docs/management/stories/active/story-vibepro-one-command-pr-ready-closure.md, docs/architecture/story-vibepro-one-command-pr-ready-closure.md, docs/specs/story-vibepro-one-command-pr-ready-closure.vibepro.json, docs/specs/story-vibepro-one-command-pr-ready-closure-test-plan.md, src/execution-state.js, test/execution-state.test.js, test/e2e/story-vibepro-one-command-pr-ready-closure-runtime.spec.ts
- Target groups: -
- Read first: docs/management/stories/active/story-vibepro-one-command-pr-ready-closure.md
- Recommended strategy: story-explicit-task

完了条件:
- docs/management/stories/active/story-vibepro-one-command-pr-ready-closure.mdはdelivery reconciliationの受け入れ条件とTask surfaceを更新する。
- docs/architecture/story-vibepro-one-command-pr-ready-closure.mdはschema 0.2.0 ownership境界を更新する。
- docs/specs/story-vibepro-one-command-pr-ready-closure.vibepro.jsonは選択済みrouteだけを使うinvariantを追加する。
- docs/specs/story-vibepro-one-command-pr-ready-closure-test-plan.mdはmanaged/source authority同期シナリオを追加する。
- src/execution-state.jsは選択済みPR routeのtemplateだけでdirectory ownershipを判定し、未登録の架空Storyを解決しない。
- test/execution-state.test.jsはnamed profileとcatalog mirrorを持つmanaged/source authority間でartifactとstateが同期する回帰テストを追加する。
- test/e2e/story-vibepro-one-command-pr-ready-closure-runtime.spec.tsは同じschema 0.2.0 routeをStory E2E naming contract上で実行し、OCR-S-9をcurrent-HEADへ結合する。

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
