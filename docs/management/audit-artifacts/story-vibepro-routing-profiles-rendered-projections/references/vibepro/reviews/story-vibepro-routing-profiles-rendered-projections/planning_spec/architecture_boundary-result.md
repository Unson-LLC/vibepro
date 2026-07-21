# Planning Spec Review: architecture_boundary

Status: needs_changes

The architecture needs explicit authority and writer boundaries before implementation.

- Story metadata authority and conflict behavior are unresolved.
- Lifecycle resolution paths are incomplete.
- The ownership/writer/read-authority matrix is missing.
- Task authority conflicts with the current machine-owned `tasks.json` model.
- Regression fixtures do not prove feature and governance profiles.

Inspected: Story, Architecture, spec draft, config, resolver and lifecycle writer code, and routing tests.
