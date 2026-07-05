# gate_evidence Agent Review

Agent: `019f31b1-9d6b-76d2-97a2-5c01ae801799`

Status: `needs_changes`

Summary: gate evidence is not ready because autopilot could skip stale passing
verification evidence by kind before rebinding to current git/content freshness.
The architecture `parent_design` frontmatter is present in the current file, but
generated gate artifacts need regeneration against the current file surface.

## Findings

- `gate-evidence-stale-pass-skip` (high): `autopilotPullRequest` built
  `passingKinds` from raw `readVerificationEvidenceIfExists` output and skipped
  configured commands by kind without requiring the existing pass to be current.
  This could suppress a required verification rerun after HEAD/content changes.
- `gate-evidence-stale-design-ssot-artifact` (medium): current architecture
  frontmatter contains `parent_design: vibepro-pr-evidence-autopilot`, while
  previously generated `.vibepro/pr/.../design-ssot-reconciliation.json` still
  reflected the old missing-frontmatter state.

## Inspection

The reviewer inspected the gate dispatch, review request, changed
implementation/docs/tests, verification evidence, evidence reuse, design SSOT
reconciliation, gate DAG, and PR prepare artifacts. Focused checks passed:

- `node --test --test-name-pattern "pr autopilot" test/vibepro-cli.test.js`
- `node --check src/pr-manager.js && node --check src/cli.js && node --check test/vibepro-cli.test.js`

Judgment delta:

- Previous `gate_evidence` pass is stale and not accepted as current.
- The `parent_design` update is confirmed in the current architecture file.
- `regression_guard` remains failed until stale passing verification cannot be
  skipped without rebinding.
- `path_surface_coverage` remains failed until stale-head or changed-content
  evidence reuse is covered by tests.
