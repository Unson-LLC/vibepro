# Release Risk Review — `14e002d`

```json
{
  "status": "needs_changes",
  "summary": "The public build, compatibility-route inventory, internal-corpus exclusion, clean-tree guard, provenance binding, and documented dashboard rollback are covered, but the new production deploy command does not enforce the architecture's clean merged-commit boundary: any clean feature-branch HEAD can be published as the `main` Pages deployment.",
  "inspection_summary": "Inspected the current-head release diff, architecture/Story rollout and rollback contracts, VitePress public-surface configuration, build/deploy scripts, Cloudflare reference, CLI-reference generator, and focused deployment/build compatibility tests; then compared the claimed clean merged-commit rollout boundary with the actual preflight checks.",
  "inspection_evidence": ".vibepro/qa/manual-control-plane-refresh/review-release-risk-14e002d.md",
  "inspection_inputs": [
    ".vibepro/reviews/story-vibepro-manual-control-plane-refresh/gate/review-request-release_risk.md",
    "git diff origin/main...14e002dc57ba659ce9877d712904fc11a057b98e",
    "docs/architecture/vibepro-manual-control-plane-refresh.md",
    "docs/management/stories/active/story-vibepro-manual-control-plane-refresh.md",
    "docs/reference/cloudflare-pages.md",
    "docs/ja/reference/cloudflare-pages.md",
    "docs/.vitepress/config.mjs",
    "package.json",
    "scripts/build-public-manual.mjs",
    "scripts/check-public-manual-build.mjs",
    "scripts/deploy-public-manual.mjs",
    "scripts/generate-cli-reference.mjs",
    "src/cli.js",
    "test/public-manual-deploy.test.js",
    "test/public-manual-build-contract.test.js",
    "test/public-manual-build-runner.test.js",
    "test/cli-reference-docs.test.js",
    "node --test --test-concurrency=2 test/public-manual-deploy.test.js test/public-manual-build-contract.test.js test/public-manual-build-runner.test.js test/cli-reference-docs.test.js (20/20 passed)"
  ],
  "judgment_delta": [
    "Initial concern: the docs-only refresh might regress routes or expose internal corpora -> current-head build contracts explicitly preserve required EN/JA routes, reject every listed internal corpus and forbidden route, validate discovery/social/provenance files, and the focused suite passed 20/20.",
    "Initial concern: provenance or rollback might be assertion-only -> deploy code derives the full clean HEAD, removes ambient CF_PAGES_COMMIT_SHA, checks built metadata, passes --commit-hash, and documents an out-of-band Cloudflare dashboard rollback; those concerns are sufficiently addressed.",
    "Initial expectation: the guarded deploy command would enforce the architecture's 'clean merged commit' production boundary -> final judgment changed to needs_changes because resolveCleanSourceCommit checks only worktree cleanliness and HEAD, while wranglerPagesArguments always labels the deployment --branch main; no current-branch, origin/main equality/ancestry, or explicit override guard exists or is tested."
  ],
  "findings": [
    {
      "severity": "high",
      "id": "release-risk-production-branch-boundary",
      "detail": "scripts/deploy-public-manual.mjs:13-24 accepts any clean Git HEAD, and lines 26-39 always pass --branch main. This contradicts docs/architecture/vibepro-manual-control-plane-refresh.md's rollout contract to deploy only from a clean merged commit. A clean feature branch or detached unmerged commit can therefore be published as the production/main Pages deployment with internally consistent but unauthorized provenance. Add a fail-closed production-source check (for example, require local HEAD to equal the fetched canonical origin/main, with any exceptional target/override explicit and audited) and add pre-fix-failing tests for clean feature-branch and stale-main cases before release."
    }
  ]
}
```
