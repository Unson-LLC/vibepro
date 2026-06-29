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

- `CPB-CONTRACT-001`: `pr-body.md` MUST render the GitHub PR body as a self-contained human judgment brief.
- `CPB-CONTRACT-002`: The top-level sections MUST be `判断`, `経緯`, `原因`, `解決`, `レビュー観点`, `確認`, and `詳細`.
- `CPB-CONTRACT-003`: The GitHub PR body MUST NOT expand full Gate DAG nodes, Agent Review bodies, split-plan details, raw execution metadata, raw provider logs, or full lifecycle dumps.
- `CPB-CONTRACT-004`: The `詳細` section MUST include Gate status, Execution status, Scope status, runtime, and minimal `.vibepro/pr/<story-id>/` artifact entrypoints.
- `CPB-CONTRACT-005`: Gate DAG, Agent Review, split-plan, review cockpit, and decision-index artifacts MUST remain generated according to the evidence depth policy.
- `CPB-CONTRACT-006`: Self-dogfood PR body detection MUST accept the concise contract and MUST still reject raw GitHub PR bodies without VibePro evidence references.
- `CPB-CONTRACT-007`: The `確認` section MUST include a final E2E/flow confidence line when E2E or flow evidence exists, and must say it is unconfirmed when it does not.

## Scenarios

- `CPB-SCENARIO-001`: Given a normal VibePro PR prepare run, when `pr-body.md` is rendered, then the body has the Japanese judgment-brief structure and references `.vibepro/pr/<story-id>/`.
- `CPB-SCENARIO-002`: Given Agent Review and Gate DAG evidence exist, when `pr-body.md` is rendered, then their full details are not copied into the GitHub body.
- `CPB-SCENARIO-003`: Given a visible GitHub PR with a concise VibePro body and matching `pr-create.json`, when self-dogfood runs, then it passes the GitHub PR body check.
- `CPB-SCENARIO-004`: Given a visible GitHub PR with a generic raw `gh pr create` body, when self-dogfood runs, then it remains blocked.

## Invariants

- `CPB-INV-001`: PR body brevity must not change Gate readiness.
- `CPB-INV-002`: Artifact references are the audit path; GitHub body text is not the audit store.
- `CPB-INV-003`: Missing, stale, or failed evidence must remain visible as such in the concise `確認` or `詳細` summary.

## Verification

- `CPB-VERIFY-001`: CLI tests assert the Japanese PR body section order and `.vibepro` references.
- `CPB-VERIFY-002`: CLI tests assert detailed Gate DAG / Agent Review / split-plan headings are not emitted as full GitHub body sections.
- `CPB-VERIFY-003`: self-dogfood tests assert concise VibePro PR bodies pass while raw GitHub bodies fail.
