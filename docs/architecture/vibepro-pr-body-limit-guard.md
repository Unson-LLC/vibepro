# Architecture: PR Body Limit Guard

## Decision

Keep `pr prepare` responsible for generating the canonical human/audit PR body, and add the GitHub-specific size guard inside `pr create` immediately before command construction.

## Rationale

The limit belongs to the transport boundary, not to the audit artifact renderer. `pr-body.md` should remain the complete generated brief that VibePro can inspect later. GitHub receives a bounded projection only when the generated body exceeds the platform limit.

## Flow

1. `preparePullRequest` generates `.vibepro/pr/<story-id>/pr-body.md`.
2. `createPullRequest` appends any gate override note to the generated body.
3. `createPullRequest` measures generated body characters and bytes.
4. If within 65,536 characters, `gh pr create/edit --body-file` uses `pr-body.md`.
5. If over 65,536 characters, VibePro writes `.vibepro/pr/<story-id>/pr-body.github.md` with artifact references and uses that file for GitHub.
6. `pr-create.json` records `pr_body_limit` metadata so handoff and audits can reconstruct the compression decision.

## Non-goals

- Do not shorten `renderPrBody` further in this story.
- Do not remove detailed artifacts from `.vibepro/pr/<story-id>/`.
- Do not infer GitHub validation behavior from a failed `gh` stderr string.
