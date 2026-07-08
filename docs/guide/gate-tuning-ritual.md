# Monthly Gate-Tuning Ritual

VibePro measures itself (`vibepro check <pack>`, `vibepro usage report`) but nothing
consumed those measurements on a schedule before this ritual. Run this loop once a
month so measurement actually feeds back into Gate configuration instead of sitting
in `.vibepro/` unread.

## Step 1: Read the gate-outcome ROI ledger

```bash
vibepro usage report . --gate-roi --json
```

The `--gate-roi` view reads the **tracked central ledger** at
`docs/management/roi-ledger/ledger.json`, not the per-worktree gitignored
`.vibepro/gate-outcomes/ledger.json`. `execute merge` promotes each merged story's
local ledger entries into the central ledger by `entry_key` (dedup on re-run), so
the central ledger is the one data source that survives worktree teardown.

Look at `gate_roi.gates`. Each entry gives, per gate, how many previously unresolved
gates got resolved and the classification distribution: `source_fix`,
`evidence_added`, `rewording_only`, `waiver`, or `unclassified`. `gate_roi.unclassified_count`
is the explicit total of entries a human still needs to classify — it is never
hidden or coerced to zero. (`gate_outcomes.*` in the same report still reflects the
local worktree ledger; use `gate_roi.*` for the cross-worktree picture.)

If `gate_roi.entry_count` is `0`, the central ledger has no data yet (no story has
merged a resolved required gate since promotion started). Report that honestly — do
not invent a distribution. Re-check next month.

## Step 2: List demotion candidates

A gate with a high `rewording_only` rate is mostly getting satisfied by wording
changes, not by fixing anything real or adding evidence. That is a signal the gate
may be miscalibrated (too strict for its actual risk, or asking for prose instead of
evidence). Treat `gate_outcomes.demotion_candidates` as your starting list; add any
gate you notice manually with a similarly high rate once `total_count` is large
enough to trust.

## Step 3: Re-run stale diagnosis packs

Before touching thresholds, confirm old findings are still real. Any
`.vibepro/checks/<pack>/<run-id>/check.md` with `needs_setup`, `needs_review`, or
`fail` findings should be re-run once the underlying environment might have changed:

```bash
vibepro check <pack> . --run-id <pack>-<yyyymm>
```

Motivating example: `oss-readiness` reported `needs_setup` on 2026-05-26 because
gitleaks, scorecard, syft, grype, and reuse were all missing. By 2026-07-06, gitleaks,
syft, grype, and reuse were installed and passing; only scorecard remained blocked
(missing `GITHUB_TOKEN`, a setup gap unrelated to the original finding). Re-running
confirmed real progress and identified the one gap that is still open, instead of
carrying a two-month-old "5/5 missing" status forward unchecked.

## Step 4: Make at most one preset/threshold adjustment

Per month, make **at most one** Gate preset or threshold change, and make it its own
commit. Cite the ledger numbers that justify it in the commit message, for example:

```text
fix: demote gate:design_diagrams to advisory (rewording_only_rate=0.75, n=4)
```

If the ledger has no data yet, or no gate clears the demotion threshold with
sufficient `total_count`, make no adjustment this month. Do not force a change to
have something to report.

## Step 5: Record the outcome

Write a dated snapshot to `docs/reference/gate-tuning/<yyyy-mm>.md`: what was run, old
vs. new status for any re-run packs, the ledger state (including "no data yet" if
true), any demotion candidates and whether you acted on them, and the checkpoint for
next month.

## Cadence

Run this once a month, ideally right after the monthly release/retro pass. Skipping a
month is fine if nothing has flowed through the ledger; skipping the doc snapshot is
not — the snapshot is what proves the loop is still running.
