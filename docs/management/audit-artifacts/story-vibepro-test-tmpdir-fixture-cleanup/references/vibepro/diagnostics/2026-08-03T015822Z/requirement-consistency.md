# Requirement Consistency

| 項目 | 内容 |
|------|------|
| Status | pass |
| Invariants | 3 |
| Scenario Gaps | 0 |
| Contradictions | 0 |
| Scanned Code Files | 1 |
| Requirement Sources | 1 |
| Spec Refs | 1 |
| Architecture Refs | 0 |
| Policy Refs | 0 |
| Domain Contract Refs | 0 |
| Responsibility Authority Matches | 0 |
| Responsibility Authority Unknowns | 0 |
| Structured Inherited Behavior Declarations | 0 |
| Legacy Keyword Resolutions | 0 |

## Invariants

- INV-001: Every test/**/*.{test,spec}.{js,ts,jsx,tsx,cjs,mjs} file whose source calls mkdtemp or mkdtempSync, or calls tmpdir()/os.tmpdir(), must import test/support/scratch-tmpdir.js; a conformance test enumerates all such files and fails, naming ev (inferred_spec:docs/management/stories/active/story-vibepro-test-tmpdir-fixture-cleanup.md)
- S-001: Given a process that imports test/support/scratch-tmpdir.js, when that process (or any code it runs in-process, or any child process it spawns via inherited environment variables) calls mkdtemp against os.tmpdir(), then the resulting direct (inferred_spec:docs/management/stories/active/story-vibepro-test-tmpdir-fixture-cleanup.md)
- S-002: Given a vibepro-scratch- directory left in the real $TMPDIR with an mtime older than 24 hours (e.g. from a process killed before its exit handler ran), when any process imports test/support/scratch-tmpdir.js, then that stale directory is re (inferred_spec:docs/management/stories/active/story-vibepro-test-tmpdir-fixture-cleanup.md)

## Scenario Gaps

- なし

## Potential Contradictions

- なし

## Structured Inherited Behavior Declarations

- なし

## Legacy Keyword Resolution Deprecations

- なし

## Requirement Sources

- spec: docs/specs/story-vibepro-test-tmpdir-fixture-cleanup.md: Test-suite scratch TMPDIR isolation Spec

## Responsibility Authority

- status: not_generated
- matched responsibilities: 0
- matched contract clauses: 0
- missing evidence: 0
- stale evidence: 0
- unregistered candidates: 0
