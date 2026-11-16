<!-- vibepro-projection story_id=story-vibepro-release-exact-sha-fast-path feature_slug=release-exact-sha-fast-path ownership=generated profile=feature_packet source=.vibepro/spec/story-vibepro-release-exact-sha-fast-path/spec.json source_sha256=b0ca42df10c34607a5ca0ea5d92cdd61907c01c66b489938d34782db5a5dd2ff renderer=functional_spec_markdown@1 direct_edit=false -->
- Canonical ownership: generated

# Functional Spec

- Story: story-vibepro-release-exact-sha-fast-path
- Status: -
- Clauses: 8

## C-001

The workflow summary evaluates whether merge-to-npm publication completed within the 120000 millisecond target and reports the measured result.

### Origin refs

- {"ac_id":"RELFAST-AC-008","kind":"acceptance_criteria"}
- {"anchor":"Record recovery state","file":".github/workflows/post-merge-release.yml"}
- {"anchor":"merge_to_npm_target_ms","file":"scripts/post-merge-release.mjs"}
- {"case":"RELFAST-AC-007/008 separates release stages and evaluates the 120 second target","file":"test/post-merge-release.test.js"}

## INV-001

The merge commit is eligible for CI reuse only when its ordered parents are the pull request base and reviewed head and its tree equals a freshly reconstructed merge tree.

### Origin refs

- {"ac_id":"RELFAST-AC-001","kind":"acceptance_criteria"}
- {"anchor":"selectReleaseValidationPath","file":"scripts/post-merge-release.mjs"}
- {"case":"RELFAST-AC-001/002/003 selects fast only for bound tree and exact-SHA trusted checks","file":"test/post-merge-release.test.js"}

## INV-003

Both validation modes retain the existing npm gitHead, dist-tag, git tag, and GitHub Release convergence checks.

### Origin refs

- {"ac_id":"RELFAST-AC-005","kind":"acceptance_criteria"}
- {"anchor":"reconcileGithubRelease","file":"scripts/post-merge-release.mjs"}
- {"anchor":"reconcileNpmRelease","file":"scripts/post-merge-release.mjs"}
- {"case":"PCR-CON-006 rejects an existing version with another gitHead","file":"test/post-merge-release.test.js"}

## INV-004

Unit and end-to-end tests cover fast reuse, full fallback, stale evidence, SHA mismatch, current-base mismatch, workflow mismatch, parent mismatch, tree mismatch, pagination, rerun pending state, foreign provenance, and Checks API failure.

### Origin refs

- {"ac_id":"RELFAST-AC-006","kind":"acceptance_criteria"}
- {"anchor":"selectReleaseValidationPath","file":"scripts/post-merge-release.mjs"}
- {"case":"RELFAST-AC-004 rejects stale evidence and exact-SHA mismatch","file":"test/post-merge-release.test.js"}
- {"case":"story-vibepro-release-exact-sha-fast-path replays real merge-tree binding and workflow fast/fallback branches","file":"test/e2e/story-vibepro-release-exact-sha-fast-path.test.js"}

## INV-005

Release timing records merge, publish start, npm publication, and workflow final-step timestamps and derives pre-publish, npm, post-publish, merge-to-npm, and total durations without fabricating rerun stages.

### Origin refs

- {"ac_id":"RELFAST-AC-007","kind":"acceptance_criteria"}
- {"anchor":"buildReleaseTiming","file":"scripts/post-merge-release.mjs"}
- {"case":"RELFAST-AC-007/008 timing CLI writes the decision surface to the workflow summary","file":"test/post-merge-release.test.js"}

## INV-006

Fast validation requires successful, completed, fresh test (20), test (22), and analyze check runs from the expected GitHub Actions workflow paths, signed with the current pull request number, base SHA, and exact reviewed head SHA.

### Origin refs

- {"ac_id":"RELFAST-AC-002","kind":"acceptance_criteria"}
- {"anchor":"REQUIRED_CHECK_WORKFLOWS","file":"scripts/post-merge-release.mjs"}
- {"anchor":"run-name","file":".github/workflows/ci.yml"}
- {"anchor":"run-name","file":".github/workflows/codeql.yml"}
- {"case":"RELFAST-AC-001/002/003 selects fast only for bound tree and exact-SHA trusted checks","file":"test/post-merge-release.test.js"}

## S-001

When every binding and evidence condition passes, the release workflow runs version checks, typecheck, release-focused tests, and npm pack without rerunning the full test suite.

### Origin refs

- {"ac_id":"RELFAST-AC-003","kind":"acceptance_criteria"}
- {"anchor":"Validate release candidate","file":".github/workflows/post-merge-release.yml"}
- {"case":"story-vibepro-release-exact-sha-fast-path replays real merge-tree binding and workflow fast/fallback branches","file":"test/e2e/story-vibepro-release-exact-sha-fast-path.test.js"}

## S-003

When CI evidence, current-base/workflow provenance, or source binding is absent, failed, pending, stale, mismatched, or untrusted, the read-only immutable-base selector records explicit reasons and the separate release job executes the full test suite.

### Origin refs

- {"ac_id":"RELFAST-AC-004","kind":"acceptance_criteria"}
- {"anchor":"Run full validation fallback","file":".github/workflows/post-merge-release.yml"}
- {"case":"RELFAST-AC-004 falls back for missing, failed, or pending exact-SHA checks","file":"test/post-merge-release.test.js"}

## Diagrams

- none
