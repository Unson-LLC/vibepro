# VibePro Agent Instructions

> **🧊 FROZEN (2026-08-06)**: This repository is frozen by owner decision. See `docs/management/FREEZE.md` for the rationale, the disposition of in-flight work, and the reactivation criteria. `AGENTS.md` must stay byte-for-byte identical (`cmp -s CLAUDE.md AGENTS.md`).

## 1. Rules while frozen

1. **Do not start new Stories, gates, reviews, or `vibepro` CLI flows.** The Story → Gate → PR self-dogfood pipeline is retired. All ~240 entries in `.vibepro/config.json` `brainbase.stories[]` are closed en masse by the freeze declaration, regardless of their recorded `status`.
2. **Changes to this repo (if any) go through plain git**: branch → test → `gh pr create` → review → merge. Do not use `vibepro pr create` / `vibepro execute merge`.
3. **Do not resume in-flight branches without an explicit owner instruction.** Unmerged work was preserved as-is (branches pushed to origin; uncommitted diffs saved under `.vibepro-store/freeze-rescue-2026-08-06/`).
4. **Treat `.vibepro/`, `docs/management/`, and `.vibepro-store/` as a read-only archive.** The adjudication records and gap analyses there are design precedents for any successor tooling — salvage ideas, not code.

## 2. Why frozen (short version)

Measured over the 8 weeks before the freeze: 84% of merged PRs served VibePro itself, 100% of the 240 active Stories were self-referential, and single Stories consumed up to 192 review dispatches / ~165 hours of review lifecycle time. The governance value did not cover the token and wall-clock cost. Key evidence: `docs/management/delivery-efficiency-budget-gap-analysis.md`, `docs/management/issue-423-gap-analysis.md`.

## 3. Still true if you touch the code

- One intent = one focused commit; stage explicitly, never `git add -A` in mixed worktrees.
- Do not clean dirty worktrees by reflex; classify first (status, diffs, reflog).
- Full test suite: `node --test --test-concurrency=2` (higher concurrency is slower; the suite is I/O bound).
