---
story_id: story-vibepro-post-merge-docs-clean-worktree
title: Keep the post-merge docs deployment worktree clean
status: active
parent_design: vibepro-post-merge-docs-clean-worktree
reason: GitHub runners do not inherit the local repository's .git/info/exclude, so npm ci creates an untracked node_modules directory that violates the deploy script's clean-source invariant. Versioning node_modules/ in .gitignore preserves the post-pull install needed to align dependencies with the final main commit, keeps rollback trivial, and does not change npm or release-note contracts.
---

# Keep the post-merge docs deployment worktree clean

## Intent

After every merged PR, deploy the generated VitePress manual from the committed main state without violating the deploy script's clean-worktree safety check.

## Current reality

The first post-merge run for PR #349 published npm and GitHub Release and committed release history, then failed during VitePress deployment because `npm ci` created an untracked `node_modules/` directory before a script that requires a clean worktree. Local runs masked this because `.git/info/exclude` is not transferred to GitHub runners.

## Invariants and boundaries

- The deploy step installs dependencies after pulling the final main commit, so source and lockfile remain aligned.
- Package validation and npm publication remain bound to the trusted merged commit.
- Manual deployment continues to pull the latest main commit and refuses dirty source trees.
- No new secret, permission, or post-merge LLM execution is introduced.

## Acceptance criteria

- `node_modules/` is ignored by the versioned repository configuration and therefore cannot violate the clean-source check.
- A regression test proves the deploy step pulls main, installs its exact dependencies, and then runs `docs:deploy`.
- The post-merge workflow contract reaches the VitePress deployment step only after pulling final main and installing its lockfile-bound dependencies.

## Failure modes and rollback

- If final-main dependencies are unavailable, the deploy-stage `npm ci` fails before public manual mutation.
- If deployment still fails, the recovery summary remains authoritative and the workflow change can be reverted independently.

## Done evidence

- Focused workflow contract tests pass.
- Typecheck and VitePress build pass.
- After merge, confirm the GitHub Actions post-merge run completes with `Deploy VitePress manual` successful; treat missing Cloudflare credentials as an external rollout blocker rather than pre-merge code evidence.
