# Planning Spec Review: spec_consistency

Status: needs_changes

The Spec covers the broad intent but leaves critical deterministic behavior undefined.

- Metadata authority and conflict handling are unresolved.
- The machine task model to Markdown renderer contract is absent.
- Ownership across lifecycle surfaces is underdetermined.
- Migration comparison baseline and lineage persistence are undefined.
- Existing regression references do not cover all lifecycle routes or both profiles.
- JSON and human-readable resolver report fields are not fixed by contract.

Inspected: Story, Architecture, spec draft, config, artifact resolver, Architecture/Spec/Task writers, CLI, and routing tests.
