# Changelog

All notable changes to VibePro will be documented in this file.

## Unreleased

- Bind ordinary reviews to their inspected content surface while keeping
  `gate_evidence` and `release_risk` reviews strictly bound to the full commit.
  Passing `review record` calls must now include `--inspection-summary`, at least
  one existing non-`.vibepro` `--inspection-input`, and `--judgment-delta`;
  existing automation must add these arguments when upgrading.

## 0.2.0-beta.1 - 2026-07-18

- Add a deterministic post-merge release pipeline that projects PR release notes
  into the bilingual VitePress manual and changelog, then deploys the manual for
  every merged `main` pull request.
- Publish GitHub Releases and npm packages only when `package.json` advances,
  with retry-safe registry reconciliation and explicit SemVer dist-tags.
- Standardize PR release-note sections so the authoring LLM writes the release
  explanation once before merge and post-merge automation performs no LLM calls.

## 0.2.0-beta.0 - 2026-07-16

- Document the complete guarded delivery loop: managed execution, independent
  review and adjudication, release guard, PR/CI refresh, merge, canonical audit,
  and usage/ROI reporting.
- Generate the bilingual CLI reference from the current shipped help contract
  and fail documentation builds when it drifts.
- Separate the published npm beta from current `main` and expose the documentation
  build's source commit.
- Promote and verify both npm `beta` and `latest` dist-tags during publication.
- Restrict the public manual build to curated guide/reference content, require
  production deploys to match freshly fetched `origin/main`, and add
  robots, sitemap, llms.txt, social metadata, and structured data.
- Expand UI/UX, Journey, Design System, review lifecycle, decision, guard,
  execution, audit, and ROI documentation for current VibePro behavior.

## 0.1.0-alpha.0

- Prepare the project for Apache-2.0 OSS publication.
- Add phase checkpoints for Story, implementation start, test plan, implementation completion, verification, and PR readiness.
- Add public-discovery live, built-output, and source target discovery with bounded scans, explicit omissions, and fail-closed coverage reporting.
