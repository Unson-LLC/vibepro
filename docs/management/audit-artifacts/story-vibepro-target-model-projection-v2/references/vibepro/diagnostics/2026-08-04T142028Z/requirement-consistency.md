# Requirement Consistency

| 項目 | 内容 |
|------|------|
| Status | pass |
| Invariants | 24 |
| Scenario Gaps | 0 |
| Contradictions | 0 |
| Scanned Code Files | 0 |
| Requirement Sources | 14 |
| Spec Refs | 14 |
| Architecture Refs | 0 |
| Policy Refs | 0 |
| Domain Contract Refs | 0 |
| Responsibility Authority Matches | 0 |
| Responsibility Authority Unknowns | 0 |
| Structured Inherited Behavior Declarations | 0 |
| Legacy Keyword Resolutions | 0 |

## Invariants

- REQ-INV-001: TMP-S-6: rules[]・scope_roots・budgets は前段 story（governance rebaseline 時点、origin/main）の内容と完全一致する（投影が規範本文を書き換えていない）。 (story:docs/management/stories/active/story-vibepro-target-model-projection-v2.md)
- REQ-INV-002: loadTargetModel の model_version 検証（正の整数、欠落は null に degrade）を維持する。 (story:docs/management/stories/active/story-vibepro-target-model-projection-v2.md)
- REQ-INV-003: conformance の import scan 方式（PR #387）と既存出力スキーマを維持する。 (story:docs/management/stories/active/story-vibepro-target-model-projection-v2.md)
- REQ-SRC-001: Provider observationは同じdispatchへdeduplicateしてappendし、既存authority fieldを変更しない。 (spec:docs/specs/story-vibepro-explicit-run-attribution-lineage.md)
- REQ-SRC-002: Verification/review/decision/action artifactはactive Runが一意に解決できる場合にlineageまたは安定refを保存する。 (spec:docs/specs/story-vibepro-explicit-run-attribution-lineage.md)
- REQ-SRC-003: GEFR-I-2: Summary-depth evidence may skip heavyweight artifacts, but must (spec:docs/specs/story-vibepro-gate-efficiency-fast-readiness-spec.md)
- REQ-SRC-004: GEFR-I-4: Next-command metadata is guidance only; it must not change (spec:docs/specs/story-vibepro-gate-efficiency-fast-readiness-spec.md)
- REQ-SRC-005: Omitted --action-profile plus --until pr-ready --autonomy guarded selects (spec:docs/specs/story-vibepro-one-command-pr-ready-closure-test-plan.md)
- REQ-SRC-006: A material ambiguity must provide exactly the bounded decision fields (spec:docs/specs/story-vibepro-one-command-pr-ready-closure-test-plan.md)
- REQ-SRC-007: Negative boundary spies prove that the closure never invokes PR create, (spec:docs/specs/story-vibepro-one-command-pr-ready-closure-test-plan.md)
- REQ-SRC-008: SI-002: The intake schema must cover product/service, target users, jobs to be done, business purpose, route scope, current-code authority, desired and avoided impression, visual style, tone, color, typography, component, UI state, spacing/ (spec:docs/specs/story-vibepro-uiux-structured-intake.md)
- REQ-SRC-009: SI-003: uiux intake validate must emit machine-readable field coverage with explicit, inferred, missing, and not_applicable statuses. (spec:docs/specs/story-vibepro-uiux-structured-intake.md)
- REQ-SRC-010: SI-005: Vague-only free-form briefs must surface needs_intake_detail guidance while still allowing the plan command to complete. (spec:docs/specs/story-vibepro-uiux-structured-intake.md)
- REQ-SRC-011: SI-006: Coverage output must state that current route code and verified contracts win over intake text when they conflict. (spec:docs/specs/story-vibepro-uiux-structured-intake.md)
- REQ-SRC-012: validateAgentProvenance() grading is unchanged: reviewer identity never (spec:docs/specs/vibepro-agent-review-independence-provenance.md)
- REQ-SRC-013: Reviewer identity NEVER changes the gate's status/required or (spec:docs/specs/vibepro-agent-review-independence-provenance.md)
- REQ-SRC-014: ACD-INV-002: Missing env values must remain not_requested or (spec:docs/specs/vibepro-automation-cost-defaults.md)
- REQ-SRC-015: DSSOT-INV-002: The registry MUST model design roots and child docs without replacing Story, Architecture, Spec, Requirement, Responsibility Authority, or Design System gates. (spec:docs/specs/vibepro-design-ssot-reconciliation.md)
- REQ-SRC-016: DSSOT-INV-003: Reconciliation MUST prefer deterministic checks over LLM-only semantic contradiction claims. (spec:docs/specs/vibepro-design-ssot-reconciliation.md)
- REQ-SRC-017: DSSOT-INV-004: A missing registry MUST be not_applicable so existing repositories can adopt the feature gradually. (spec:docs/specs/vibepro-design-ssot-reconciliation.md)
- REQ-SRC-018: DSSOT-INV-005: A configured design root with missing required children or deterministic accepted ADR supersession conflict MUST be visible before PR creation. (spec:docs/specs/vibepro-design-ssot-reconciliation.md)
- REQ-SRC-019: DDP-INV-001: Required design diagram detection MUST preserve the file path (spec:docs/specs/vibepro-downstream-diagram-preflight.md)
- REQ-SRC-020: DDP-INV-002: PR readiness summaries MUST NOT downgrade a concrete (spec:docs/specs/vibepro-downstream-diagram-preflight.md)
- REQ-SRC-021: DDP-INV-003: Authority and security-sensitive contract artifacts MUST be (spec:docs/specs/vibepro-downstream-diagram-preflight.md)

## Scenario Gaps

- なし

## Potential Contradictions

- なし

## Structured Inherited Behavior Declarations

- なし

## Legacy Keyword Resolution Deprecations

- なし

## Requirement Sources

- spec: docs/specs/story-vibepro-explicit-run-attribution-lineage.md: Explicit Run Attribution Lineage Spec
- spec: docs/specs/story-vibepro-gate-efficiency-fast-readiness-spec.md: Spec
- spec: docs/specs/story-vibepro-one-command-pr-ready-closure-test-plan.md: One-command PR-ready Closure Test Plan
- spec: docs/specs/story-vibepro-uiux-structured-intake.md: story-vibepro-uiux-structured-intake Spec
- spec: docs/specs/vibepro-agent-review-independence-provenance.md: Spec
- spec: docs/specs/vibepro-automation-cost-defaults.md: Spec
- spec: docs/specs/vibepro-design-ssot-reconciliation.md: VibePro Design SSOT Reconciliation Spec
- spec: docs/specs/vibepro-downstream-diagram-preflight.md: VibePro Downstream Diagram Preflight Spec
- spec: docs/specs/vibepro-flow-design-event-path-noise.md: Flow Design Event Path Noise Spec
- spec: docs/specs/vibepro-managed-worktree-execution-dag.md: 仕様
- spec: docs/specs/vibepro-network-contract-gate-spec.md: Network Contract Gate Spec
- spec: docs/specs/vibepro-performance-evidence-framework.md: VibePro Performance Evidence Framework Spec
- spec: docs/specs/vibepro-review-authorization-scoring.md: Spec
- spec: docs/specs/vibepro-session-attribution-inference.md: Spec

## Responsibility Authority

- status: not_generated
- matched responsibilities: 0
- matched contract clauses: 0
- missing evidence: 0
- stale evidence: 0
- unregistered candidates: 0
