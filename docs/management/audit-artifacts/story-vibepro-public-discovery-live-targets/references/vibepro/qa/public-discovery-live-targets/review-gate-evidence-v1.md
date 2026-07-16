# Gate Evidence Review v1

- reviewer: `/root/public_discovery_gate_review`
- reviewed_head: `90a0c100f4f1aaf993dcaf2e197d8e13082c8fa5`
- status: `needs_changes`

## Summary

Current-head evidence is fresh and focused tests pass, but the evidence set lacks required full-suite proof, contains a non-replayable integration command, and does not cover or expose all live-target paths and exclusions.

## Inspection

Verified a clean reviewed HEAD; inspected the Story/Spec, changed scanner/CLI/check-pack code, targeted and legacy tests, verification records, and built-site reports. Independently reran 8 new tests and 4 legacy Public Discovery regressions successfully; confirmed `CLAUDE.md` and `AGENTS.md` are identical. The reviewer did not run the full suite.

Evidence:

- `.vibepro/pr/story-vibepro-public-discovery-live-targets/verification-evidence.json`
- `.vibepro/checks/public-discovery/public-discovery-built-head-valid/check.json`
- `node --test test/public-discovery-live-targets.test.js` (8/8)
- targeted `test/vibepro-cli.test.js` Public Discovery regressions (4/4)
- `cmp -s CLAUDE.md AGENTS.md`

## Judgment delta

- Stale reuse initially raised a freshness concern; the five verification records are clean and strict-head-bound. Reuse is stale because the evidence set changed.
- Passing targeted tests initially supported approval; final status is `needs_changes` because AC-009 requires a successful full suite and the integration command is not replayable as written.
- Scanner-level live fixtures initially appeared sufficient; final path-surface judgment is incomplete because CLI-level `--base-url` and visible capped/cross-origin exclusion evidence are missing.

## Mandatory lenses

- regression_guard: `needs_changes` — focused regression and synchronization checks pass, but full-suite and Skill-lint proof required by the Story is absent.
- path_surface_coverage: `needs_changes` — source, built, invalid input, finding priority, JSON/Markdown, and scanner live behavior are covered; CLI live forwarding and visible sitemap omission/truncation evidence are not.

## Findings

1. `regression-full-suite-evidence-missing` (medium): record a successful current-head full suite and Skill lint evidence.
2. `command-reliability-integration-not-replayable` (medium): replace prose with the exact focused integration command and exit-derived artifact.
3. `path-surface-live-cli-unverified` (medium): add CLI-level `check public-discovery --base-url` and `check all --base-url` fixtures and report assertions.
4. `path-surface-sitemap-exclusions-silent` (medium): persist total/eligible/omitted counts or explicit warning evidence for cross-origin and cap exclusions.
