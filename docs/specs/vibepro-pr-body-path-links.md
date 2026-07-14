---
story_id: story-vibepro-pr-body-path-links
title: GitHub PR body repository path links spec
parent_design: vibepro-pr-body-path-links
---

# Spec

> `PBL-CONTRACT-002` と `PBL-SCENARIO-003` の `.vibepro/` リンク要件は、`docs/specs/vibepro-pr-body-published-evidence-integrity.md` により置換された。repo path allowlistによる公開pathのlink契約は継続する。

## Contracts

- `PBL-CONTRACT-001`: `renderPrBody` MUST render GitHub-facing repository paths as Markdown links when the path is a repository-relative path.
- `PBL-CONTRACT-002`: Story source, design/story docs, source files, test files, and other repository-relative paths matching the GitHub publication allowlist MUST be linkified. The formatter MUST NOT query filesystem or Git for existence; structured input provenance remains the responsibility of Git diff and Story classification. `.vibepro/` workbench entrypoints and evidence artifacts MUST remain inline code and MUST NOT be linkified.
- `PBL-CONTRACT-003`: Link labels MUST preserve the visible path, including a trailing slash when present.
- `PBL-CONTRACT-004`: Link labels MUST escape Markdown link delimiters in path text, especially `[` and `]`.
- `PBL-CONTRACT-005`: Link hrefs MUST encode path segments so dynamic route directories such as `[projectId]` remain valid links.
- `PBL-CONTRACT-006`: External URLs, absolute paths, parent-directory traversals, blank values, multiline values, and sentinel text such as `Story未検出` MUST NOT be linkified.
- `PBL-CONTRACT-007`: Linkification MUST NOT change Gate readiness, verification evidence binding, PR creation enforcement, or merge execution.

## Scenarios

- `PBL-SCENARIO-001`: Given a PR body with changed files under `src/` and `tests/`, when `pr prepare` runs, then those paths are rendered as Markdown links.
- `PBL-SCENARIO-002`: Given a changed path containing `[projectId]`, when `pr-body.md` is rendered, then the label escapes brackets and the href percent-encodes them.
- `PBL-SCENARIO-003`: Given verification evidence with a `.vibepro/verification/...json` artifact, when the concise checklist is rendered, then the artifact path is inline code and not a Markdown link.
- `PBL-SCENARIO-004`: Given a missing Story source, when the PR body is rendered, then `Story未検出` remains plain text.

## Verification

- `PBL-VERIFY-001`: CLI tests assert linked source, test, and Story source paths, plus inline non-link verification and PR prepare artifact paths in `pr-body.md`.
- `PBL-VERIFY-002`: CLI tests assert dynamic-route bracket escaping and href encoding.
- `PBL-VERIFY-003`: Existing PR prepare and verification checklist tests continue to pass.
