---
story_id: story-vibepro-publication-precheck
title: "OSS publication precheck"
source:
  type: local
  id: VP-PUBLICATION-001
  title: "Prepare VibePro for controlled OSS publication"
architecture_docs:
  reason: "Documentation, package metadata, and publication-readiness test updates only; no new runtime architecture or ADR is required."
status: active
created_at: 2026-05-27
updated_at: 2026-05-27
---

# Story: OSS publication precheck

## User Story

**As a** VibePro maintainer preparing an internal OSS publication explanation
**I want to** align package metadata, npm tarball contents, and publication-readiness evidence with the public positioning
**So that** VibePro can be explained and released as an alpha OSS project without losing the gate, review, waiver, and secret-scan audit trail.

## Background

VibePro is being prepared for a controlled public release. The repository already has OSS operation files, Apache-2.0 license metadata, marketing README updates, and an OSS readiness check pack. Before explaining the release internally, the publication state needs a concise report, npm package metadata that matches the positioning, and VibePro artifacts that record the remaining Scorecard waiver instead of leaving it only in conversation.

## Acceptance Criteria

- [ ] npm package description and keywords match the current public positioning.
- [ ] npm package dry-run includes the README header image used by the published README.
- [ ] npm package dry-run excludes `.vibepro/`, `node_modules/`, broad release docs, and unrelated internal artifacts.
- [ ] Publication precheck report records test, typecheck, npm package, secret scan, license, SBOM, vulnerability, Scorecard, and repo visibility status.
- [ ] Scorecard `needs_review` items are recorded as an accepted VibePro waiver for alpha publication.
- [ ] Unit/typecheck/package verification evidence is recorded in VibePro artifacts for the current git state.
- [ ] Existing OSS publication regression tests pass after README wording and package metadata changes.

## Implementation Notes

- Public positioning: "Stop babysitting AI. Ship what you meant to build."
- Target report: `docs/marketing/publication-precheck-2026-05-27.md`
- Package metadata target: `package.json`
- Regression tests: `test/vibepro-cli.test.js`
