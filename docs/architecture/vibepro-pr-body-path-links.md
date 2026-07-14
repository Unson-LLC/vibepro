---
story_id: story-vibepro-pr-body-path-links
title: GitHub PR body repository path links architecture
---

# Architecture

> `.vibepro/` の公開リンク境界は `docs/architecture/vibepro-pr-body-published-evidence-integrity.md` により更新された。以下のlink formatterはGitHub公開用repo path allowlistに一致する相対パスへ同期的に適用し、ローカルworkbench pathには適用しない。formatterはfilesystem/Gitの存在確認を行わず、構造化入力の存在・追跡状態はGit差分・Story分類側が保証する。

## Decision

Linkify repository-relative paths at the GitHub PR body projection layer.

`preparePullRequest` continues to collect the same Git state, Story source, file groups, Gate DAG, verification evidence, and lifecycle artifacts. `renderPrBody` formats those values for GitHub and converts known repository-relative path surfaces into Markdown links.

The link target is a GitHub relative link such as `[src/app/page.tsx](src/app/page.tsx)`. This keeps the formatter independent of GitHub owner/repo parsing and works for downstream repositories that use VibePro to create PRs.

## Boundaries

- The conversion is limited to GitHub-published repository surfaces such as `docs/`, `src/`, `test/`, `tests/`, `bin/`, `skills/`, `agent-instructions/`, README files, package manifests, and `design-ssot.json`.
- `.vibepro/` remains a local workbench surface and is rendered as inline code instead of a GitHub link.
- External URLs and absolute local paths remain unchanged.
- Path labels are escaped for Markdown; hrefs are encoded by segment so dynamic route folders are clickable.
- The concise PR body structure stays unchanged.

## Risk Controls

- The helper rejects multiline values and parent-directory traversal before emitting a link.
- The linkifier runs only in presentation code, so Gate computation and evidence binding remain unchanged.
- Tests cover dynamic-route links and `.vibepro` inline artifact references because both are visible decision surfaces in generated PR bodies.
