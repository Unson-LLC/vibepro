# VibePro 生成タスク

| 項目 | 内容 |
|------|------|
| Story | Thread分離に依存せずRun lineageでstory attributionを確定する |
| Story ID | story-vibepro-explicit-run-attribution-lineage |
| Run ID | 2026-07-21T120806Z |
| Gate | needs_review |
| タスク数 | 7 |

| ID | Finding | 優先度 | 対象 | 方針 | 状態 |
|----|---------|--------|------|------|------|
| story-vibepro-explicit-run-attribution-lineage-01-arch-guarded-run-agent-runtime-adapter-lineage-envelope-authority-provider-observation-mismatch-contract-session-efficiency-audit-module-architecture-spec | - | medium | 0件 | story-explicit-task | done |
| story-vibepro-explicit-run-attribution-lineage-02-core-dispatch-action-evidence-recorder-lineage-append-only | - | medium | 0件 | story-explicit-task | done |
| story-vibepro-explicit-run-attribution-lineage-03-audit-session-cost-run-resolver-story-attributed-shared-parent-other-story-unattributed-replayed-context | - | medium | 0件 | story-explicit-task | done |
| story-vibepro-explicit-run-attribution-lineage-04-handoff-context-capsule-pr-decision-surface-bounded-lineage-summary-ref | - | medium | 0件 | story-explicit-task | done |
| story-vibepro-explicit-run-attribution-lineage-05-qa-run-mixed-parent-provider-id-stale-head-vibe-pro-session-fresh-process-handoff-unit-e2-e-fixture | - | medium | 0件 | story-explicit-task | done |
| story-vibepro-explicit-run-attribution-lineage-source-alignment-review | - | high | 12件 | source-alignment-review | done |
| VP-TASK-ARCH-001 | VP-ARCH-001 | medium | 1件 | split-by-graph-community | todo |

## story-vibepro-explicit-run-attribution-lineage-01-arch-guarded-run-agent-runtime-adapter-lineage-envelope-authority-provider-observation-mismatch-contract-session-efficiency-audit-module-architecture-spec: [ARCH] 既存Guarded RunとAgent Runtime Adapterを基準にlineage envelope、authority、provider observation、mismatch contract、およびsession-efficiency auditから分離するmodule境界をArchitecture/Specへ固定する。

- Source: story_explicit_task / story-vibepro-explicit-run-attribution-lineage-01-arch-guarded-run-agent-runtime-adapter-lineage-envelope-authority-provider-observation-mismatch-contract-session-efficiency-audit-module-architecture-spec
- Execution: proposal_only / mutates_repository=false
- Target files: -
- Target groups: -
- Read first: docs/management/stories/active/story-vibepro-explicit-run-attribution-lineage.md
- Recommended strategy: story-explicit-task

完了条件:
- 診断結果を確認する

## story-vibepro-explicit-run-attribution-lineage-02-core-dispatch-action-evidence-recorder-lineage-append-only: [CORE] dispatch/action/evidence recorderへlineageの生成・検証・append-only永続化を追加する。

- Source: story_explicit_task / story-vibepro-explicit-run-attribution-lineage-02-core-dispatch-action-evidence-recorder-lineage-append-only
- Execution: proposal_only / mutates_repository=false
- Target files: -
- Target groups: -
- Read first: docs/management/stories/active/story-vibepro-explicit-run-attribution-lineage.md
- Recommended strategy: story-explicit-task

完了条件:
- 診断結果を確認する

## story-vibepro-explicit-run-attribution-lineage-03-audit-session-cost-run-resolver-story-attributed-shared-parent-other-story-unattributed-replayed-context: [AUDIT] session-costへRun resolverとstory_attributed/shared_parent/other_story/unattributed/replayed_context分類を追加する。

- Source: story_explicit_task / story-vibepro-explicit-run-attribution-lineage-03-audit-session-cost-run-resolver-story-attributed-shared-parent-other-story-unattributed-replayed-context
- Execution: proposal_only / mutates_repository=false
- Target files: -
- Target groups: -
- Read first: docs/management/stories/active/story-vibepro-explicit-run-attribution-lineage.md
- Recommended strategy: story-explicit-task

完了条件:
- 診断結果を確認する

## story-vibepro-explicit-run-attribution-lineage-04-handoff-context-capsule-pr-decision-surface-bounded-lineage-summary-ref: [HANDOFF] context capsuleとPR decision surfaceへbounded lineage summary/refを追加する。

- Source: story_explicit_task / story-vibepro-explicit-run-attribution-lineage-04-handoff-context-capsule-pr-decision-surface-bounded-lineage-summary-ref
- Execution: proposal_only / mutates_repository=false
- Target files: -
- Target groups: -
- Read first: docs/management/stories/active/story-vibepro-explicit-run-attribution-lineage.md
- Recommended strategy: story-explicit-task

完了条件:
- 診断結果を確認する

## story-vibepro-explicit-run-attribution-lineage-05-qa-run-mixed-parent-provider-id-stale-head-vibe-pro-session-fresh-process-handoff-unit-e2-e-fixture: [QA] 単一Run、mixed parent、provider id衝突、stale HEAD、VibePro外session、fresh-process handoffのunit/E2E fixtureを追加する。

- Source: story_explicit_task / story-vibepro-explicit-run-attribution-lineage-05-qa-run-mixed-parent-provider-id-stale-head-vibe-pro-session-fresh-process-handoff-unit-e2-e-fixture
- Execution: proposal_only / mutates_repository=false
- Target files: -
- Target groups: -
- Read first: docs/management/stories/active/story-vibepro-explicit-run-attribution-lineage.md
- Recommended strategy: story-explicit-task

完了条件:
- 診断結果を確認する

## story-vibepro-explicit-run-attribution-lineage-source-alignment-review: Story/Spec/ADR不整合をレビューする

- Source: source_alignment_finding / story-vibepro-explicit-run-attribution-lineage-source-alignment-review
- Execution: proposal_only / mutates_repository=false
- Target files: src/nocodb-story-sync.js, src/story-candidate-generator.js, src/story-catalog-generator.js, src/story-html.js, src/story-manager.js, src/story-task-generator.js, src/cli.js, src/workspace.js, src/diagnostic-engine.js, src/artifact-routing.js, src/architecture-profiler.js, src/playbook-exporter.js
- Target groups: -
- Read first: src/nocodb-story-sync.js, src/story-candidate-generator.js, src/story-catalog-generator.js, src/story-html.js, src/story-manager.js, src/story-task-generator.js, src/cli.js, src/workspace.js
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
- Recommended strategy: split-by-graph-community

完了条件:
- campaign内の機会がStory単位として実装順に並んでいる。
- 最初に直す機会と後続に回す機会の判断根拠がscore/reasonで説明できる。
- 修正後のVibePro診断で対象findingまたはopportunityの件数差分を確認できる。
- 混在していた責務が読み取れる単位へ分離されている。
- 既存テストまたは型検査で入出力互換性が確認されている。
- VibePro診断で責務混在候補の根拠が減っている。