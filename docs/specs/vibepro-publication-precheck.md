---
story_id: story-vibepro-publication-precheck
title: "VibePro OSS publication precheck"
status: active
---

# VibePro OSS publication precheck

## Requirements

- VibePro must keep publication readiness decisions in repository documents and VibePro artifacts, not only in conversation.
- The npm package metadata must describe VibePro as product-intent gates and review evidence for AI coding agents.
- The npm package keywords must include AI agent, developer tooling, PR review, and software quality discovery terms.
- The npm dry-run package must include the README header image referenced by the README.
- The npm dry-run package must exclude `.vibepro/`, `node_modules/`, broad release docs, and unrelated internal documentation.
- The publication precheck report must summarize test, typecheck, npm package, install smoke, secret scan, license, SBOM, vulnerability, Scorecard, GitHub visibility, and CI state.
- Scorecard Packaging and Signed-Releases findings may be waived for alpha publication only when the waiver is recorded with reason and follow-up condition.
- Full test, typecheck, and npm pack verification must be recorded as VibePro verification evidence for the current git state.

## Verification

- `npm test`
- `npm run typecheck`
- `npm run pack:dry-run`
- `node --test --test-name-pattern 'package metadata|npm dry-run package' test/vibepro-cli.test.js`
- `gitleaks detect --source . --config .gitleaks.toml --no-banner --redact`
- `reuse lint`
- `vibepro check oss-readiness . --story-id story-vibepro-oss-apache2-readiness --run-id public-precheck-20260527 --json`
