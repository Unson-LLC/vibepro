# Gate Evidence Review

Status: block

The version-bump merge has two npm publication owners: `post-merge-release.yml` publishes directly after creating a GitHub Release, while `npm-publish.yml` is triggered by `release.published`. These unsynchronized workflows can race the immutable npm version.

The focused tests pass, but do not invoke `reconcileNpmRelease` to prove gitHead match/mismatch, retry bounds, or dist-tag convergence.

Findings:

- `duplicate-npm-publish-trigger` (critical): make the post-merge workflow the sole publisher and assert that topology.
- `npm-reconciliation-evidence-missing` (high): add injected command-runner tests for reconciliation and retry behavior.
