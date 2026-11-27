# Scope: gate `pr prepare` on recorded development judgment for large/risky changes, and keep `.vibepro/` artifacts out of PR diffs

## 1. Context found

**`pr prepare` pipeline**
- `preparePullRequest(repoRoot, options)` — `src/pr-manager.js:54`. Collects, in parallel (`:63`): story, `git = collectGitState(...)`, spec, drift, verification, review, and `developmentJudgment = readOperationalJudgmentProjection(root, storyId)` (`:71`). Writes `.vibepro/pr/<story>/pr-prepare.json` + `pr-body.md`, then returns. **It never sets a nonzero exit by itself** — the CLI handler always returns `{ exitCode: 0 }` (`src/cli.js:1635`). The only way `pr prepare` fails today is by **throwing** (e.g. `assertRuntimeIntegrity`, `assertRecordedRuntimeIdentities`, task-scope asserts); thrown errors hit the `dispatchCli` catch at `src/cli.js:2047`, which prints `error.message` to stderr and returns `exitCode: 1`.
- `collectGitState` — `src/pr-manager.js:602`. Already computes `changed_files` via `git diff --name-status <base>...<head>` → `[{status, path}]` (`:639`), plus `dirty_files` and `commit_count`. **No per-file line counts** are produced today.
- `resolvePrReadiness` — `src/pr-manager.js:387`. Produces `gate_status`/`blocking_reasons`, but these are informational (only review `blocking_findings` populate them, and the CLI ignores them for the exit code).

**Development-judgment recording / `not_recorded`**
- PR-body "Development Judgment" section — `src/pr-manager.js:908-939`. `status` defaults to `'not_recorded'` and `lifecycle` to `'not_started'`; everything is advisory/`blocking: false`.
- The projection is `readOperationalJudgmentProjection` (`src/judgment-operations.js:487`) → merges `readDevelopmentJudgmentProjection` (`src/judgment-workflow.js:474`; returns `status:'not_recorded'`, `available:false` when the legacy DAG `current.json` is absent — `emptyProjection`, `:629`) with `getJudgmentOperationalStatus` (`src/judgment-operations.js:418`). The decisive, cheap field is **`lifecycle`**: `resolveLifecycle` (`:743`) returns `'not_started'` when no `applicability/current.json` exists, `'not_applicable'` once applicability is recorded as `no`, `'applicable_not_prepared'` once recorded as `yes`, and `'unavailable'` if the projection throws (`:508`).
- Lightest existing recorder: **`vibepro judgment applicability record`** → `recordJudgmentApplicability` (`src/judgment-operations.js:51`; CLI `src/cli.js:1008`). It writes `.vibepro/reviews/<story>/development-judgment/applicability/current.json` and **requires no receipt key**. The richer `prepare→adopt→evaluate` chain (which carries structured `options`/`pruned_options` = rejected options) requires `JUDGMENT_RECEIPT_KEY` + `VIBEPRO_PR_NUMBER` env (receipt MACs — `prepareOperationalJudgmentInput`, `:83`).
- "20/20 PRs `not_recorded`" = `lifecycle` was `not_started` at `pr prepare` time; `verify record` was run but nothing in the judgment subsystem.

**`init` / gitignore**
- `ensureGitIgnore` — `src/workspace.js:185`, using `VIBEPRO_GITIGNORE_REVIEW_LINES = ['.vibepro/*', '!.vibepro/config.json', '!.vibepro/reviews/']` (`:145`) + `.vibepro-store/`, `.worktrees/vibepro/`. `renderGitignoreUpdate` (`:169`) and `gitignoreTracksVibeproReviews` (`:153`) enforce that `!.vibepro/reviews/` follows `.vibepro/*`. `doctor --fix` writes the same (tests at `test/vibepro-cli.test.js:6293-6362`). There is **no `.gitattributes` handling anywhere** (confirmed: no repo `.gitattributes`).
- Artifact routing (`src/artifact-routing.js:11` `DEFAULT_ARTIFACT_TEMPLATES`): `pr → .vibepro/pr/{story}/pr-prepare.json`, `review → .vibepro/reviews/{story}`, `evidence → .vibepro/evidence/{story}`, `accepted_spec → .vibepro/spec/{story}/spec.json`. So under the init gitignore, the **only committed `.vibepro/` surface is `config.json` + `reviews/**`**; `pr/`, `spec/`, `evidence/`, etc. are ignored. `pr prepare` reads `config.json` + `reviews/` (committed) and `verification-evidence.json` under `.vibepro/pr/` (local working tree); `pr create` reads `pr-body.md` from `.vibepro/pr/` (local working tree). **Nothing `pr create` needs is committed; the committed-for-CI set is `config.json` + `reviews/`** (this is exactly what `JUDGMENT_GITIGNORE_MIGRATION_NOTE`, `src/workspace.js:151`, requires so drafts/adoptions/evaluations reach CI).
- brainbase-organization#755's 11,848/14,452 `.vibepro/` lines come from a repo that tracks the **whole** `.vibepro/` tree (legacy/absent gitignore) and/or bulky generated sub-surfaces under `reviews/` (transcripts, `subagent-results`, legacy `gate/`), none of which `pr prepare`/CI read.

**Reusable, currently-dead classifier**
- `src/docs-only-change.js` is fully written and **imported nowhere** (dead since the evidence-depth planner was removed). `classifyEvidenceChangeSurface(path)` (`:112`) → `product_code | docs | evidence_artifacts | unknown`, already treating `.vibepro/**` and `docs/management/audit-artifacts/**` as `evidence_artifacts`, docs trees + doc extensions as `docs`, and `src/test/bin/lib/scripts/.github` + `package*.json` as `product_code`. `detectDocsOnlyChange({diffStats, changedFiles, diffStatsStatus})` (`:154`) returns `product_code_path_count` and `product_code_changed_lines`, and already expects a `git.diff_line_stats` numstat shape that `collectGitState` does not yet produce.

## 2. Scope in / Scope out

**In**
- Make `pr prepare` **throw** (→ exit 1) when a change is **large or risky** AND the Story's development-judgment `lifecycle === 'not_started'`.
- Add a cheap `diff_line_stats` (numstat) field to `collectGitState`; compute the large/risky verdict by **reusing** `src/docs-only-change.js` + a small hardcoded risky-path matcher.
- Record the verdict inputs (counted lines, trigger) into `pr-prepare.json` so the PR body can show *why* it did/did not require a judgment.
- Harden `init`/`doctor --fix` gitignore and add `.gitattributes` so committed `.vibepro/` records stay out of PR review surfaces and generated bulk stays untracked.
- Verify the exact existing commands that record this scope document as the Story's development judgment.

**Out**
- Any gating on judgment *content* (recommendation/mode/options) — recording the decision is enough; "not applicable" with a reason passes.
- Reintroducing `gate_status`/`blocking_reasons` as an exit driver, the Gate DAG, route classification, budgets, or lifecycle ceremony.
- New config keys, override flags, or a size threshold in `.vibepro/config.json`.
- Blocking `pr create`; retroactively untracking already-committed `.vibepro/` files in third-party repos (those repos migrate in their own change, per existing policy).
- Changing artifact routing (moving where reviews/judgment artifacts are written).

## 3. Acceptance criteria (outcome-only)

All new `pr prepare` tests go in `test/pr-manager.test.js` (its `setupRepo` already builds a real git repo with `main` + a feature branch and runs `vibepro init`). gitignore/gitattributes tests go in `test/vibepro-cli.test.js` (alongside the existing init/doctor gitignore tests). Classifier wiring gets a new `test/docs-only-change.test.js` (the module is currently untested).

1. **Large change, no judgment → fails.** A feature branch whose counted product-code change ≥ the large-change threshold, with `lifecycle === 'not_started'`, makes `preparePullRequest` reject; the error text names the remediation command `vibepro judgment applicability record`. *Test:* `test/pr-manager.test.js` → **`pr prepare fails for a large change when no development judgment is recorded`**.

2. **Recorded applicability unblocks the same large change.** After `recordJudgmentApplicability(root, { storyId, applicable: 'no', reason })` (or `'yes'`), the identical large change makes `preparePullRequest` resolve and write `pr-body.md`. *Test:* `test/pr-manager.test.js` → **`pr prepare succeeds for a large change once judgment applicability is recorded`**.

3. **Small change needs no judgment (unchanged behavior).** A small product-code diff with `lifecycle === 'not_started'` resolves successfully, and `pr-body.md` still shows Development Judgment `status: not_recorded` as informational. *Test:* `test/pr-manager.test.js` → **`pr prepare does not require development judgment for a small change`**.

4. **Risky path triggers the requirement even when small.** A small change that touches a risky path (e.g. a CI workflow or a `migrations/` file) with `lifecycle === 'not_started'` makes `preparePullRequest` reject. *Test:* `test/pr-manager.test.js` → **`pr prepare fails for a small change that touches a risky path without recorded judgment`**.

5. **`.vibepro/`, docs, and lockfile churn do not count as "large".** A branch whose only large churn is under `.vibepro/`, `docs/`, and `package-lock.json` (product-code lines below threshold, no risky path) resolves without a recorded judgment. *Test:* `test/pr-manager.test.js` → **`pr prepare excludes .vibepro, docs, and lockfile lines when sizing a change`**.

6. **Unmeasurable size fails open.** When numstat is unavailable (binary-only diff or lost base) and no risky path is touched, a change with `lifecycle === 'not_started'` resolves rather than blocking on an unmeasurable size. *Test:* `test/pr-manager.test.js` → **`pr prepare does not block when the change size cannot be measured and no risky path is touched`**.

7. **Classifier excludes/includes the right surfaces.** `detectDocsOnlyChange` reports zero `product_code_changed_lines` for a `.vibepro/`-only + docs-only diff and nonzero for a `src/` diff; lockfiles are not counted as large product code. *Test:* `test/docs-only-change.test.js` → **`sizing excludes .vibepro, docs, and lockfiles and counts src/test as product code`**.

8. **`init` keeps generated `.vibepro/` artifacts out of git while committing `config.json` + `reviews/`.** After `vibepro init`, `.gitignore` ignores `.vibepro/pr/`, `.vibepro/spec/`, and `.vibepro/evidence/`, and the generated review bulk (transcripts / `*.jsonl` / `subagent-results`), while `config.json` and the authoritative `reviews/**` JSON records remain committable. *Test:* `test/vibepro-cli.test.js` → extend **`init creates a repo-local VibePro workspace and updates gitignore only`** (line 528).

9. **`init` marks committed `.vibepro/` records as generated for review.** After `vibepro init`, `.gitattributes` contains a `.vibepro/** linguist-generated` entry; `doctor --fix` repairs it when missing. *Test:* `test/vibepro-cli.test.js` → **`init and doctor --fix mark committed .vibepro records as linguist-generated`**.

## 4. Large/risky rule (deterministic)

A change is **large OR risky**. `pr prepare` requires a recorded judgment (block) only when `largeOrRisky && developmentJudgment.lifecycle === 'not_started'`. Any other `lifecycle` value — including `'not_applicable'` and `'unavailable'` — passes (fail-open on a projection error; a recorded "not applicable" is a valid judgment).

**Data it uses.** Extend `collectGitState` with one cheap call `git diff --numstat <base>...<head>` → `diff_line_stats` (object keyed by path → `{additions, deletions}`) plus `diff_line_stats_status: 'available' | 'unavailable'`. This mirrors the existing `getChangedFiles` (`src/pr-manager.js:639`) and matches the shape `detectDocsOnlyChange` already expects. `changed_files` is reused as-is.

**Large (confirmed: net product-code lines, threshold confirmed at 300).** Feed `diff_line_stats` + `changed_files` into `detectDocsOnlyChange` and read `product_code_changed_lines` (additions + deletions over paths classified `product_code`). `large = product_code_changed_lines >= LARGE_CHANGE_PRODUCT_LINE_THRESHOLD` where `LARGE_CHANGE_PRODUCT_LINE_THRESHOLD = 300` is a single named constant in `pr-manager.js` (no config key). 
- *Why 300, confirmed not changed:* the repo's own focused PRs (e.g. #610) sit well under 300 added+deleted product lines, so the rule stays quiet on routine work (meets "not every PR"), while 300+ reliably marks a change whose intent is worth one recorded line. One-constant tunable; no override system.
- *Lines counted / excluded.* Counted: only `classifyEvidenceChangeSurface(path) === 'product_code'`. **Excluded by the classifier:** `.vibepro/**` and `docs/management/audit-artifacts/**` (→ `evidence_artifacts`), documentation trees (`docs/management/`, `docs/specs/`, `docs/architecture/`, `docs/adr/`) and doc extensions (`.md/.mdx/.markdown/.rst/.txt/.adoc`) (→ `docs`). **Additional explicit exclusion:** drop lockfiles by basename (`package-lock.json`, `npm-shrinkwrap.json`, `pnpm-lock.yaml`, `yarn.lock`) before counting, since `classifyEvidenceChangeSurface` otherwise files them under `product_code` and a dependency bump would falsely read as "large."
- *Measurement guard.* If `diff_line_stats_status !== 'available'` or `detectDocsOnlyChange` reports `product_code_changed_lines === null` (binary files / lost base), `large` is treated as **false** (cannot measure → do not block on size). The risky check still applies because it uses `changed_files`.

**Risky (confirmed: migration / auth / deploy; exact patterns).** `risky = any changed path P` with `classifyEvidenceChangeSurface(P) !== 'docs'` and `!== 'evidence_artifacts'` that matches any of (case-insensitive, `/`-normalized):
- *DB migrations:* path segment `/(migrations|migrate)/`, or extension `.sql`.
- *Auth / identity / secrets:* path segment `/(auth|authn|authz|session|credential|credentials|secret|secrets|token)/`.
- *Deploy / CI / infra:* `.github/workflows/**`; `Dockerfile` or `Dockerfile.*`; `docker-compose*.y{,a}ml`; `*.tf`; path segment `/(deploy|k8s|helm)/`; `.circleci/**`.

These live as one hardcoded `RISKY_PATH_PATTERNS` constant (not config). This risky set is the one genuinely additive piece and the most likely source of friction; it is intentionally tight, and recording "not applicable" clears any false positive in one command.

**What it prints on failure.** The thrown `Error.message` (stderr, exit 1) states the trigger (`large: N product-code lines changed (threshold 300)` and/or `risky path: <first matching path>`), that no development judgment is recorded (`lifecycle=not_started`), and the exact remediation:
```
vibepro judgment applicability record . --id <story-id> --applicable yes|no --reason <text>
```
plus a one-line note that recording `--applicable no` with a reason is a valid way to proceed.

**Small changes (unchanged).** `largeOrRisky === false`, or any recorded/`unavailable` lifecycle: no throw, exit 0, artifacts written exactly as today; the Development Judgment section remains advisory (`status: not_recorded` when nothing is recorded). The check is a standalone guard (e.g. `assertDevelopmentJudgmentForLargeChange({git, developmentJudgment})`) called after git+projection are collected and **before** artifacts are written — it does not touch `resolvePrReadiness`/`gate_status` (keeps clear of Gate DAG direction).

## 5. `.vibepro/` handling

**Committed vs ignored (keep the committed surface minimal and exactly what `pr prepare`/`pr create`/CI read).** `pr prepare` reads `config.json` + `reviews/**`; it reads `verification-evidence.json` and `pr create` reads `pr-body.md` from the **local working tree** under the already-ignored `.vibepro/pr/`. So the committed set must stay **`.vibepro/config.json` + the authoritative JSON records under `.vibepro/reviews/**`** (development-judgment `applicability/adoptions/evaluations/drafts/runs/inputs/current.json` and review-result JSON — required on a fresh CI checkout per `JUDGMENT_GITIGNORE_MIGRATION_NOTE`). Everything else under `.vibepro/` (`pr/`, `spec/`, `evidence/`, `stories/`, `test-plans/`, `graphify/`) stays ignored — already true after `init`.

**Smallest mechanism (two parts):**
1. **Gitignore — re-exclude generated review bulk.** Keep `.vibepro/*`, `!.vibepro/config.json`, `!.vibepro/reviews/`, and append re-exclusions for the non-authoritative generated bulk under `reviews/` that `pr prepare`/CI never read: `.vibepro/reviews/**/transcripts/`, `.vibepro/reviews/**/subagent-results/`, `.vibepro/reviews/**/*.jsonl`, and legacy `.vibepro/reviews/**/gate/`. (Git allows re-excluding files under a re-included directory, so the small JSON records stay tracked.) Codex must confirm these sub-paths against what `lightweight-review.js` + the judgment subsystem actually write today before finalizing the list, and keep `gitignoreTracksVibeproReviews` passing.
2. **`.gitattributes` — `linguist-generated`.** Add `.vibepro/** linguist-generated` (new `ensureGitAttributes` in `workspace.js`, wired into `initWorkspace` and a new `doctor --fix` repair). This collapses the committed records in GitHub's PR review UI and drops them from language stats. **Explicit limitation to record in the code comment and PR body:** `linguist-generated` only collapses the *display* — it does **not** reduce the diff's changed-line count. The actual line-count reduction (the #755 problem) comes only from the gitignore re-exclusions / not tracking files.

**Impact on existing repos.** `init`/`doctor --fix` update `.gitignore`/`.gitattributes` for the current repo but do **not** untrack already-committed files. A repo already tracking the whole `.vibepro/` tree (brainbase-organization) must untrack the generated bulk in its own change (`git rm -r --cached` the ignored paths) and adopt the updated gitignore — consistent with the existing migration-note policy ("repos update `.gitignore` in their own change"). Update `JUDGMENT_GITIGNORE_MIGRATION_NOTE` to mention the new `.gitattributes` line and the reviews re-exclusions.

## 6. Rejected options (one line each)

- **Drive the exit code from `gate_status`/`blocking_reasons`** — drifts back toward the removed Gate DAG; the block is a standalone throw instead.
- **Require the full `prepare→adopt→evaluate` chain for large PRs** — heavy MAC/receipt ceremony (`JUDGMENT_RECEIPT_KEY`+`VIBEPRO_PR_NUMBER`), exactly the lifecycle ceremony REBUILD removes.
- **New `--require-judgment` flag or `.vibepro/config.json` size threshold** — new override/config system; reuse a hardcoded constant + the existing `applicability record` command.
- **File-count threshold instead of line count** — one 2,000-line file reads as "1 file"; numstat lines (one extra cheap call) measure size faithfully.
- **`.gitattributes linguist-generated` alone for (b)** — collapses display only, does not reduce the 11,848-line diff count; gitignore/untracking is the real fix.
- **Move reviews/judgment artifacts to an already-ignored prefix** — an artifact-routing change with wide blast radius; re-excluding generated bulk is smaller.
- **Block `pr create` instead of `pr prepare`** — `create` reads a local `pr-body`; `prepare` is where the git diff + judgment projection are already in hand.
- **Write a brand-new path classifier** — `src/docs-only-change.js` already classifies these surfaces (and is dead code worth reviving).

## 7. Exact command(s) to record this scope as the Story's development judgment

**Canonical (clears the new block; no receipt key needed).** Record applicability with a reason that points at the committed scope document:
```bash
vibepro judgment applicability record . \
  --id <story-id> \
  --applicable yes \
  --reason "Scope in <committed-scope-doc-path>: pr prepare requires a recorded development judgment only for large/risky changes (>=300 product-code lines or migration/auth/deploy path); .vibepro artifacts kept out of PR diffs via gitignore+linguist. Rejected: gate_status exit driver, full evaluate chain, config flag, file-count, linguist-only." \
  --recorded-by agent:<id>
```
Verified against `src/cli.js:1008` and `recordJudgmentApplicability` (`src/judgment-operations.js:51`); `--applicable` accepts `yes|no` (`parseApplicable`, `:1372`). The document itself lives committed in the repo (e.g. `docs/management/decisions/<date>-pr-prepare-large-change-judgment.md`) and is cited by `--reason`. This is what the new block requires.

**Optional richer record (structured `options`/`pruned_options` = rejected options).** Only if the team wants the full senior-judgment ledger; requires env `JUDGMENT_RECEIPT_KEY` + `VIBEPRO_PR_NUMBER` and is **not** made mandatory by this change (would be the lifecycle ceremony REBUILD discourages):
```bash
VIBEPRO_PR_NUMBER=<pr#> JUDGMENT_RECEIPT_KEY=<key> vibepro judgment prepare . --id <story-id>
# edit the drafted .vibepro input to encode problem_frame, options, and pruned_options (rejected options)
vibepro judgment input adopt . --id <story-id> --input <drafted-input.json> \
  --reviewed-by human:<id>|agent:<id> --authority <source> --summary "<text>"
vibepro judgment evaluate . --id <story-id> --input <adopted-input.json>
```
Flag names verified against `src/cli.js:1021`/`adoptJudgmentInput` (`:144`)/`evaluateOperationalJudgmentWorkflow` (`:218`).

## 8. Implementation notes for Codex

**Files to touch**
- `src/pr-manager.js`
  - `collectGitState` (`:602`): add `diff_line_stats` from `git diff --numstat <base>...<head>` (build the `{path: {additions, deletions}}` object; treat `-`/`-` binary rows as unmeasured) and `diff_line_stats_status`. ~15 lines, mirrors `getChangedFiles`.
  - Add `LARGE_CHANGE_PRODUCT_LINE_THRESHOLD = 300`, `RISKY_PATH_PATTERNS`, lockfile basename set, and `assertDevelopmentJudgmentForLargeChange({ git, developmentJudgment })` (uses `detectDocsOnlyChange`/`classifyEvidenceChangeSurface`). Call it in `preparePullRequest` after the `Promise.all` (`:72`), **before** writing artifacts. Fail-open on `lifecycle !== 'not_started'` and on unmeasurable size with no risky path.
  - Optionally add a small `change_size` block to the `preparation` object + a line in the PR body's Development Judgment / Changed-files section so the verdict is visible.
  - `import { detectDocsOnlyChange, classifyEvidenceChangeSurface } from './docs-only-change.js'`.
- `src/workspace.js`: extend the gitignore review-bulk re-exclusions; add `ensureGitAttributes` writing `.vibepro/** linguist-generated`; call it from `initWorkspace`; update `JUDGMENT_GITIGNORE_MIGRATION_NOTE`.
- `src/doctor.js`: add repairs mirroring the gitignore change and the `.gitattributes` write (repair id alongside `ensure-gitignore-vibepro`).
- Tests: `test/pr-manager.test.js` (ACs 1–6), `test/docs-only-change.test.js` (AC7, new — module is currently untested), `test/vibepro-cli.test.js` (ACs 8–9; extend the init test at `:528` and the doctor tests at `:6293-6362`).

**Expected size:** ~120–180 LOC in `src/`, ~150 LOC tests. No new dependencies, no config keys.

**Watch-outs:** `detectDocsOnlyChange`/`classifyEvidenceChangeSurface` are dead code today — wiring them in revives them and needs direct tests; confirm the numstat object keys match `diffStats` (path → `{additions, deletions}`). Subtract lockfiles explicitly (classifier counts them as product code). Do not route the block through `gate_status`/`resolvePrReadiness`. Confirm the exact `reviews/` bulk sub-paths before finalizing re-exclusions.

**Tests to run:** `node --test test/pr-manager.test.js test/docs-only-change.test.js test/vibepro-cli.test.js`; then `cmp -s CLAUDE.md AGENTS.md` (unaffected) and the full suite `node --test --test-concurrency=2`.