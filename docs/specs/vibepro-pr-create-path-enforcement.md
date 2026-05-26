---
story_id: story-vibepro-pr-create-path-enforcement
title: PR Create Path Enforcement Spec
---

# Spec

- `vibepro pr create` remains the PR creation command that enforces Gate DAG.
- self-dogfood checks text artifacts for raw `gh pr create` guidance.
- Lines containing clear prohibition language such as `do not`, `never`, or `使わない` are ignored.
- When `gh pr view --json number,url,headRefName,body` is available, self-dogfood inspects the current GitHub PR body.
- A visible GitHub PR without VibePro decision brief, Gate DAG, and Execution Gate sections is a blocking finding.
- A visible GitHub PR with literal escaped newline sequences in the body is a blocking finding.
- A visible GitHub PR without matching `.vibepro/pr/<story-id>/pr-create.json` evidence by PR URL or head branch is a blocking finding.
- Matching PR-create evidence must be a non-dry-run `mode: pr_create` artifact without failed status or error; when GitHub returns a PR URL, the artifact `pr_url` must match that URL.
- When GitHub returns the PR head SHA, matching PR-create evidence must have `toolchain.source_git.commit` equal to that head SHA so stale PR creation artifacts do not satisfy a later PR state.
- GitHub inspection is best-effort: unavailable `gh`, missing auth, or no current PR does not replace local artifact checks and does not become setup failure by itself.
