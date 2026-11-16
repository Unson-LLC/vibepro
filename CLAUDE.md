# VibePro Agent Instructions

> **🔧 UNDER MINIMAL-CORE REBUILD (2026-08-06)**: VibePro is being refactored down to a minimal core. See `docs/management/REBUILD.md` for scope (what stays / what is removed), rationale, and acceptance criteria. `AGENTS.md` must stay byte-for-byte identical (`cmp -s CLAUDE.md AGENTS.md`).

## 1. Non-Negotiables

1. **Self-dogfood is permanently retired.** Develop VibePro itself through plain git flows: branch → test → `gh pr create` → review → merge. Never use `vibepro pr create` / `vibepro execute merge` / gate flows for this repo's own changes.
2. **Do not resurrect removed mechanisms.** Gate DAG, delivery-efficiency budgets, head-bound evidence staleness, review lifecycle accounting, and auto-generated audit artifacts are removal targets per REBUILD.md. Do not add features to them; delete toward the minimal core.
3. **The old Story backlog is closed.** All ~240 entries in `.vibepro/config.json` `brainbase.stories[]` are closed en masse; do not pick them up without an explicit owner instruction.
4. **One intent = one focused commit.** Stage explicitly; never `git add -A` in mixed worktrees.
5. **Evidence over assertion**: when claiming something works, cite the command, artifact, log, or test used to verify it.
6. **Do not clean dirty worktrees by reflex.** Classify first (status, diffs, reflog).

## 2. Minimal core (build toward this)

Keep: Story registration + Story→Spec→code traceability, Spec validation (code_refs/test_refs existence and anchors), one lightweight review pass, PR-body evidence summary. No merge-blocking machinery, no budgets, no lifecycle ceremony.

## 3. Skill Routing

| Work type | Skill |
|---|---|
| Publishing VibePro to npm, release monitoring, dist-tag / GitHub Release reconciliation | `skills/vibepro-npm-publish` |

## 4. Development Commands

```bash
node --test test/<file>.test.js        # targeted tests first
node --test --test-concurrency=2       # full suite (I/O bound; higher concurrency is slower)
cmp -s CLAUDE.md AGENTS.md             # must be identical
```

Never start a second suite in the same worktree while one is running, and never mutate the tree mid-suite.

## 5. Archive pointers

`.vibepro/`, `docs/management/audit-artifacts/`, and `.vibepro-store/` are a read-only archive of the old machine (adjudication records, gap analyses, rescued diffs). Salvage design lessons from them; do not restore code from them.
