---
story_id: story-vibepro-release-0-2-0-beta-2
title: Release 0.2.0-beta.2 contract
parent_design: story-vibepro-release-0-2-0-beta-2
status: active
---

# Release 0.2.0-beta.2 contract

## Requirements

- REL-1 (contract): `package.json` declares version `0.2.0-beta.2`, which makes the
  post-merge continuous-release trigger true — `shouldReleaseVersion` compares the
  merged version against the pre-merge one and the workflow publishes only on an
  increase.
- REL-2 (contract): `CHANGELOG.md` carries a dated `## 0.2.0-beta.2 - 2026-07-29`
  section enumerating the user-facing changes since beta.1 — `verify run`, the
  26-key `--observed` rejection, the read-time classification narrowing, the
  per-file typecheck, risk-adaptive validation sequencing, content-surface review
  binding, and task-scoped acceptance — and the `## Unreleased` section remains
  present and empty.
- REL-3 (invariant): the release diff contains no `src`, `bin` or dependency changes
  and no test behavior changes; the published package content is byte-identical to
  merged main, and the recorded typecheck and unit runs prove the unchanged tree
  still passes. Two test-expectation pins are updated as release mechanics: the OSS
  metadata check's hardcoded version expectation moves to `0.2.0-beta.2` (a bump PR
  must always update this pin in the same PR), and the adjudication suite count pin
  moves from `/pass 18/` to `/pass 19/`, correcting the cross-PR conflict between
  merged PR #394 (which pinned 18) and merged PR #395 (which added a 19th test) that
  left main's own CI red.

## Operations

- Release note: the CHANGELOG section above; the post-merge workflow attaches it to
  the GitHub Release.
- Rollout: merging the PR triggers `post-merge-release.yml`, which validates
  (typecheck, tests, pack dry-run) at the merged sha under a release lock before
  `npm publish --access public`.
- Rollback: before merge, closing the PR prevents publication entirely. After
  publish, `npm deprecate vibepro@0.2.0-beta.2` with a reason and revert the release
  commit set on main; `unpublish` is not used because of its 72-hour constraint and
  downstream breakage. beta.1 remains published, so consumers can pin it to
  downgrade.
- Observability: the workflow run log and the GitHub Release carry the release
  summary; `npm view vibepro version` confirms publication.
