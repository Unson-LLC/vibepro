# Safety Model

VibePro's safety model is based on bounded authority, current-head evidence, independent inspection, and fail-closed release operations.

## Authority Boundaries

- **Human:** product intent, material trade-offs, waivers, and final release authority.
- **Story / Architecture / Spec:** outcome, structural boundary, and testable contract.
- **Code and runtime:** actual behavior; generated narratives cannot override them.
- **Verification:** observed outcomes tied to a commit and durable artifact.
- **Independent reviewer / adjudicator:** inspection and judgment from a separate execution identity.
- **Gate DAG:** readiness synthesis; it reports missing proof but does not invent it.

Brainbase may supply upstream context. Graphify, codebase-memory, Journey packs, external design prompts, and generated screenshots are supporting evidence. None becomes implementation truth merely by being available.

## Fail-Closed States

- Missing or stale evidence remains `needs_evidence`.
- Required inspection that has not occurred remains `needs_review`.
- A violated condition remains `blocked` until fixed or handled by an explicit, attributable decision.
- A scanner that found no eligible targets is inconclusive, not proof of absence.
- Review records must include the correct stage, role, status (`pass`, `needs_changes`, or `block`), agent identity, inspection inputs, and a closed lifecycle.

## Decisions and Waivers

```bash
vibepro decision record . \
  --id <story-id> \
  --type waiver \
  --summary "<accepted residual risk>" \
  --reason "<why this is acceptable>" \
  --artifact <evidence-path> \
  --reviewer <identity> \
  --status accepted
```

A waiver is visible debt, not a passing test. Keep the source gate/finding, reason, evidence, owner, and status explicit.

## Release Boundary

`guard check`, `pr prepare`, `pr create`, and `execute merge` are the standard release path. Raw GitHub PR or merge commands bypass VibePro's current-head and waiver audit and should not be the normal path.
