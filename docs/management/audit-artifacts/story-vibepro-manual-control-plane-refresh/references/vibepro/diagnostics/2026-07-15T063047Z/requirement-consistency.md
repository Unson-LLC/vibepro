# Requirement Consistency

| 項目 | 内容 |
|------|------|
| Status | pass |
| Invariants | 8 |
| Scenario Gaps | 0 |
| Contradictions | 0 |
| Scanned Code Files | 0 |
| Requirement Sources | 0 |
| Spec Refs | 0 |
| Architecture Refs | 0 |
| Policy Refs | 0 |
| Domain Contract Refs | 0 |
| Responsibility Authority Matches | 0 |
| Responsibility Authority Unknowns | 0 |
| Structured Inherited Behavior Declarations | 0 |
| Legacy Keyword Resolutions | 0 |

## Invariants

- INV-001: The English and Japanese public overview MUST identify VibePro as a repository-local control plane and MUST keep final release authority with humans. (inferred_spec:docs/management/stories/active/story-vibepro-manual-control-plane-refresh.md)
- C-001: The generated CLI reference MUST equal the Usage section emitted by the current repository CLI for its language. (inferred_spec:docs/management/stories/active/story-vibepro-manual-control-plane-refresh.md)
- INV-002: Documentation builds MUST fail when either generated CLI reference is stale. (inferred_spec:docs/management/stories/active/story-vibepro-manual-control-plane-refresh.md)
- INV-003: The public VitePress build MUST NOT emit routes from Story, Architecture, Spec, contract, frame, marketing, playbook, or static-site internal corpora. (inferred_spec:docs/management/stories/active/story-vibepro-manual-control-plane-refresh.md)
- C-002: Every public manual build MUST expose robots.txt, llms.txt, sitemap metadata, social metadata, and SoftwareApplication JSON-LD. (inferred_spec:docs/management/stories/active/story-vibepro-manual-control-plane-refresh.md)
- C-003: The public manual MUST distinguish the published npm beta, unreleased main, deployed documentation commit, and local Story evidence authorities. (inferred_spec:docs/management/stories/active/story-vibepro-manual-control-plane-refresh.md)
- S-001: Given a reader in any of the four documented operator roles, when they open the landing page, then they receive a direct route to the relevant control, review, release, or management guidance. (inferred_spec:docs/management/stories/active/story-vibepro-manual-control-plane-refresh.md)
- S-002: Given a fresh documentation build, when its output is inspected, then public discovery files and source provenance exist while internal Story, Architecture, and Spec routes do not exist. (inferred_spec:docs/management/stories/active/story-vibepro-manual-control-plane-refresh.md)

## Scenario Gaps

- なし

## Potential Contradictions

- なし

## Structured Inherited Behavior Declarations

- なし

## Legacy Keyword Resolution Deprecations

- なし

## Requirement Sources

- なし

## Responsibility Authority

- status: not_generated
- matched responsibilities: 0
- matched contract clauses: 0
- missing evidence: 0
- stale evidence: 0
- unregistered candidates: 0
