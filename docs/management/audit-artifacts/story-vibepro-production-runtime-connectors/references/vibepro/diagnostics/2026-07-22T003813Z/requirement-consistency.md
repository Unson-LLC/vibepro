# Requirement Consistency

| 項目 | 内容 |
|------|------|
| Status | pass |
| Invariants | 21 |
| Scenario Gaps | 0 |
| Contradictions | 0 |
| Scanned Code Files | 0 |
| Requirement Sources | 10 |
| Spec Refs | 7 |
| Architecture Refs | 3 |
| Policy Refs | 0 |
| Domain Contract Refs | 0 |
| Responsibility Authority Matches | 0 |
| Responsibility Authority Unknowns | 0 |
| Structured Inherited Behavior Declarations | 0 |
| Legacy Keyword Resolutions | 0 |

## Invariants

- REQ-INV-001: PRC-S-2: Claude Codeを利用可能な場合も同じcontractで選択でき、未設定時は明示的にunavailableになる。 (story:docs/management/stories/active/story-vibepro-production-runtime-connectors.md)
- REQ-INV-002: PRC-S-3: auth、capability、sandbox、quota、timeout、costが型付き結果へ正規化される。 (story:docs/management/stories/active/story-vibepro-production-runtime-connectors.md)
- REQ-SRC-001: Provider observationは同じdispatchへdeduplicateしてappendし、既存authority fieldを変更しない。 (spec:docs/specs/story-vibepro-explicit-run-attribution-lineage.md)
- REQ-SRC-002: Verification/review/decision/action artifactはactive Runが一意に解決できる場合にlineageまたは安定refを保存する。 (spec:docs/specs/story-vibepro-explicit-run-attribution-lineage.md)
- REQ-SRC-003: ACD-INV-002: Missing env values must remain not_requested or (spec:docs/specs/vibepro-automation-cost-defaults.md)
- REQ-SRC-004: DSSOT-INV-002: The registry MUST model design roots and child docs without replacing Story, Architecture, Spec, Requirement, Responsibility Authority, or Design System gates. (spec:docs/specs/vibepro-design-ssot-reconciliation.md)
- REQ-SRC-005: DSSOT-INV-003: Reconciliation MUST prefer deterministic checks over LLM-only semantic contradiction claims. (spec:docs/specs/vibepro-design-ssot-reconciliation.md)
- REQ-SRC-006: DSSOT-INV-004: A missing registry MUST be not_applicable so existing repositories can adopt the feature gradually. (spec:docs/specs/vibepro-design-ssot-reconciliation.md)
- REQ-SRC-007: DSSOT-INV-005: A configured design root with missing required children or deterministic accepted ADR supersession conflict MUST be visible before PR creation. (spec:docs/specs/vibepro-design-ssot-reconciliation.md)
- REQ-SRC-008: DDP-INV-001: Required design diagram detection MUST preserve the file path (spec:docs/specs/vibepro-downstream-diagram-preflight.md)
- REQ-SRC-009: DDP-INV-002: PR readiness summaries MUST NOT downgrade a concrete (spec:docs/specs/vibepro-downstream-diagram-preflight.md)
- REQ-SRC-010: DDP-INV-003: Authority and security-sensitive contract artifacts MUST be (spec:docs/specs/vibepro-downstream-diagram-preflight.md)
- REQ-SRC-011: completion conditionが異なるrunは同じmetricでも比較対象にしない (spec:docs/specs/vibepro-performance-evidence-framework.md)
- REQ-SRC-012: SAI-INV-001: Inference must be opt-in via --infer-session or (spec:docs/specs/vibepro-session-attribution-inference.md)
- REQ-SRC-013: SAI-INV-002: Inference must preserve candidate provenance and confidence. (spec:docs/specs/vibepro-session-attribution-inference.md)
- REQ-SRC-014: SAI-INV-003: Ambiguous attribution must not silently select a session. (spec:docs/specs/vibepro-session-attribution-inference.md)
- REQ-SRC-015: src/run-context-capsule.js: projects bounded lineage refs and confidence summaries, never transcripts or hidden reasoning. (architecture:docs/architecture/story-vibepro-explicit-run-attribution-lineage.md)
- REQ-SRC-016: The command then resolves and reuses an existing available managed execution before considering bootstrap, fails closed when a pre-existing managed binding is unavailable, never creates a replacement or nested managed worktree for that bind (architecture:docs/architecture/story-vibepro-guarded-run-session-contract.md)
- REQ-SRC-017: The option is never a silent no-op. (architecture:docs/architecture/story-vibepro-guarded-run-session-contract.md)
- REQ-SRC-018: Resume never repairs a stale HEAD, missing worktree, or worktree mismatch; source-root invocation is a control-plane alias for a managed Run, while the authoritative execution identity remains the managed root/Git directory/HEAD. (architecture:docs/architecture/story-vibepro-guarded-run-session-contract.md)
- REQ-SRC-019: human-decision-checkpoint.js: decisionの型、重複排除、永続化、回答検証、index再構築を所有する。 (architecture:docs/architecture/story-vibepro-human-decision-checkpoint.md)

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
- spec: docs/specs/vibepro-automation-cost-defaults.md: Spec
- spec: docs/specs/vibepro-design-ssot-reconciliation.md: VibePro Design SSOT Reconciliation Spec
- spec: docs/specs/vibepro-downstream-diagram-preflight.md: VibePro Downstream Diagram Preflight Spec
- spec: docs/specs/vibepro-performance-evidence-framework.md: VibePro Performance Evidence Framework Spec
- spec: docs/specs/vibepro-production-runtime-connectors.md: Production Runtime Connectors Spec
- spec: docs/specs/vibepro-session-attribution-inference.md: Spec
- architecture: docs/architecture/story-vibepro-explicit-run-attribution-lineage.md: Architecture
- architecture: docs/architecture/story-vibepro-guarded-run-session-contract.md: Architecture
- architecture: docs/architecture/story-vibepro-human-decision-checkpoint.md: Human Decision Checkpoint Architecture

## Responsibility Authority

- status: not_generated
- matched responsibilities: 0
- matched contract clauses: 0
- missing evidence: 0
- stale evidence: 0
- unregistered candidates: 0
