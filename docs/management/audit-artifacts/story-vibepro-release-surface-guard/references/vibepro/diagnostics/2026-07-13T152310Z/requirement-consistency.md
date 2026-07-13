# Requirement Consistency

| 項目 | 内容 |
|------|------|
| Status | pass |
| Invariants | 8 |
| Scenario Gaps | 0 |
| Contradictions | 0 |
| Scanned Code Files | 1 |
| Requirement Sources | 2 |
| Spec Refs | 1 |
| Architecture Refs | 1 |
| Policy Refs | 0 |
| Domain Contract Refs | 0 |
| Responsibility Authority Matches | 0 |
| Responsibility Authority Unknowns | 0 |
| Structured Inherited Behavior Declarations | 0 |
| Legacy Keyword Resolutions | 0 |

## Invariants

- INV-001: Release-surface classification is deterministic code: raw gh pr create/merge, protected-branch git push, and deploy commands match; routine commands and vibepro's own commands never match. (inferred_spec:docs/management/stories/active/story-vibepro-release-surface-guard.md)
- S-001: When a release-surface command is checked while the selected story is not ready_for_pr_create, the guard exits non-zero and reports blocking gates and recovery commands. (inferred_spec:docs/management/stories/active/story-vibepro-release-surface-guard.md)
- S-002: When the bypass environment variable carries a non-empty reason, the guard allows the command and appends an audit record. (inferred_spec:docs/management/stories/active/story-vibepro-release-surface-guard.md)
- S-003: When the selected story is ready_for_pr_create the guard allows release-surface commands. (inferred_spec:docs/management/stories/active/story-vibepro-release-surface-guard.md)
- S-004: When the repository has no VibePro workspace or the guard is disabled, every command is allowed untouched. (inferred_spec:docs/management/stories/active/story-vibepro-release-surface-guard.md)
- C-001: guard install writes a marker-managed idempotent pre-push hook, refuses to overwrite foreign hooks, and the hook delegates only protected-branch refs; guard uninstall removes only vibepro-managed hooks. (inferred_spec:docs/management/stories/active/story-vibepro-release-surface-guard.md)
- C-002: guard install --claude merges a Bash-matcher PreToolUse hook into .claude/settings.json preserving existing keys, is idempotent, and the pretooluse mode extracts the tool command from stdin JSON and blocks with exit 2 plus stderr reason. (inferred_spec:docs/management/stories/active/story-vibepro-release-surface-guard.md)
- C-003: The guard key in .vibepro/config.json controls enablement, protected branches, and extra release patterns, and guard status reports hook state, configuration, and bypass record count. (inferred_spec:docs/management/stories/active/story-vibepro-release-surface-guard.md)

## Scenario Gaps

- なし

## Potential Contradictions

- なし

## Structured Inherited Behavior Declarations

- なし

## Legacy Keyword Resolution Deprecations

- なし

## Requirement Sources

- spec: docs/specs/vibepro-release-surface-guard.md: Spec
- architecture: docs/architecture/story-vibepro-release-surface-guard.md: アーキテクチャ

## Responsibility Authority

- status: not_generated
- matched responsibilities: 0
- matched contract clauses: 0
- missing evidence: 0
- stale evidence: 0
- unregistered candidates: 0
