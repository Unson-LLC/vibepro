---
title: VibePro Downstream Diagram Preflight Spec
status: active
created_at: 2026-07-02
updated_at: 2026-07-02
related_stories:
  - story-vibepro-downstream-diagram-preflight
parent_design: vibepro-downstream-diagram-preflight
diagrams:
  - kind: threat_model
    mermaid: |
      flowchart LR
        Diff["Authority or contract artifact diff"] --> Resolver["diagram requirement resolver"]
        Resolver --> Gate["gate:design_diagrams"]
        Gate --> Action["operator insertion guidance"]
        Missing["Missing trigger path or kind"] --> Confusion["late or unrelated evidence refresh"]
        Action --> SpecTarget["Spec diagrams entry"]
    rationale: This Story changes how authority and contract artifacts surface security-sensitive diagram requirements before PR creation.
---

# VibePro Downstream Diagram Preflight Spec

## Invariants

- `DDP-INV-001`: Required design diagram detection MUST preserve the file path
  and signal that triggered each missing diagram kind.
- `DDP-INV-002`: PR readiness summaries MUST NOT downgrade a concrete
  downstream diagram requirement to a generic evidence refresh action.
- `DDP-INV-003`: Authority and security-sensitive contract artifacts MUST be
  detected by explicit artifact rules, not only by incidental substring matches.

## Contracts

- `DDP-CONTRACT-001`: `docs/responsibility-authority/**/*.json` changes require
  `threat_model` diagram evidence.
- `DDP-CONTRACT-002`: `docs/contracts/**/*.json` and `contracts/**/*.json`
  changes containing authority, permission, policy, credential, token, secret,
  session, OAuth, JWT, password, access-control, PII, or personal-data terms
  require `threat_model` diagram evidence.
- `DDP-CONTRACT-003`: `gate:design_diagrams.downstream_diagram_requirements[]`
  contains `kind`, `trigger_path`, `trigger_signal`, `insertion_target`,
  `tracked_spec_guidance`, and `minimal_diagram`.
- `DDP-CONTRACT-004`: `gate_status.critical_unresolved_gates[]`,
  `gate_status.execution_gate.blocking_gates[]`, and
  `gate_status.next_required_actions[]` preserve downstream diagram requirement
  guidance.
- `DDP-CONTRACT-005`: The minimal `threat_model` guidance uses a Mermaid
  `flowchart` shape accepted by the existing diagram validator.
- `DDP-CONTRACT-006`: The responsibility-authority rule is implemented as an
  explicit `RESPONSIBILITY_AUTHORITY_PATH.test(p)` branch so authority artifacts
  do not depend on generic security substring matching.
- `DDP-CONTRACT-007`: Existing webhook route diagram detection, including
  `/webhook(s)?/` path matching, remains compatible while the new
  authority/contract artifact rules are added.

## Scenarios

- `DDP-S-001`: Given a responsibility-authority JSON file changes and the Story
  Spec has no `threat_model`, when `pr prepare` runs, then the design diagram
  gate is critical and names the file path plus `threat_model`.
- `DDP-S-002`: Given a contract JSON file contains authority terminology and
  the Story Spec has no `threat_model`, when `pr prepare` runs, then the design
  diagram gate is critical and includes the insertion target.
- `DDP-S-003`: Given the design diagram gate is converted into execution-gate
  actions, then the next action includes the trigger path, diagram kind, and
  minimal Mermaid shape.

## Anti-patterns

- `DDP-AP-001`: Requiring operators to infer the missing diagram kind from a
  generic `spec.diagrams[]` message.
- `DDP-AP-002`: Refreshing unrelated evidence before surfacing a deterministic
  downstream diagram requirement.
- `DDP-AP-003`: Treating all contract files as security-sensitive without
  checking path or content signals.

## Verification

- `DDP-V-001`: Unit tests cover responsibility-authority resolver detection.
- `DDP-V-002`: Unit tests cover security-sensitive contract resolver detection.
- `DDP-V-003`: CLI tests cover downstream diagram requirement propagation into
  PR prepare gate status and next required actions.
- `DDP-V-004`: The full regression suite covers unchanged diagram resolver
  behavior, including existing webhook route detection.
