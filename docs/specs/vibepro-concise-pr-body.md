---
story_id: story-vibepro-concise-pr-body
title: Concise GitHub PR body spec
diagrams:
  - kind: state
    title: Concise PR body evidence state
    mermaid: |
      stateDiagram-v2
        [*] --> ContextBuilt
        ContextBuilt --> ConciseBodyRendered
        ConciseBodyRendered --> EvidenceArtifactsLinked
        EvidenceArtifactsLinked --> ReadyForReview
---

# Spec

## Contracts

- `CPB-CONTRACT-001`: `pr-body.md` MUST render the GitHub PR body as a concise human decision brief.
- `CPB-CONTRACT-002`: The top-level sections MUST be `What`, `Why`, `How to review`, `Verification`, and `VibePro`.
- `CPB-CONTRACT-003`: The GitHub PR body MUST NOT expand full Gate DAG nodes, Agent Review bodies, split-plan details, raw execution metadata, raw provider logs, or full lifecycle dumps.
- `CPB-CONTRACT-004`: The `VibePro` section MUST include the Gate status, Execution status, Scope status, and `.vibepro/pr/<story-id>/` artifact references.
- `CPB-CONTRACT-005`: Gate DAG, Agent Review, split-plan, review cockpit, and decision-index artifacts MUST remain generated according to the evidence depth policy.
- `CPB-CONTRACT-006`: Self-dogfood PR body detection MUST accept the concise contract and MUST still reject raw GitHub PR bodies without VibePro evidence references.

## Scenarios

- `CPB-SCENARIO-001`: Given a normal VibePro PR prepare run, when `pr-body.md` is rendered, then the body has the concise five-section structure and references `.vibepro/pr/<story-id>/`.
- `CPB-SCENARIO-002`: Given Agent Review and Gate DAG evidence exist, when `pr-body.md` is rendered, then their full details are not copied into the GitHub body.
- `CPB-SCENARIO-003`: Given a visible GitHub PR with a concise VibePro body and matching `pr-create.json`, when self-dogfood runs, then it passes the GitHub PR body check.
- `CPB-SCENARIO-004`: Given a visible GitHub PR with a generic raw `gh pr create` body, when self-dogfood runs, then it remains blocked.

## Invariants

- `CPB-INV-001`: PR body brevity must not change Gate readiness.
- `CPB-INV-002`: Artifact references are the audit path; GitHub body text is not the audit store.
- `CPB-INV-003`: Missing, stale, or failed evidence must remain visible as such in the concise Verification or VibePro summary.

## Verification

- `CPB-VERIFY-001`: CLI tests assert the concise PR body section order and `.vibepro` references.
- `CPB-VERIFY-002`: CLI tests assert detailed Gate DAG / Agent Review / split-plan headings are not emitted as full GitHub body sections.
- `CPB-VERIFY-003`: self-dogfood tests assert concise VibePro PR bodies pass while raw GitHub bodies fail.
