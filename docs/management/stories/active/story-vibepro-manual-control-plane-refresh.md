---
story_id: story-vibepro-manual-control-plane-refresh
title: VibePro manual and public control-plane refresh
status: active
view: dev
period: 2026-07
created_at: 2026-07-15
updated_at: 2026-07-15
parent_design: vibepro-manual-control-plane-refresh
reason: "A single public-manual refresh is preferred over scattered copy edits because positioning, command validity, release truth, navigation, SEO, and source exposure form one user journey. Compatibility impact is limited to documentation, VitePress build configuration, and documentation drift tests; production rollback restores the last known-good Cloudflare Pages deployment while source repair or revert remains a separate follow-up; architecture/spec/story internals remain repository-local and Brainbase remains an optional upstream context source."
---

# Story

VibePro's public manual describes an older, shorter workflow and exposes
repository-internal design artifacts in the public build. Several examples no
longer match the current CLI contract, while release channel and source commit
information are not explicit enough for users to distinguish the npm package
from current `main`.

## User Story

**As a** developer, independent reviewer, release operator, or engineering
manager evaluating VibePro<br>
**I want** a current, role-oriented manual with executable commands and explicit
release/source boundaries<br>
**So that** I can understand, adopt, review, and operate the complete guarded
delivery loop without mistaking internal artifacts or unreleased behavior for
the public product

## Scope

- Reposition VibePro as a repository-local control plane for evidence-backed,
  safe AI-agent delivery, while preserving the public promise that humans hold
  the entry and exit decisions.
- Document the current loop from Story through architecture/spec, code,
  verification, independent review/adjudication, release guard, PR, CI refresh,
  merge, canonical audit, and ROI reporting.
- Correct Japanese and English command examples and lifecycle/status contracts.
- Organize the manual around start, control loop, workflows, safety, and
  reference paths for four operator personas.
- Generate the CLI command-family reference from the shipped help contract and
  add a drift check.
- Make npm release channel, unreleased `main`, source commit, and changelog
  boundaries explicit.
- Exclude internal architecture/spec/story corpora from the public VitePress
  output while retaining curated public guides.
- Add sitemap, robots, llms.txt, Open Graph/Twitter metadata, and SoftwareApplication
  structured data.
- Add a clean-tree deployment preflight, exact commit provenance, live
  observability checks, and an executable rollback runbook for Cloudflare Pages.

## Acceptance Criteria

- [ ] MCPR-S-1: Japanese and English landing/overview pages explain the current
  positioning, non-goals, Brainbase boundary, and the full guarded delivery loop.
- [ ] MCPR-S-2: Getting-started, review, verification, PR, CI, and merge examples
  use arguments, stages, kinds, and statuses accepted by the current CLI.
- [ ] MCPR-S-3: Persona routes and navigation expose control-loop, safety,
  managed execution, release/audit, UI/UX, and Journey guidance.
- [ ] MCPR-S-4: CLI reference content is generated from the same help contract as
  `vibepro help`, and a test fails when generated docs drift.
- [ ] MCPR-S-5: Published npm beta, unreleased `main`, build source commit, and
  recent unreleased changes are clearly distinguished.
- [ ] MCPR-S-6: Public build excludes architecture/spec/story corpora and succeeds
  without broken links to excluded routes.
- [ ] MCPR-S-7: robots.txt, llms.txt, sitemap, social metadata, and JSON-LD are
  present in the built site.
- [ ] MCPR-S-8: Documentation build, command-contract tests, public route checks,
  and Story traceability evidence are recorded at the final commit.

## Non Goals

- Publishing a new npm release.
- Changing product command semantics or Gate behavior.
- Making Brainbase a required VibePro dependency.
- Publishing raw Architecture, Spec, Story, or runtime evidence directories.
