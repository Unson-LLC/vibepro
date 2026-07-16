# VibePro Agent Instructions

This file is the thin, always-loaded entrypoint for agents working **on the VibePro repository itself**. Keep it under 150 lines; put detail in `skills/*/SKILL.md`. `AGENTS.md` must stay byte-for-byte identical (`cmp -s CLAUDE.md AGENTS.md`).

## 1. Non-Negotiables

1. **Self-dogfood**: changes to this repo go through VibePro's own flow — Story → Architecture → Spec → Task → Code → Gate → PR. Do not bypass with raw `gh pr create` or raw GitHub merge; use `vibepro pr create` and `vibepro execute merge`.
2. **Run the CLI via the `vibepro` binary or `node bin/vibepro.js` from the repo root.** Never `node src/cli.js` from a symlinked path (e.g. `/private/tmp` worktrees): the entrypoint check fails silently and the command becomes a no-op with exit 0.
3. **Evidence freshness**: finalize the intended review surface before recording. Reviews are content-surface-bound by default, so unrelated commits may preserve them; only configured high-risk roles or a reasoned `--strict-head-binding` override are bound to every HEAD change.
4. **One intent = one focused commit.** Stage explicitly; never `git add -A` in mixed worktrees. Create branches only from inside the target worktree.
5. **Evidence over assertion**: when claiming something works, cite the command, artifact, log, or test used to verify it. `pr-prepare.json` gate_status is the readiness source of truth, not the PR body.
6. **Do not clean dirty worktrees by reflex.** Classify first (status, diffs, reflog); see the Git guardrails in `skills/vibepro-workflow/SKILL.md`.

## 2. Skill Routing

Load only the smallest relevant Skill:

| Work type | Skill |
|---|---|
| VibePro flow end-to-end (Story→Gate→PR, uiux, audit) | `skills/vibepro-workflow` |
| Closing gates: evidence recording, review lifecycle, spec write, gate troubleshooting | `skills/vibepro-gate-evidence` |
| Refactoring through VibePro | `skills/vibepro-story-refactor` |
| Interpreting PR artifacts / approve-split-waive-block decisions | `skills/vibepro-human-review` |
| Purpose-level diagnosis packs (`vibepro check ...`) | `skills/vibepro-diagnosis-packages` |
| Impact context via codebase-memory-mcp | `skills/vibepro-codebase-memory` |

## 3. Self-Dogfood Quickstart

1. Write the Story by hand at `docs/management/stories/active/story-vibepro-<slug>.md` (frontmatter: `story_id`, `title`, `status: active`; add a `reason:` key covering alternatives/compatibility/rollback/boundary when no separate ADR is needed).
2. Register it by appending an entry to `.vibepro/config.json` `brainbase.stories[]` (`story derive` will not pick up hand-written Stories).
3. `vibepro story diagnose . --id <story-id> --run-graphify` (pass `--run-graphify` on the diagnose call itself, every time).
4. Implement; register the Spec **after or with** implementation (`spec write` validates code_refs/test_refs existence and anchors).
5. Record evidence and reviews per `skills/vibepro-gate-evidence`, then `vibepro pr prepare . --story-id <id> --summary-json`, resolve blocks, `vibepro pr create`.
6. After PR: `vibepro verify import-ci`, rerun `pr prepare` / `pr create` for the current head, then `vibepro execute merge . --story-id <id> --strategy merge`.

## 4. Development Commands

```bash
node --test test/<file>.test.js        # targeted tests first
node --test --test-concurrency=2       # full suite (avoids OOM kills on a loaded host)
node bin/vibepro.js skills lint .      # skill frontmatter/structure lint
cmp -s CLAUDE.md AGENTS.md             # must be identical
```

Never start a second suite in the same worktree while one is running, and never mutate the tree mid-suite.

## 5. Context Economy

Read `pr prepare --summary-json` or `--view <readiness|blocking-gates|gate-evidence|traceability|design-ssot|senior-gap>` before any full JSON artifact. Full artifacts under `.vibepro/` are the persisted source of truth; drill into them only for flagged gate ids or paths.
