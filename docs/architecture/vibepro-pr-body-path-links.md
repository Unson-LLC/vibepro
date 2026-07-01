---
story_id: story-vibepro-pr-body-path-links
title: GitHub PR body repository path links architecture
---

# Architecture

## Decision

Linkify repository-relative paths at the GitHub PR body projection layer.

`preparePullRequest` continues to collect the same Git state, Story source, file groups, Gate DAG, verification evidence, and lifecycle artifacts. `renderPrBody` formats those values for GitHub and converts known repository-relative path surfaces into Markdown links.

The link target is a GitHub relative link such as `[src/app/page.tsx](src/app/page.tsx)`. This keeps the formatter independent of GitHub owner/repo parsing and works for downstream repositories that use VibePro to create PRs.

## Boundaries

- The conversion is limited to known repository surfaces such as `docs/`, `src/`, `test/`, `tests/`, `.vibepro/`, `bin/`, `skills/`, `agent-instructions/`, README files, package manifests, and `design-ssot.json`.
- External URLs and absolute local paths remain unchanged.
- Path labels are escaped for Markdown; hrefs are encoded by segment so dynamic route folders are clickable.
- The concise PR body structure stays unchanged.

## Risk Controls

- The helper rejects multiline values and parent-directory traversal before emitting a link.
- The linkifier runs only in presentation code, so Gate computation and evidence binding remain unchanged.
- Tests cover dynamic-route paths and `.vibepro` evidence artifacts because those were visible pain points in generated PR bodies.
