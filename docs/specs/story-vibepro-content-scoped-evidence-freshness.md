---
story_id: story-vibepro-content-scoped-evidence-freshness
title: Content Scoped Evidence Freshness Spec
parent_design: vibepro-content-scoped-evidence-freshness
diagrams:
  - kind: freshness_model
    mermaid: |
      flowchart LR
        Evidence["Recorded evidence"] --> Binding["content_binding"]
        Binding --> Surface["bound surface files"]
        Surface --> CurrentHash["current surface hash"]
        Binding --> RecordedHash["recorded surface hash"]
        CurrentHash --> Compare["compare"]
        RecordedHash --> Compare
        Compare -->|match| Current["current"]
        Compare -->|changed or missing| Stale["stale with changed_files / missing_files"]
        Binding -->|strict_head| LegacyHead["legacy HEAD freshness"]
  - kind: threat_model
    mermaid: |
      flowchart LR
        Actor["VibePro operator or agent"] --> Record["verify/review record"]
        Record --> Binding["content_binding surface"]
        Binding --> Asset["PR freshness and review gate decision"]
        Threat["Stale or over-broad evidence reuse"] --> Binding
        Binding --> Control["content hash comparison plus strict HEAD fallback"]
---

# Spec

## Contracts

### CEF-CONTRACT-001: Content binding is persisted with evidence

`verify record` and `review record` MUST persist a `content_binding` block when
the evidence can be tied to explicit targets, inspection inputs, or artifact
paths. The block MUST include the binding model, mode, recorded HEAD, normalized
surface files, missing files, and a deterministic surface hash.

### CEF-CONTRACT-002: Surface hash freshness

`pr prepare` MUST evaluate content-bound verification and review evidence by
rehashing the recorded surface. If the hash matches, the evidence is current even
when the repository HEAD changed after recording.

### CEF-CONTRACT-003: Bound surface changes invalidate evidence

If any bound surface file changes or disappears, `pr prepare` MUST mark the
evidence stale and include the changed or missing file paths in the binding
details.

### CEF-CONTRACT-004: Strict HEAD binding remains available

When evidence is recorded with strict HEAD binding, `pr prepare` MUST use the
legacy HEAD freshness model so any later commit invalidates the evidence.

### CEF-CONTRACT-005: Gate visibility

`gate:pr_freshness` MUST expose content binding details for verification and
review evidence, including the binding surface, stale reason, changed files,
missing files, recorded/current heads, and surface hashes.

### CEF-CONTRACT-006: Content surface is the default review freshness policy

Agent review recording MUST default to `content_surface`. Built-in high-risk
roles `gate_evidence` and `release_risk` MUST retain strict HEAD freshness
unless a role-specific policy explicitly opts that role into `content_surface`.
That opt-in is an operator-owned risk decision; the implementation MUST hash the
supplied inspection surface but MUST NOT claim to prove transitive impact
completeness. A global default MUST NOT weaken these built-in roles. An operator
MAY request strict HEAD binding for another role only when a non-empty
strict-head reason is supplied.

### CEF-CONTRACT-007: Passing review requires inspected judgment

A `pass` review MUST include an inspection summary, a judgment delta, and at
least one existing inspection input outside `.vibepro`. The persisted content
binding MUST include a content-bound file that intersects those actual
inspection inputs; an artifact path alone MUST NOT satisfy this contract.

### CEF-CONTRACT-008: Strict review preserves inspected surface

Strict HEAD freshness MUST change invalidation policy only. The review record
MUST still persist the inspected files and deterministic surface hash so a
handoff can reconstruct what the reviewer inspected.

## Scenarios

- `CEF-S-1`: Given verification evidence bound to a source file, when a later
  commit changes only docs, then `pr prepare` treats that evidence as current.
- `CEF-S-2`: Given verification evidence bound to a source file, when a later
  commit changes that source file, then `pr prepare` treats that evidence as
  stale and reports the changed file.
- `CEF-S-3`: Given review evidence bound to an inspected input, when only files
  outside that input change, then review status and PR readiness keep the review
  evidence current.
- `CEF-S-4`: Given evidence recorded with strict HEAD binding, when any later
  commit changes HEAD, then the evidence is stale.
- `CEF-S-5`: Given current or stale content-bound evidence, when
  `gate:pr_freshness` is emitted, then the gate details show the bound surface
  and freshness reason.
- `CEF-S-7`: Given a normal review role, when a pass is recorded without a
  freshness override, then the record uses content-surface freshness; a
  built-in high-risk role, a role policy carrying `freshness_reason`, or a
  reasoned CLI override may select strict HEAD freshness.
- `CEF-S-8`: Given a pass review missing an inspection summary, judgment delta,
  actual existing inspection input, or inspection-bound surface, then review
  recording fails with a specific validation error.
- `CEF-S-9`: Given a reasoned strict HEAD review, when it is recorded, then its
  strict invalidation mode and inspected surface/hash are both persisted.

## Verification

- Unit/CLI coverage records verification evidence, commits docs-only changes,
  and asserts the artifact consistency and PR freshness gates keep it current.
- Unit/CLI coverage changes a bound surface file and asserts stale status plus
  changed file diagnostics.
- Review coverage records `--inspection-input` evidence and asserts the same
  surface hash behavior.
- Strict HEAD coverage records `--strict-head-binding` evidence and asserts the
  legacy HEAD mismatch behavior.
- Review policy coverage asserts content-surface defaults, built-in strict
  roles that cannot be weakened by a global default, rejection of a global
  strict default, reason-required role policies, and reason-required CLI
  overrides, pass inspection requirements, and strict-mode surface persistence.
