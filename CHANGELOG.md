# Changelog

All notable changes to VibePro will be documented in this file.

## Unreleased

- **Breaking cleanup (`0.2.0-beta.3`)**: publish the rebuilt minimal core. VibePro
  now keeps repository-local Story, Spec, verification, review, decision, trace,
  and PR evidence without a Gate DAG, blocking readiness verdicts, managed merge,
  lifecycle accounting, budget enforcement, or automatic audit bundles. Removed
  commands are not compatibility aliases; automation must switch to the commands
  shown by `vibepro help`. The npm README and public manual now describe the same
  boundary. Rollback by pinning `vibepro@0.2.0-beta.2`.

- Remove the retired `check self-dogfood` and `checkpoint` invocations from CI.
  Type checks, the full test suite, TypeScript E2E suite, E2E structural lint,
  package dry-run, version smoke test, and English help smoke test remain required.

- Remove 11 TypeScript acceptance specs that exclusively asserted behavior from
  the retired Gate DAG, managed execution, adjudication, UI/UX gate, and audit
  surfaces. The retained TypeScript E2E executes the current artifact-routing CLI
  path, and the E2E runner still fails closed when no TypeScript specs exist.

- Pin the `test` npm script to `node --test --test-concurrency=2`. The suite is
  I/O-bound and scales negatively with parallelism; `--test-concurrency=2` is
  the measured optimum (unlimited parallelism took 28 minutes at load average
  ~100), so `npm test` — the full-suite command the unit evidence command-form
  gate recognizes — now runs at the optimal concurrency with no gate-logic
  change. Operator action: none; `npm test` keeps working everywhere it did.
  Rollback: revert the one-line script change.

- Widen `verify run`'s default timeout (`DEFAULT_TIMEOUT_MS`) from 1800000 ms
  to 7200000 ms. Measured full-suite runs (28 minutes at load ~100 unlimited;
  56 minutes at load ~35 with `--test-concurrency=2`) left almost no margin,
  and a timeout kill records a fail that is not a test failure. Explicit
  `--timeout-ms` behavior is unchanged. Observability: the effective value is
  recorded as `run.timeout_ms` in every verification run artifact. Rollback:
  revert the one-line constant change.

- Remove 17 files under `test/e2e` that imported no product code, started no
  process, and touched no filesystem. Each asserted a locally-defined string
  against a regex built from that same string, so no product regression could
  fail them, yet `node --test` counted them as passing e2e tests. No product
  coverage is lost, because they covered no product branch to begin with.
  Where an equivalent behavioural test already exists it is named in the commit
  (`test/cli-status-honesty.test.js`,
  `test/engineering-judgment-activation-precision.test.js`,
  `test/managed-worktree-policy-resync.test.js`,
  `test/traceability-usage-report.test.js`, `test/vibepro-cli.test.js`, and the
  real `-main.test.js` siblings); for the remainder there is nothing to
  replace. Two files did cover branches nothing else executed, and those were
  rewritten into behavioural tests instead of deleted.

- Add `npm run lint:e2e-product-execution`
  (`scripts/lint-e2e-product-execution.mjs`), which fails when a `test/e2e`
  file executes no product behaviour. A file clears the lint by doing any one
  of: `product_import` (resolving a module inside this repository — a relative
  path, a `#subpath` import, or an `@/` alias, so reaching product code through
  a shared test helper counts), `process_start` (starting a child process or
  running the CLI), `filesystem_access` (reading or writing the filesystem), or
  `browser_automation` (driving Playwright, Cypress, or Puppeteer). It scans
  `test/e2e` recursively, so nested directories are not a blind spot. It runs
  in CI after `npm run test:e2e:ts`.

  **What it is not**: a structural tripwire, not a proof of behavioural
  coverage. It reads module specifiers and call names, so a single unused
  import clears it, and a file that imports product code and then still
  asserts only its own literals will pass. It catches the accidental
  reintroduction of the shape removed here; it does not certify that a test
  verifies anything.

- `npm run typecheck` now also parses `scripts/*.mjs`, not only `bin/vibepro.js`
  and `src/*.js`. All eight existing scripts already parse, so no result
  changes, but a syntax error in a `scripts/*.mjs` file is now caught in CI.

- Six `test/e2e/*-acceptance.spec.ts` files asserted their nested runner's
  output as TAP (`/# pass N/`). Node emits the spec reporter (`ℹ`) from v23, so
  those specs failed locally on newer Node for a reason unrelated to product
  behaviour. They now accept either format. One exact `pass 14` pin became a
  floor, so adding a test to that contract suite is no longer an unrelated red.

- **Cross-story effect** of the removals: seven Story slugs — `cli-status-honesty`,
  `evidence-user-fingerprint`, `keyword-gate-structured-migration`,
  `pr-ship-command`, `execute-merge-command`,
  `engineering-judgment-activation-precision`, and `merge-delta-review-reuse` —
  no longer have any `test/e2e/<slug>-*` file, so a replayed audit of those
  Stories will now report uncovered acceptance criteria. (`isStoryE2eCandidate()`
  also matches on content mentioning a Story id, so those slugs still resolve one
  candidate file — this acceptance spec, which names them — but it carries no
  `ac:N` marker for them, so the reported outcome is the same.) That outcome is
  by design: the deleted files never executed product code, so the coverage they
  reported was not real. None of the seven is registered in
  `.vibepro/config.json`, so no active Story's gate changes.

  **Operator action**: none for existing consumers; this is a repository-internal
  test-quality gate and changes no published CLI surface, artifact schema, or
  runtime behaviour. Contributors adding a `test/e2e` file must assert on real
  behaviour rather than on a literal the test wrote itself.

  **Observability**: the lint reports through its exit code and prints either
  `e2e-product-execution: <n> e2e test file(s) all execute product behaviour`
  or a `::error::` annotation naming every offending file. The reported count
  is the directory it actually inspected, so a moved or emptied directory is
  visible rather than silently clean. It is fail-closed on every path where it
  cannot see its subject: an unscannable directory, an unreadable file, and an
  empty file set are all exit 1.

  **Rollback**: revert the commit. The lint is a standalone script plus one CI
  step and one npm script; nothing reads its output as data, there is no
  persisted state, no schema, and no migration. To disable it without a revert,
  remove the `npm run lint:e2e-product-execution` step from
  `.github/workflows/ci.yml`; the deletions in this change stand on their own
  and do not depend on the lint.

- **Breaking (behavior)**: a Story-local delivery-efficiency budget override
  (`budgets.delivery_efficiency_by_story.<story-id>` in `.vibepro/config.json`) is
  now inert unless an accepted decision record grants it. Writing
  `amendment_reason` is no longer sufficient: the grant must name a human grantor,
  identify the recording agent, and carry the `override_digest` VibePro computes
  from the override itself, so approving a budget approves specific numbers and a
  grant cannot be transplanted to another Story. An ungranted override falls back
  to the base budget — regardless of direction — and reports why, as
  `budget_override` on `review authorize` / dispatch stops and as
  `budget_override_unauthorized` efficiency debt in `pr prepare`. Note that the
  fallback is to the base policy as written, not to the stricter of the two: if
  you used a Story override to *tighten* a limit below the base budget, the
  ungranted override reverts to the looser base until you record the grant.

  **Upgrade action**: if your repository configures `delivery_efficiency_by_story`,
  the override stops applying on upgrade. Either record an approval with
  `vibepro decision record --id <story-id> --type waiver --status accepted
  --summary <text> --reason <what the human approved> --source
  budget:delivery_efficiency:<story-id> --budget-grantor <human>
  --budget-grantor-kind human --agent-system <system> --agent-id <id>`
  (`--reason` and all four budget flags are required, and the recording agent
  identity must differ from the grantor), or
  accept the base budget. Overrides that predate this gate *inside this repository*
  are grandfathered by content digest and keep working exactly as merged; editing
  one changes its digest and drops it to `unauthorized`. Grandfathering does not
  extend to consumer repositories.

- Add `--budget-grantor`, `--budget-grantor-kind`, `--agent-system` and `--agent-id`
  to `vibepro decision record` for recording a budget-override approval. All four are
  required when the decision source is a `budget:delivery_efficiency:` grant, and a
  grantor equal to the recording agent identity is rejected at write time: the
  session that consumes a raised budget cannot also grant it.

## 0.2.0-beta.2 - 2026-07-29

- Add `vibepro verify run`: VibePro executes the verification command itself (argv,
  no shell) and records the execution exhaust — exit code, parsed test counts,
  duration, head sha and worktree fingerprints before/after, output hashes — without
  passing through agent input. Records carry an `evidence_source` trust marker
  (`runner_direct` / `autopilot_run` / `ci_import` / `self_reported`) set by the
  recording path via an internal receipt; no CLI flag sets it, and records without
  the field read as `self_reported`.

- **Breaking (input contract)**: `verify record --observed` now rejects 26
  provenance/integrity keys only a runner's own execution can produce
  (`run_artifact`, `stdout_sha256`, `worktree_sha256_before`, `timed_out`, …; the
  boundary is enumerated in the Spec). The same keys arriving inside a caller
  `--artifact` are stripped and named on the record as a warning. The 12 outcome
  keys (`tests`, `pass`, `fail`, `duration_ms`, `head_sha`, …) stay accepted.
  Audit existing `--observed` usage against the Spec list, or migrate locally
  runnable checks to `verify run`.

- **Behavior change (read-time classification)**: the gate evidence classification
  corpus excludes those provenance keys and their values, so classification derives
  only from declared targets/scenarios and retained outcome keys. Existing
  `runner_direct` records that earned `runtime_path_evidence` solely from their own
  artifact path lose it on the next `pr prepare`, and spine gates requiring that
  kind can flip to unmet; re-record with truthful targets/scenarios via
  `verify run`. Recorded artifacts are never rewritten.

- `npm run typecheck` now checks every file instead of silently stopping at the
  first glob entry (`node --check` reads only its first positional). Previously
  passing broken files may now be detected — an intended behavior change.

- The adjudication request states how each record was produced: `evidence_source`,
  the computed-observation producer and keys, discarded-input diffs, and the
  record's own warnings are rendered, and every agent-controlled string has its
  line breaks and control characters escaped so a value cannot forge an
  authoritative line.

- Add risk-adaptive validation sequencing for workflow-heavy and boundary-sensitive
  changes. High-risk PR preparation now requires targeted validation, advisory
  preflight disposition, an exact freeze binding, reusable expensive verification,
  and a passing closed independent Agent Review on the frozen HEAD. Roll back the
  feature merge or release to disable it; deleting `.vibepro` sequence state alone
  does not disable the gate.

- Bind ordinary reviews to their inspected content surface while keeping
  `gate_evidence` and `release_risk` reviews strictly bound to the full commit.
  Passing `review record` calls must now include `--inspection-summary`, at least
  one existing non-`.vibepro` `--inspection-input`, and `--judgment-delta`;
  existing automation must add these arguments when upgrading.

- Support task-scoped PR acceptance gates: task-scoped PRs keep Story context while
  judging only the selected task's acceptance scope.

## 0.2.0-beta.1 - 2026-07-18

- Add a deterministic post-merge release pipeline that projects PR release notes
  into the bilingual VitePress manual and changelog, then deploys the manual for
  every merged `main` pull request.
- Publish GitHub Releases and npm packages only when `package.json` advances,
  with retry-safe registry reconciliation and explicit SemVer dist-tags.
- Standardize PR release-note sections so the authoring LLM writes the release
  explanation once before merge and post-merge automation performs no LLM calls.

- `vibepro execute merge` now returns exit code 2 when external delivery was observed but local reconciliation still requires operator action, and exit code 1 when canonical-audit persistence itself fails. The JSON `status`, `delivery`, `reconciliation`, `base`, and `pr.selector` fields remain available for existing consumers; automation should inspect these fields before retrying with `vibepro execute reconcile`.
  The release operator owns unresolved reconciliation: monitor `vibepro execute status` delivery/reconciliation fields, then run `vibepro execute reconcile . --story-id <id> --base <ref> --pr <number-or-url> --json`. Rollback may revert the exit policy or consumers, but must retain observed delivery facts and quarantined corrupt-state bytes.

## 0.2.0-beta.0 - 2026-07-16

- Document the complete guarded delivery loop: managed execution, independent
  review and adjudication, release guard, PR/CI refresh, merge, canonical audit,
  and usage/ROI reporting.
- Generate the bilingual CLI reference from the current shipped help contract
  and fail documentation builds when it drifts.
- Separate the published npm beta from current `main` and expose the documentation
  build's source commit.
- Promote and verify both npm `beta` and `latest` dist-tags during publication.
- Restrict the public manual build to curated guide/reference content, require
  production deploys to match freshly fetched `origin/main`, and add
  robots, sitemap, llms.txt, social metadata, and structured data.
- Expand UI/UX, Journey, Design System, review lifecycle, decision, guard,
  execution, audit, and ROI documentation for current VibePro behavior.

## 0.1.0-alpha.0

- Prepare the project for Apache-2.0 OSS publication.
- Add phase checkpoints for Story, implementation start, test plan, implementation completion, verification, and PR readiness.
- Add public-discovery live, built-output, and source target discovery with bounded scans, explicit omissions, and fail-closed coverage reporting.

<!-- vibepro-release-pr:349:start -->
## [#349](https://github.com/Unson-LLC/vibepro/pull/349) story-vibepro-pr-driven-continuous-release - PRマージからマニュアル・VitePress・npmまで完全自動でリリースする

- Author: @sintariran
- Merged: 2026-07-19T00:32:53Z
- Commit: `5bbfb6e42933d626199eb2c6fa4a402f1ee05bcc`

### Change Summary

main向けPRのマージを起点に、VibePro PR本文の安定したRelease Notesセクションを日英のVitePress履歴とCHANGELOGへ決定的に投影し、毎回マニュアルをデプロイする。package versionが増加した場合だけ、同じmerge commitとリリースノートへGitHub Releaseとnpm公開を結び付け、CAS leaseと再照合で不可逆処理を直列化する。

### Compatibility

既存CLIとversion不変PRの挙動は維持する。npm公開は増加したSemVerだけが対象で、`0.2.0-beta.1` はprereleaseとして `beta` と単調な `latest` 判定を明示的に適用する。

### User Action

なし。PR作成者はマージ前にChange Summary、Compatibility、User Actionの3節が利用者向けの内容になっていることを確認する。

<!-- vibepro-release-pr:349:end -->

<!-- vibepro-release-pr:350:start -->
## [#350](https://github.com/Unson-LLC/vibepro/pull/350) story-vibepro-post-merge-docs-clean-worktree - Keep the post-merge docs deployment worktree clean

- Author: @sintariran
- Merged: 2026-07-19T01:18:06Z
- Commit: `1846cff28afd89d23368e29e05f12019dd1a77d6`

### Change Summary

Story文書を更新: [docs/management/stories/active/story-vibepro-post-merge-docs-clean-worktree.md](https://github.com/Unson-LLC/vibepro/blob/main/docs/management/stories/active/story-vibepro-post-merge-docs-clean-worktree.md)

### Compatibility

なし

### User Action

なし

<!-- vibepro-release-pr:350:end -->

<!-- vibepro-release-pr:351:start -->
## [#351](https://github.com/Unson-LLC/vibepro/pull/351) story-vibepro-linux-rollup-ci-lock - Make the VitePress lockfile installable on Linux CI

- Author: @sintariran
- Merged: 2026-07-19T02:12:55Z
- Commit: `fc2f2efebe8420ea4ff300f27ced8edd448c5fa3`

### Change Summary

Story文書を更新: [docs/management/stories/active/story-vibepro-linux-rollup-ci-lock.md](https://github.com/Unson-LLC/vibepro/blob/main/docs/management/stories/active/story-vibepro-linux-rollup-ci-lock.md)

### Compatibility

なし

### User Action

なし

<!-- vibepro-release-pr:351:end -->

<!-- vibepro-release-pr:352:start -->
## [#352](https://github.com/Unson-LLC/vibepro/pull/352) story-vibepro-next-best-action-controller - トークン最小ではなくTrusted PR-readyまでの総コストで次のActionを選びたい

- Author: @sintariran
- Merged: 2026-07-19T02:30:39Z
- Commit: `b89bf7f3fc89f74395625db1278774ad0f2e3993`

### Change Summary

Story文書を更新: [docs/management/stories/active/story-vibepro-next-best-action-controller.md](https://github.com/Unson-LLC/vibepro/blob/main/docs/management/stories/active/story-vibepro-next-best-action-controller.md)

### Compatibility

なし

### User Action

なし

<!-- vibepro-release-pr:352:end -->

<!-- vibepro-release-pr:353:start -->
## [#353](https://github.com/Unson-LLC/vibepro/pull/353) story-vibepro-autonomy-roadmap-rebaseline - 直近追加Storyと衝突しない実装順へ再編したい

- Author: @sintariran
- Merged: 2026-07-19T03:40:14Z
- Commit: `5cdd7650f07de5a8fda7100f6d6d2fbd9011d68f`

### Change Summary

Story文書を更新: [docs/management/stories/active/story-vibepro-autonomy-roadmap-rebaseline.md](https://github.com/Unson-LLC/vibepro/blob/main/docs/management/stories/active/story-vibepro-autonomy-roadmap-rebaseline.md)

### Compatibility

なし

### User Action

なし

<!-- vibepro-release-pr:353:end -->

<!-- vibepro-release-pr:355:start -->
## [#355](https://github.com/Unson-LLC/vibepro/pull/355) story-vibepro-release-note-link-normalization - Release noteのrepo-root docsリンクをcanonical source URLへ正規化する

- Author: @sintariran
- Merged: 2026-07-19T06:17:39Z
- Commit: `d82e0ab9518bd81580063b645411fbfd465c1a90`

### Change Summary

Story文書を更新: [docs/management/stories/active/story-vibepro-release-note-link-normalization.md](https://github.com/Unson-LLC/vibepro/blob/main/docs/management/stories/active/story-vibepro-release-note-link-normalization.md)

### Compatibility

なし

### User Action

なし

<!-- vibepro-release-pr:355:end -->

<!-- vibepro-release-pr:354:start -->
## [#354](https://github.com/Unson-LLC/vibepro/pull/354) story-vibepro-artifact-output-routing - 成果物の正本出力先をリポジトリ設定で一意に制御する

- Author: @sintariran
- Merged: 2026-07-19T08:49:44Z
- Commit: `ffeacc5097e5b90bfee256fb69cf4383a3fb388c`

### Change Summary

- `.vibepro/config.json` に成果物種別ごとの canonical path template と、中央 writer を持つ種別の任意の projection を宣言できるようにする。 - 共通 resolver が `{story_id}` と `{feature_slug}` を展開し、生成側と検出側の双方へ同じ結果を返す。 - 未設定時は既存の出力先を維持する。 - 絶対パス、repository traversal、未解決変数、canonical 同士の衝突は書き込み前に fail closed する。 - migration plan は dry-run で移動元、移動先、衝突、未解決項目を表示し、暗黙には移動しない。

### Compatibility

なし

### User Action

なし

<!-- vibepro-release-pr:354:end -->

<!-- vibepro-release-pr:357:start -->
## [#357](https://github.com/Unson-LLC/vibepro/pull/357) story-vibepro-human-decision-checkpoint - 自律実行中に本当に必要な質問だけを受け、回答後に同じRunを再開したい

- Author: @sintariran
- Merged: 2026-07-19T11:09:40Z
- Commit: `006d5fb5abe9889f91ad282001bd0095133bc957`

### Change Summary

Story文書を更新: [docs/management/stories/active/story-vibepro-human-decision-checkpoint.md](https://github.com/Unson-LLC/vibepro/blob/main/docs/management/stories/active/story-vibepro-human-decision-checkpoint.md)

### Compatibility

なし

### User Action

なし

<!-- vibepro-release-pr:357:end -->

<!-- vibepro-release-pr:360:start -->
## [#360](https://github.com/Unson-LLC/vibepro/pull/360) story-vibepro-agent-runtime-adapters - handoffとreview dispatch文書を作るだけでなく、利用可能なagent runtimeへ実行委譲したい

- Author: @sintariran
- Merged: 2026-07-19T23:48:37Z
- Commit: `9a89bb07198f2882628e087ab5f73cd92396612a`

### Change Summary

Story文書を更新: [docs/management/stories/active/story-vibepro-agent-runtime-adapters.md](https://github.com/Unson-LLC/vibepro/blob/main/docs/management/stories/active/story-vibepro-agent-runtime-adapters.md)

### Compatibility

なし

### User Action

なし

<!-- vibepro-release-pr:360:end -->

<!-- vibepro-release-pr:362:start -->
## [#362](https://github.com/Unson-LLC/vibepro/pull/362) story-vibepro-risk-adaptive-validation-sequencing - 高コストFull Suite後に境界欠陥が見つかり、修正で証跡を全て取り直す順序を改善したい

- Author: @sintariran
- Merged: 2026-07-20T10:32:03Z
- Commit: `e3dd0e2b5c8e1e3ecd748a056c17bb9833f2d923`

### Change Summary

Story文書を更新: [docs/management/stories/active/story-vibepro-risk-adaptive-validation-sequencing.md](https://github.com/Unson-LLC/vibepro/blob/main/docs/management/stories/active/story-vibepro-risk-adaptive-validation-sequencing.md)

### Compatibility

なし

### User Action

なし

<!-- vibepro-release-pr:362:end -->

<!-- vibepro-release-pr:363:start -->
## [#363](https://github.com/Unson-LLC/vibepro/pull/363) story-vibepro-review-finding-repair-loop - needs_changesを停止報告で終わらせず、修正・再検証・再Reviewへ閉ループ化したい

- Author: @sintariran
- Merged: 2026-07-20T14:48:04Z
- Commit: `16d609b00eb186b568081c1972fdd4a8df85f73c`

### Change Summary

アーキテクチャ判断を追加: [docs/architecture/story-vibepro-review-finding-repair-loop.md](https://github.com/Unson-LLC/vibepro/blob/main/docs/architecture/story-vibepro-review-finding-repair-loop.md)

### Compatibility

なし

### User Action

なし

<!-- vibepro-release-pr:363:end -->

<!-- vibepro-release-pr:364:start -->
## [#364](https://github.com/Unson-LLC/vibepro/pull/364) story-vibepro-story-run-portfolio-controller - 複数Storyを一つの長大sessionへ混載せず、Storyごとに閉じて順次進めたい

- Author: @sintariran
- Merged: 2026-07-21T02:50:32Z
- Commit: `53177da9761e083bf5fa99c7adcbea8286f4cfa8`

### Change Summary

アーキテクチャ判断を追加: [docs/architecture/story-vibepro-story-run-portfolio-controller.md](https://github.com/Unson-LLC/vibepro/blob/main/docs/architecture/story-vibepro-story-run-portfolio-controller.md)

### Compatibility

なし

### User Action

なし

<!-- vibepro-release-pr:364:end -->

<!-- vibepro-release-pr:366:start -->
## [#366](https://github.com/Unson-LLC/vibepro/pull/366) story-vibepro-guarded-autonomy-hardening - 自律ループを無限実行や自己Reviewにせず、費用・時間・停止理由まで運用可能にしたい

- Author: @sintariran
- Merged: 2026-07-21T07:08:20Z
- Commit: `3e141c2a4558b3a9a5fe1610ce6c45d53be63a96`

### Change Summary

Story文書を更新: [docs/management/stories/active/story-vibepro-guarded-autonomy-hardening.md](https://github.com/Unson-LLC/vibepro/blob/main/docs/management/stories/active/story-vibepro-guarded-autonomy-hardening.md)

### Compatibility

なし

### User Action

なし

<!-- vibepro-release-pr:366:end -->

<!-- vibepro-release-pr:367:start -->
## [#367](https://github.com/Unson-LLC/vibepro/pull/367) feat(artifact-routing): add profile-based projections

- Author: @sintariran
- Merged: 2026-07-21T08:13:52Z
- Commit: `6dc82c248cb3c49d09132ad60ec36700197a1283`

### Change Summary

- `.vibepro/config.json`に複数のnamed routing profileを定義し、既存`artifact_routing.artifacts`は後方互換なdefaultとして扱う。 - `.vibepro/config.json`の`brainbase.stories[]`を`artifact_profile`と`feature_slug`のauthorityとする。named profileを選ぶStoryではStory frontmatterを必須mirrorとし、不在または不一致なら共通resolverは書込前にfail closedする。profile metadataを持たないlegacy/unconfigured Storyではmirrorを任意とする。 - projectionは`renderer`と`ownership`を持ち、generated viewにsource path、SHA-256、renderer/schema version、direct-edit prohibitionを埋め込む。 - `human_owned`はVibeProが上書きせず、`curated`は自動上書き対象外として明示的な運用境界を返す。 - migration dry-runはprofile変更、move/collision、stale projection、human-owned overwrite...

### Compatibility

なし

### User Action

なし

<!-- vibepro-release-pr:367:end -->

<!-- vibepro-release-pr:368:start -->
## [#368](https://github.com/Unson-LLC/vibepro/pull/368) story-vibepro-canonical-audit-gate-dag-replay - Summary depthのCanonical Audit Replayを欠損なく引き継ぐ

- Author: @sintariran
- Merged: 2026-07-21T08:41:12Z
- Commit: `181831acbd1a92e33e1ed5486a7733b1e6453c45`

### Change Summary

Story文書を更新: [docs/management/stories/active/story-vibepro-canonical-audit-gate-dag-replay.md](https://github.com/Unson-LLC/vibepro/blob/main/docs/management/stories/active/story-vibepro-canonical-audit-gate-dag-replay.md)

### Compatibility

なし

### User Action

なし

<!-- vibepro-release-pr:368:end -->

<!-- vibepro-release-pr:369:start -->
## [#369](https://github.com/Unson-LLC/vibepro/pull/369) feat: add explicit Run attribution lineage

- Author: @sintariran
- Merged: 2026-07-21T10:14:17Z
- Commit: `b9c2c03286af3adf536811f8cc41796edee0f5dc`

### Change Summary

Story文書を更新: [docs/management/stories/active/story-vibepro-explicit-run-attribution-lineage.md](https://github.com/Unson-LLC/vibepro/blob/main/docs/management/stories/active/story-vibepro-explicit-run-attribution-lineage.md)

### Compatibility

なし

### User Action

なし

<!-- vibepro-release-pr:369:end -->

<!-- vibepro-release-pr:371:start -->
## [#371](https://github.com/Unson-LLC/vibepro/pull/371) story-vibepro-explicit-run-attribution-lineage - Codex DesktopのThreadと内部sessionの対応は公開契約ではなく、利用者によるThread分離を正確な価値監査の前提にできない

- Author: @sintariran
- Merged: 2026-07-21T12:40:21Z
- Commit: `ea852e3da37323d7c9a407219f4bedd99d8b744e`

### Change Summary

アーキテクチャ判断を追加: [docs/architecture/story-vibepro-explicit-run-attribution-lineage.md](https://github.com/Unson-LLC/vibepro/blob/main/docs/architecture/story-vibepro-explicit-run-attribution-lineage.md)

### Compatibility

なし

### User Action

なし

<!-- vibepro-release-pr:371:end -->

<!-- vibepro-release-pr:374:start -->
## [#374](https://github.com/Unson-LLC/vibepro/pull/374) story-vibepro-managed-worktree-policy-resync - Managed worktreeのポリシーconfigを凍結させず親repoから再同期する

- Author: @sintariran
- Merged: 2026-07-21T16:27:55Z
- Commit: `a39b1973eb7e93c50a7d40cdf41a7f36a02f9b0a`

### Change Summary

Story文書を更新: [docs/management/stories/active/story-vibepro-managed-worktree-policy-resync.md](https://github.com/Unson-LLC/vibepro/blob/main/docs/management/stories/active/story-vibepro-managed-worktree-policy-resync.md)

### Compatibility

なし

### User Action

なし

<!-- vibepro-release-pr:374:end -->

<!-- vibepro-release-pr:345:start -->
## [#345](https://github.com/Unson-LLC/vibepro/pull/345) story-vibepro-session-attribution-boundary-guard - 2026-07-09 の価値監査で親 session 019f3f8c が複数の関連 story を混載し、strict と worktree-bound の attribution 乖離（例: docs-feature-map strict 1h24m vs bound 11h24m 相当）が前回監査から横ばいのまま残った

- Author: @sintariran
- Merged: 2026-07-21T18:13:55Z
- Commit: `60524f51fe7c76ba3f06e82161bb043afcc22b04`

### Change Summary

Story文書を更新: [docs/management/stories/active/story-vibepro-session-attribution-boundary-guard.md](https://github.com/Unson-LLC/vibepro/blob/main/docs/management/stories/active/story-vibepro-session-attribution-boundary-guard.md)

### Compatibility

なし

### User Action

なし

<!-- vibepro-release-pr:345:end -->

<!-- vibepro-release-pr:373:start -->
## [#373](https://github.com/Unson-LLC/vibepro/pull/373) story-vibepro-routing-profiles-rendered-projections - Story別routing profileとlineage付きprojectionでfeature packetを正本化する

- Author: @sintariran
- Merged: 2026-07-21T18:37:10Z
- Commit: `b03bec63b9dd03d9ecc33baad705ec5d5dfe0f1b`

### Change Summary

- `.vibepro/config.json`に複数のnamed routing profileを定義し、既存`artifact_routing.artifacts`は後方互換なdefaultとして扱う。 - `.vibepro/config.json`の`brainbase.stories[]`を`artifact_profile`と`feature_slug`のauthorityとする。named profileを選ぶStoryではStory frontmatterを必須mirrorとし、不在または不一致なら共通resolverは書込前にfail closedする。profile metadataを持たないlegacy/unconfigured Storyではmirrorを任意とする。 - projectionは`renderer`と`ownership`を持ち、generated viewにsource path、SHA-256、renderer/schema version、direct-edit prohibitionを埋め込む。 - `human_owned`はVibeProが上書きせず、`curated`は自動上書き対象外として明示的な運用境界を返す。 - migration dry-runはprofile変更、move/collision、stale projection、human-owned overwrite...

### Compatibility

なし

### User Action

なし

<!-- vibepro-release-pr:373:end -->

<!-- vibepro-release-pr:375:start -->
## [#375](https://github.com/Unson-LLC/vibepro/pull/375) fix: policy_syncレビュー残課題3件を解消（#374 フォローアップ）

- Author: @sintariran
- Merged: 2026-07-21T23:17:49Z
- Commit: `4b15c508535f1156deb38f97bde853a7c8888b61`

### Change Summary

なし

### Compatibility

なし

### User Action

なし

<!-- vibepro-release-pr:375:end -->

<!-- vibepro-release-pr:372:start -->
## [#372](https://github.com/Unson-LLC/vibepro/pull/372) story-vibepro-autonomous-action-dag - Guarded Runを完全な型付き自律Action DAGへ拡張する

- Author: @sintariran
- Merged: 2026-07-22T00:06:54Z
- Commit: `df3c5dcd7cb95f99d06c299ee963fafeea2703fb`

### Change Summary

Story文書を更新: [docs/management/stories/active/story-vibepro-autonomous-action-dag.md](https://github.com/Unson-LLC/vibepro/blob/main/docs/management/stories/active/story-vibepro-autonomous-action-dag.md), [docs/management/stories/active/story-vibepro-autonomous-implementation-closure-roadmap.md](https://github.com/Unson-LLC/vibepro/blob/main/docs/management/stories/active/story-vibepro-autonomous-implementation-closure-roadmap.md), [docs/management/stories/active/story-vibepro-independent-review-orchestration.md](https://github.com/Unson-LLC/vibepro/blob/main/docs/management/stories/active/story-vibepro-independent-review-orchestration.md), [docs/management/stories/active/story-vibepro-one-command-pr-ready-closure.md](https://github.com/Unson-LLC/vibepro/blob/main/docs/management/stories/active/story-vibepro-one-command-pr-ready-closure.md), ...

### Compatibility

なし

### User Action

なし

<!-- vibepro-release-pr:372:end -->

<!-- vibepro-release-pr:370:start -->
## [#370](https://github.com/Unson-LLC/vibepro/pull/370) story-vibepro-trusted-delivery-efficiency-guardrail - 個別Gateの安全性だけでなく、Story全体の時間・subagent・token・再レビューを最適化したい

- Author: @sintariran
- Merged: 2026-07-22T01:13:14Z
- Commit: `154d4118c7294cd8269e6b89e84176d0f54d61eb`

### Change Summary

Story文書を更新: [docs/management/stories/active/story-vibepro-trusted-delivery-efficiency-guardrail.md](https://github.com/Unson-LLC/vibepro/blob/main/docs/management/stories/active/story-vibepro-trusted-delivery-efficiency-guardrail.md)

### Compatibility

なし

### User Action

なし

<!-- vibepro-release-pr:370:end -->

<!-- vibepro-release-pr:377:start -->
## [#377](https://github.com/Unson-LLC/vibepro/pull/377) story-vibepro-production-runtime-connectors - Agent Runtime Adapterへproduction connectorを接続する

- Author: @sintariran
- Merged: 2026-07-22T02:42:19Z
- Commit: `0c11f4fb9081407bb57ac59c3f6ca696faefa21f`

### Change Summary

アーキテクチャ判断を追加: [docs/architecture/story-vibepro-production-runtime-connectors.md](https://github.com/Unson-LLC/vibepro/blob/main/docs/architecture/story-vibepro-production-runtime-connectors.md)

### Compatibility

なし

### User Action

なし

<!-- vibepro-release-pr:377:end -->

<!-- vibepro-release-pr:378:start -->
## [#378](https://github.com/Unson-LLC/vibepro/pull/378) story-vibepro-target-architecture-conformance - Target Architecture SSOTとconformance dry-runを導入する

- Author: @sintariran
- Merged: 2026-07-22T06:11:28Z
- Commit: `ed7fde3cd9ad1e67840733821d1739e5c454228c`

### Change Summary

Story文書を更新: [docs/management/stories/active/story-vibepro-target-architecture-conformance.md](https://github.com/Unson-LLC/vibepro/blob/main/docs/management/stories/active/story-vibepro-target-architecture-conformance.md)

### Compatibility

なし

### User Action

なし

<!-- vibepro-release-pr:378:end -->

<!-- vibepro-release-pr:379:start -->
## [#379](https://github.com/Unson-LLC/vibepro/pull/379) story-vibepro-node20-e2e-ts-ci-visibility - Node 20 CIレーンのe2e .ts spec偽passを可視化しNode 22+必須ゲートで実行する

- Author: @sintariran
- Merged: 2026-07-22T07:05:29Z
- Commit: `ad063626a0685b92bbcee95f369965cc0e871378`

### Change Summary

Story文書を更新: [docs/management/stories/active/story-vibepro-node20-e2e-ts-ci-visibility.md](https://github.com/Unson-LLC/vibepro/blob/main/docs/management/stories/active/story-vibepro-node20-e2e-ts-ci-visibility.md)

### Compatibility

なし

### User Action

なし

<!-- vibepro-release-pr:379:end -->

<!-- vibepro-release-pr:380:start -->
## [#380](https://github.com/Unson-LLC/vibepro/pull/380) story-vibepro-canonical-audit-review-root-state-files - Canonical auditがreview root直下のstory-level state fileでmergeを失敗させないようにする

- Author: @sintariran
- Merged: 2026-07-22T07:29:04Z
- Commit: `6b9194470de71596e2afcdb82e877f6df7c5146f`

### Change Summary

Story文書を更新: [docs/management/stories/active/story-vibepro-canonical-audit-review-root-state-files.md](https://github.com/Unson-LLC/vibepro/blob/main/docs/management/stories/active/story-vibepro-canonical-audit-review-root-state-files.md)

### Compatibility

なし

### User Action

なし

<!-- vibepro-release-pr:380:end -->

<!-- vibepro-release-pr:382:start -->
## [#382](https://github.com/Unson-LLC/vibepro/pull/382) story-vibepro-independent-review-orchestration - Required Reviewを独立agentへ自動dispatchして記録する

- Author: @sintariran
- Merged: 2026-07-22T13:31:43Z
- Commit: `b235b36df6a225c49f4a98340c381eb2d8b8ad1c`

### Change Summary

Story文書を更新: [docs/management/stories/active/story-vibepro-independent-review-orchestration.md](https://github.com/Unson-LLC/vibepro/blob/main/docs/management/stories/active/story-vibepro-independent-review-orchestration.md)

### Compatibility

なし

### User Action

なし

<!-- vibepro-release-pr:382:end -->

<!-- vibepro-release-pr:383:start -->
## [#383](https://github.com/Unson-LLC/vibepro/pull/383) story-vibepro-merge-waiver-propagation - PR作成時の監査可能なGate waiverをexecute mergeへ安全に伝播する

- Author: @sintariran
- Merged: 2026-07-23T08:34:02Z
- Commit: `822599fc9ca91f1e726d089d3765f2270c92bd96`

### Change Summary

Story文書を更新: [docs/management/stories/active/story-vibepro-merge-waiver-propagation.md](https://github.com/Unson-LLC/vibepro/blob/main/docs/management/stories/active/story-vibepro-merge-waiver-propagation.md)

### Compatibility

なし

### User Action

なし

<!-- vibepro-release-pr:383:end -->

<!-- vibepro-release-pr:358:start -->
## [#358](https://github.com/Unson-LLC/vibepro/pull/358) story-vibepro-atomic-scope-review-contract - 大規模Storyが自ら追加したscope policyで自身の単一PRを承認できる循環を除く

- Author: @sintariran
- Merged: 2026-07-23T11:28:35Z
- Commit: `d6893c2671aeff5cb6792f215126af7d275038fc`

### Change Summary

Story文書を更新: [docs/management/stories/active/story-vibepro-atomic-scope-review-contract.md](https://github.com/Unson-LLC/vibepro/blob/main/docs/management/stories/active/story-vibepro-atomic-scope-review-contract.md)

### Compatibility

なし

### User Action

なし

<!-- vibepro-release-pr:358:end -->

<!-- vibepro-release-pr:381:start -->
## [#381](https://github.com/Unson-LLC/vibepro/pull/381) story-vibepro-codex-detached-completion-inbox - 10分wait超過でsubagent成果を失わず、後継Runが完了通知を回収したい

- Author: @sintariran
- Merged: 2026-07-23T16:44:09Z
- Commit: `1d98d4af969291976d4747547288628ef481d315`

### Change Summary

Story文書を更新: [docs/management/stories/active/story-vibepro-codex-detached-completion-inbox.md](https://github.com/Unson-LLC/vibepro/blob/main/docs/management/stories/active/story-vibepro-codex-detached-completion-inbox.md)

### Compatibility

なし

### User Action

なし

<!-- vibepro-release-pr:381:end -->

<!-- vibepro-release-pr:384:start -->
## [#384](https://github.com/Unson-LLC/vibepro/pull/384) Agent Review freshnessを検査surfaceとrelease-impactに束縛する

- Author: @sintariran
- Merged: 2026-07-23T22:49:28Z
- Commit: `f55312ecdf68c6a012147e89b317b237872e74fc`

### Change Summary

Story文書を更新: [docs/management/stories/active/story-vibepro-surface-aware-agent-review-freshness.md](https://github.com/Unson-LLC/vibepro/blob/main/docs/management/stories/active/story-vibepro-surface-aware-agent-review-freshness.md)

### Compatibility

なし

### User Action

なし

<!-- vibepro-release-pr:384:end -->

<!-- vibepro-release-pr:356:start -->
## [#356](https://github.com/Unson-LLC/vibepro/pull/356) story-vibepro-delivery-reconciliation-state - 外部マージ済みPRの再読込が、現在HEADのgate driftを隠して成功終了し得る

- Author: @sintariran
- Merged: 2026-07-24T05:29:07Z
- Commit: `5f2ecb1a1d5fd374f5d1e427e2f9d8f882dbcaf1`

### Change Summary

Story文書を更新: [docs/management/stories/active/story-vibepro-delivery-reconciliation-state.md](https://github.com/Unson-LLC/vibepro/blob/main/docs/management/stories/active/story-vibepro-delivery-reconciliation-state.md)

### Compatibility

なし

### User Action

なし

<!-- vibepro-release-pr:356:end -->

<!-- vibepro-release-pr:385:start -->
## [#385](https://github.com/Unson-LLC/vibepro/pull/385) story-vibepro-one-command-pr-ready-closure - 1コマンド自律実装を実Runtime E2Eで閉じる

- Author: @sintariran
- Merged: 2026-07-24T06:33:34Z
- Commit: `2617304f007c6d0ec5a7014873662d5ba3a2cff7`

### Change Summary

Story文書を更新: [docs/management/stories/active/story-vibepro-autonomous-action-dag.md](https://github.com/Unson-LLC/vibepro/blob/main/docs/management/stories/active/story-vibepro-autonomous-action-dag.md), [docs/management/stories/active/story-vibepro-autonomous-implementation-closure-roadmap.md](https://github.com/Unson-LLC/vibepro/blob/main/docs/management/stories/active/story-vibepro-autonomous-implementation-closure-roadmap.md), [docs/management/stories/active/story-vibepro-independent-review-orchestration.md](https://github.com/Unson-LLC/vibepro/blob/main/docs/management/stories/active/story-vibepro-independent-review-orchestration.md), [docs/management/stories/active/story-vibepro-one-command-pr-ready-closure.md](https://github.com/Unson-LLC/vibepro/blob/main/docs/management/stories/active/story-vibepro-one-command-pr-ready-closure.md), ...

### Compatibility

なし

### User Action

なし

<!-- vibepro-release-pr:385:end -->

<!-- vibepro-release-pr:386:start -->
## [#386](https://github.com/Unson-LLC/vibepro/pull/386) story-vibepro-one-command-pr-ready-closure - 1コマンド自律実装を実Runtime E2Eで閉じる

- Author: @sintariran
- Merged: 2026-07-24T15:16:04Z
- Commit: `904233b47bf69f755561433964d8420409da74ed`

### Change Summary

Story文書を更新: [docs/management/stories/active/story-vibepro-one-command-pr-ready-closure.md](https://github.com/Unson-LLC/vibepro/blob/main/docs/management/stories/active/story-vibepro-one-command-pr-ready-closure.md)

### Compatibility

なし

### User Action

なし

<!-- vibepro-release-pr:386:end -->

<!-- vibepro-release-pr:387:start -->
## [#387](https://github.com/Unson-LLC/vibepro/pull/387) story-vibepro-infra-story-dependency-cut - workspace-infraからstoryへの許可外依存を削減する

- Author: @sintariran
- Merged: 2026-07-24T16:31:47Z
- Commit: `158eca3d4cd7bdea1cf3ba33d7ac3a40ef2cb33b`

### Change Summary

Story文書を更新: [docs/management/stories/active/story-vibepro-infra-story-dependency-cut.md](https://github.com/Unson-LLC/vibepro/blob/main/docs/management/stories/active/story-vibepro-infra-story-dependency-cut.md)

### Compatibility

なし

### User Action

なし

<!-- vibepro-release-pr:387:end -->

<!-- vibepro-release-pr:388:start -->
## [#388](https://github.com/Unson-LLC/vibepro/pull/388) story-vibepro-autonomous-roadmap-catalog-closure - 自律実装ロードマップのStory catalogを完了状態へ整合する

- Author: @sintariran
- Merged: 2026-07-24T17:15:54Z
- Commit: `5897a47a385b6f0ef12f800858ee7e95b5b76fb5`

### Change Summary

Story文書を更新: [docs/management/stories/active/story-vibepro-autonomous-implementation-closure-roadmap.md](https://github.com/Unson-LLC/vibepro/blob/main/docs/management/stories/active/story-vibepro-autonomous-implementation-closure-roadmap.md), [docs/management/stories/active/story-vibepro-autonomous-roadmap-catalog-closure.md](https://github.com/Unson-LLC/vibepro/blob/main/docs/management/stories/active/story-vibepro-autonomous-roadmap-catalog-closure.md)

### Compatibility

なし

### User Action

なし

<!-- vibepro-release-pr:388:end -->

<!-- vibepro-release-pr:365:start -->
## [#365](https://github.com/Unson-LLC/vibepro/pull/365) story-vibepro-gate-decision-outcome-ledger - 実欠陥を捕捉したgate findingが実装修正・PR・mergeへ接続した価値を監査から再構成しにくい

- Author: @sintariran
- Merged: 2026-07-24T23:37:28Z
- Commit: `c15241fab63df07f0c8088954ce4f2190acbac32`

### Change Summary

Story文書を更新: [docs/management/stories/active/story-vibepro-gate-decision-outcome-ledger.md](https://github.com/Unson-LLC/vibepro/blob/main/docs/management/stories/active/story-vibepro-gate-decision-outcome-ledger.md)

### Compatibility

なし

### User Action

なし

<!-- vibepro-release-pr:365:end -->

<!-- vibepro-release-pr:389:start -->
## [#389](https://github.com/Unson-LLC/vibepro/pull/389) story-vibepro-conformance-nul-escape - architecture-conformance.jsの生NULバイトを\0エスケープに置換しテキストファイル性を回復する

- Author: @sintariran
- Merged: 2026-07-24T23:56:53Z
- Commit: `2edb825a50f248211b2d00a279797a2cf8578b6d`

### Change Summary

Story文書を更新: [docs/management/stories/active/story-vibepro-conformance-nul-escape.md](https://github.com/Unson-LLC/vibepro/blob/main/docs/management/stories/active/story-vibepro-conformance-nul-escape.md)

### Compatibility

なし

### User Action

なし

<!-- vibepro-release-pr:389:end -->

<!-- vibepro-release-pr:390:start -->
## [#390](https://github.com/Unson-LLC/vibepro/pull/390) story-vibepro-import-based-conformance - モジュール間依存の測定をGraphify callsから実import文スキャンへ切り替える

- Author: @sintariran
- Merged: 2026-07-25T00:22:47Z
- Commit: `6a652c9866cc796a3bd3e5666e9827ac66c4f4fa`

### Change Summary

Story文書を更新: [docs/management/stories/active/story-vibepro-import-based-conformance.md](https://github.com/Unson-LLC/vibepro/blob/main/docs/management/stories/active/story-vibepro-import-based-conformance.md)

### Compatibility

なし

### User Action

なし

<!-- vibepro-release-pr:390:end -->

<!-- vibepro-release-pr:361:start -->
## [#361](https://github.com/Unson-LLC/vibepro/pull/361) story-vibepro-symlinked-bin-entrypoint - symlink経由でもVibePro CLIを実行する

- Author: @sintariran
- Merged: 2026-07-25T05:13:50Z
- Commit: `49e55e805a47c0ec78bf6a4f39fdadf5e1b79c7c`

### Change Summary

Story文書を更新: [docs/management/stories/active/story-vibepro-symlinked-bin-entrypoint.md](https://github.com/Unson-LLC/vibepro/blob/main/docs/management/stories/active/story-vibepro-symlinked-bin-entrypoint.md)

### Compatibility

なし

### User Action

なし

<!-- vibepro-release-pr:361:end -->

<!-- vibepro-release-pr:217:start -->
## [#217](https://github.com/Unson-LLC/vibepro/pull/217) chore(deps): bump actions/checkout from 6 to 7

- Author: @dependabot[bot]
- Merged: 2026-07-25T10:39:18Z
- Commit: `c9136927c1af0eb3c6d532dc21df677d478ca9cd`

### Change Summary

なし

### Compatibility

なし

### User Action

なし

<!-- vibepro-release-pr:217:end -->

<!-- vibepro-release-pr:391:start -->
## [#391](https://github.com/Unson-LLC/vibepro/pull/391) story-vibepro-ideal-state-inversion - senior-gap judgmentのideal_stateがStoryではなく裁定済みtarget architectureを参照するようにする

- Author: @sintariran
- Merged: 2026-07-25T11:01:43Z
- Commit: `c044ce5f5bca7bea76a21f36487655a33b74206e`

### Change Summary

Story文書を更新: [docs/management/stories/active/story-vibepro-ideal-state-inversion.md](https://github.com/Unson-LLC/vibepro/blob/main/docs/management/stories/active/story-vibepro-ideal-state-inversion.md)

### Compatibility

なし

### User Action

なし

<!-- vibepro-release-pr:391:end -->

<!-- vibepro-release-pr:392:start -->
## [#392](https://github.com/Unson-LLC/vibepro/pull/392) story-vibepro-docs-only-evidence-profile - budget exceeded 19/71の大半が製品変更0行のdocs/roadmap Storyで、bundleが3,700〜5,000行に膨らみ、計測上もdiff base喪失でratioが壊れている

- Author: @sintariran
- Merged: 2026-07-25T14:47:59Z
- Commit: `c11bd9836e4c1fb4f5e224d3bec50b9ba3664464`

### Change Summary

Story文書を更新: [docs/management/stories/active/story-vibepro-docs-only-evidence-profile.md](https://github.com/Unson-LLC/vibepro/blob/main/docs/management/stories/active/story-vibepro-docs-only-evidence-profile.md)

### Compatibility

なし

### User Action

なし

<!-- vibepro-release-pr:392:end -->

<!-- vibepro-release-pr:394:start -->
## [#394](https://github.com/Unson-LLC/vibepro/pull/394) feat: support task-scoped PR acceptance gates

- Author: @sintariran
- Merged: 2026-07-29T02:01:53Z
- Commit: `524037a634369c758c03444a123d56fc58397251`

### Change Summary

なし

### Compatibility

なし

### User Action

なし

<!-- vibepro-release-pr:394:end -->

<!-- vibepro-release-pr:395:start -->
## [#395](https://github.com/Unson-LLC/vibepro/pull/395) story-vibepro-runner-direct-evidence - 先行Storyで『441/441で再実行した』という真の主張ですら、artifactが前回と同一内容のためgit上で検証不能になり3ラウンド連続で指摘された。head_shaを手で足す対処をしたが、根本は実行した者と記録する者が同一であること

- Author: @sintariran
- Merged: 2026-07-29T05:01:56Z
- Commit: `6cc3b280ec1438d07dc787f862d6f3ee5f0675a2`

### Change Summary

`vibepro verify run &lt;repo&gt; --id &lt;story-id&gt; --kind &lt;kind&gt; -- &lt;command...&gt;` を追加し、VibePro 自身がそのコマンドを argv として（shell を介さず）実行する。status は観測した exit code から導出し、テスト計数は実際の出力から解析し、実行前後の head sha と working tree fingerprint、所要時間、stdout と stdout+stderr の SHA-256 を記録する。`--status` は拒否し、runner が計算するキーへの `--observed` は計算値で上書きして破棄した入力を `observation_overrides` として残す。証跡の出所は記録経路が決める（`runner_direct` / `autopilot_run` / `ci_import` / `self_reported`）。既存の `pr autopilot` もコマンドを自ら実行しているため `autopilot_run` として記録する。

### Compatibility

記録**形式**は追加のみで、既存フィールドの意味は変えず、未知フィールドを拒否する consumer はリポジトリ内に存在しない。`evidence_source` を持たない既存記録は self_reported として解釈する。一方、`verify record` の**入力契約は非互換に狭まる**: これまで受理されていた `--observed` のうち、runner の実行だけが生成できる provenance/integrity キー26個（`run_artifact`, `stdout_sha256`, `worktree_sha256_before` 等。境界は Spec に列挙）は拒否になり、caller 提供 artifact 経由の同キーは strip + 警告記録になる。影響範囲は誰でも再実行できる2つのスキャンで確認できる: (1) リポジトリ内の全 `verification-evidence.json` を走査し、非 runner 経路の記録に禁止キーが載っていないこと（`grep -rl verification-evidence.json` で列挙して各 command の `evidence_source` と `observation.values` を照合）、(2) `grep -rn -- '--observed' docs/ skills/ scripts/`...

### User Action

このリポジトリ内では必須の操作はない（互換性節の repo 内スキャンで確認済み）。**外部リポジトリでは2点確認が必要**。(1) `verify record --observed` を使っている場合: Spec に列挙された provenance/integrity キー26個（`run_artifact`, `stdout_sha256`, `timed_out` 等）を渡していると、このリリース以降はコマンドが失敗し記録は書かれない。既存スクリプトの `--observed` キーを Spec の一覧と照合し、該当キーは削除するか `verify run` へ移行すること（caller 提供 `--artifact` 経由の同キーはコマンドは成功するが該当キーは落ち、警告として記録される）。成果観測キー（tests / pass / fail / duration_ms / head_sha 等）はそのまま使える。(2) runner_direct 記録を既に持つ場合: 次回の `pr prepare` で gate 証跡分類が targets / scenarios 由来だけになるため、provenance パスでしか runtime_path_evidence を得ていなかった記録は spine gate（current_reality / failure_modes / done_evidence）を満たさなくなり得る。gate が unmet...

<!-- vibepro-release-pr:395:end -->

<!-- vibepro-release-pr:396:start -->
## [#396](https://github.com/Unson-LLC/vibepro/pull/396) story-vibepro-release-0-2-0-beta-2 - runner-direct evidence (PR #395) を含む #356〜#395 の約20PR分が npm 未公開のまま main に滞留している

- Author: @sintariran
- Merged: 2026-07-29T07:56:26Z
- Commit: `3b7a12bdfa193bdaa75e6fcb83b8c079c19de051`

### Change Summary

Story文書を更新: [docs/management/stories/active/story-vibepro-release-0-2-0-beta-2.md](https://github.com/Unson-LLC/vibepro/blob/main/docs/management/stories/active/story-vibepro-release-0-2-0-beta-2.md)

### Compatibility

なし

### User Action

なし

<!-- vibepro-release-pr:396:end -->

<!-- vibepro-release-pr:397:start -->
## [#397](https://github.com/Unson-LLC/vibepro/pull/397) story-vibepro-review-surface-violation-ledger - 先行 Story の round 6 で、実装エージェントがレビュー実行中にツリーを変更した。lifecycle は start 時の head_sha しか記録しないため機械検出されず、レビュアーが git status を偶然見て発見した。違反は stale と同じ failed 表示になり、レビュー再実行で痕跡ごと消えた

- Author: @sintariran
- Merged: 2026-07-29T10:38:00Z
- Commit: `e3ef7b963170f8500d370f6914037009944d3e0e`

### Change Summary

Story文書を更新: [docs/management/stories/active/story-vibepro-review-surface-violation-ledger.md](https://github.com/Unson-LLC/vibepro/blob/main/docs/management/stories/active/story-vibepro-review-surface-violation-ledger.md)

### Compatibility

なし

### User Action

なし

<!-- vibepro-release-pr:397:end -->

<!-- vibepro-release-pr:398:start -->
## [#398](https://github.com/Unson-LLC/vibepro/pull/398) story-vibepro-merge-binding-stale-stop-reason - Clear stale decision-outcome-binding failure flags when rebinding succeeds

- Author: @sintariran
- Merged: 2026-07-29T16:13:45Z
- Commit: `412ecdc01877941491df99cb5378d832cd67ee3c`

### Change Summary

Story文書を更新: [docs/management/stories/active/story-vibepro-merge-binding-stale-stop-reason.md](https://github.com/Unson-LLC/vibepro/blob/main/docs/management/stories/active/story-vibepro-merge-binding-stale-stop-reason.md)

### Compatibility

なし

### User Action

なし

<!-- vibepro-release-pr:398:end -->

<!-- vibepro-release-pr:399:start -->
## [#399](https://github.com/Unson-LLC/vibepro/pull/399) fix: keep session-cost available on corrupt process metadata

- Author: @sintariran
- Merged: 2026-07-30T03:26:23Z
- Commit: `17d9e139c87eebfffa07dd658ff40d9dbefd096b`

### Change Summary

Story文書を更新: [docs/management/stories/active/story-vibepro-session-cost-source-health-fail-soft.md](https://github.com/Unson-LLC/vibepro/blob/main/docs/management/stories/active/story-vibepro-session-cost-source-health-fail-soft.md)

### Compatibility

なし

### User Action

なし

<!-- vibepro-release-pr:399:end -->

<!-- vibepro-release-pr:403:start -->
## [#403](https://github.com/Unson-LLC/vibepro/pull/403) story-vibepro-process-record-worktree-durability - プロセス記録をworktreeライフサイクルから切り離して永続化する

- Author: @sintariran
- Merged: 2026-07-30T13:18:00Z
- Commit: `0d89fd8819654684ddecc61738a8ae31224be6b3`

### Change Summary

Story文書を更新: [docs/management/stories/active/story-vibepro-process-record-worktree-durability.md](https://github.com/Unson-LLC/vibepro/blob/main/docs/management/stories/active/story-vibepro-process-record-worktree-durability.md)

### Compatibility

なし

### User Action

なし

<!-- vibepro-release-pr:403:end -->

<!-- vibepro-release-pr:404:start -->
## [#404](https://github.com/Unson-LLC/vibepro/pull/404) story-vibepro-task-atomic-repo-control-contract - Taskが同一HEADを要求するworkflowとruntimeを現行split policyが強制分離する矛盾を解消する

- Author: @sintariran
- Merged: 2026-07-30T19:56:24Z
- Commit: `a6ab8b0e0891d89b928e34c072684f2beb74c5b9`

### Change Summary

Story文書を更新: [docs/management/stories/active/story-vibepro-task-atomic-repo-control-contract.md](https://github.com/Unson-LLC/vibepro/blob/main/docs/management/stories/active/story-vibepro-task-atomic-repo-control-contract.md)

### Compatibility

なし

### User Action

なし

<!-- vibepro-release-pr:404:end -->

<!-- vibepro-release-pr:405:start -->
## [#405](https://github.com/Unson-LLC/vibepro/pull/405) fix: recover terminal review replacement lifecycle

- Author: @sintariran
- Merged: 2026-07-31T10:15:29Z
- Commit: `31d84833cd2059843593169cc6d7aa3d804a3f07`

### Change Summary

なし

### Compatibility

なし

### User Action

なし

<!-- vibepro-release-pr:405:end -->

<!-- vibepro-release-pr:401:start -->
## [#401](https://github.com/Unson-LLC/vibepro/pull/401) story-vibepro-verify-command-test-path-existence-guard - verify record/runのコマンドが名指しするtest fileパスの実在を検証する

- Author: @sintariran
- Merged: 2026-08-01T01:53:50Z
- Commit: `344b7a3aed391b0c320c021e8b524ec58615cee4`

### Change Summary

Story文書を更新: [docs/management/stories/active/story-vibepro-verify-command-test-path-existence-guard.md](https://github.com/Unson-LLC/vibepro/blob/main/docs/management/stories/active/story-vibepro-verify-command-test-path-existence-guard.md)

### Compatibility

なし

### User Action

なし

<!-- vibepro-release-pr:401:end -->

<!-- vibepro-release-pr:406:start -->
## [#406](https://github.com/Unson-LLC/vibepro/pull/406) story-vibepro-budget-grant-tracked-decision-doc - budget grant を diff でレビュー可能にする: decision record --source budget:delivery_efficiency:* が tracked decision document を必ず書く

- Author: @sintariran
- Merged: 2026-08-01T11:44:15Z
- Commit: `4b4b35a8eb28c962b99161d544d67031edab6e69`

### Change Summary

Story文書を更新: [docs/management/stories/active/story-vibepro-budget-grant-tracked-decision-doc.md](https://github.com/Unson-LLC/vibepro/blob/main/docs/management/stories/active/story-vibepro-budget-grant-tracked-decision-doc.md), [docs/management/stories/active/story-vibepro-budget-override-residual-findings.md](https://github.com/Unson-LLC/vibepro/blob/main/docs/management/stories/active/story-vibepro-budget-override-residual-findings.md), [docs/management/stories/active/story-vibepro-owner-gated-budget-override.md](https://github.com/Unson-LLC/vibepro/blob/main/docs/management/stories/active/story-vibepro-owner-gated-budget-override.md)

### Compatibility

なし

### User Action

なし

<!-- vibepro-release-pr:406:end -->

<!-- vibepro-release-pr:407:start -->
## [#407](https://github.com/Unson-LLC/vibepro/pull/407) story-vibepro-vacuous-e2e-test-elimination - test/e2e配下に、テスト内で定義した文字列リテラルを同じ文字列由来の正規表現でassert.matchするだけの、構造上失敗しないテストが19ファイル存在する

- Author: @sintariran
- Merged: 2026-08-02T01:44:24Z
- Commit: `8dc2c3d65ec9acd7936a0cbdb07b4009242d1ff3`

### Change Summary

当初の記載は以下のとおりで、これは撤回する。記録として残す。 &gt; 本Storyは2 PRに分けて出荷する。順序に依存関係があるため入れ替えられない。 &gt; &gt; 1. **PR 1 (e2e-gate / requirements-ssot / repo-control)**: 19件の削除・2件の実挙動テストへの書き換え・Story登録・`.vibepro/spec/` のtest_ref張り替え・`docs/specs/vibepro-pr-ship-command.md` の記述修正。VET-S-2 / VET-S-3 / VET-S-4 / VET-S-6 を満たす。 &gt; 2. **PR 2 (runtime-behavior)**: `scripts/lint-e2e-product-execution.mjs` と `test/e2e-product-execution-lint.test.js`。VET-S-1 / VET-S-5 を満たす。 &gt; &gt; lintは19件が存在する状態では失敗するため、PR 2 を先に出すとCIが赤になる。逆順(PR 1 → PR 2)は各PR単体でgreenであることを実測済み。 撤回の根拠は以下のとおり。1は未検証の観察、2と3は検証済みであり、 2と3だけで撤回の判断は成立する。 1. **分割の主動機は根拠として使えない(未検証)**: 下記 Dogfooding findings 1 は 「削除主体のlaneは...

### Compatibility

なし

### User Action

なし

<!-- vibepro-release-pr:407:end -->

<!-- vibepro-release-pr:409:start -->
## [#409](https://github.com/Unson-LLC/vibepro/pull/409) story-vibepro-profiler-file-walk-stack-overflow - architecture-profiler のファイル走査を反復処理化し、大規模treeでの "Maximum call stack size exceeded" を解消する

- Author: @sintariran
- Merged: 2026-08-02T15:52:39Z
- Commit: `8c52f7c65a377399b7a0514673865025fdef9712`

### Change Summary

Story文書を更新: [docs/management/stories/active/story-vibepro-profiler-file-walk-stack-overflow.md](https://github.com/Unson-LLC/vibepro/blob/main/docs/management/stories/active/story-vibepro-profiler-file-walk-stack-overflow.md)

### Compatibility

なし

### User Action

なし

<!-- vibepro-release-pr:409:end -->

<!-- vibepro-release-pr:412:start -->
## [#412](https://github.com/Unson-LLC/vibepro/pull/412) story-vibepro-unit-suite-concurrency-default - unit証跡の全体スイート実行を実測最適並列度に正本化し、verify runのタイムアウト余裕を確保する

- Author: @sintariran
- Merged: 2026-08-02T18:56:59Z
- Commit: `0ac8c84e8c2cde3897fa8bd705b009473aa4d4e2`

### Change Summary

Story文書を更新: [docs/management/stories/active/story-vibepro-unit-suite-concurrency-default.md](https://github.com/Unson-LLC/vibepro/blob/main/docs/management/stories/active/story-vibepro-unit-suite-concurrency-default.md)

### Compatibility

なし

### User Action

なし

<!-- vibepro-release-pr:412:end -->

<!-- vibepro-release-pr:415:start -->
## [#415](https://github.com/Unson-LLC/vibepro/pull/415) story-vibepro-codex-host-containment-test-load-tolerance - test/codex-subagent-host.test.js の containment テストが load average 20-35 の full suite 実行時のみ condition timeout でフレークする

- Author: @sintariran
- Merged: 2026-08-02T21:31:46Z
- Commit: `e3a0560f73d49b6ccdbea82bd355d8b6bf2e6bf5`

### Change Summary

Story文書を更新: [docs/management/stories/active/story-vibepro-codex-host-containment-test-load-tolerance.md](https://github.com/Unson-LLC/vibepro/blob/main/docs/management/stories/active/story-vibepro-codex-host-containment-test-load-tolerance.md)

### Compatibility

なし

### User Action

なし

<!-- vibepro-release-pr:415:end -->

<!-- vibepro-release-pr:416:start -->
## [#416](https://github.com/Unson-LLC/vibepro/pull/416) story-vibepro-uiux-intake-gate-pr-summary-surfaces - gate:uiux_intake_judgment を人間向けPRサマリー表面に表示する

- Author: @sintariran
- Merged: 2026-08-03T01:25:38Z
- Commit: `aa58826cd087f5db2e11511de15151b46bda4bb1`

### Change Summary

Story文書を更新: [docs/management/stories/active/story-vibepro-uiux-intake-gate-pr-summary-surfaces.md](https://github.com/Unson-LLC/vibepro/blob/main/docs/management/stories/active/story-vibepro-uiux-intake-gate-pr-summary-surfaces.md)

### Compatibility

なし

### User Action

なし

<!-- vibepro-release-pr:416:end -->

<!-- vibepro-release-pr:413:start -->
## [#413](https://github.com/Unson-LLC/vibepro/pull/413) story-vibepro-cross-system-adjudication - Cross-system adjudication requires a different model family than the implementer

- Author: @sintariran
- Merged: 2026-08-03T02:20:37Z
- Commit: `2c5bdd7fdaf5b2546ca0cd23ff5041f98fe7bee3`

### Change Summary

Story文書を更新: [docs/management/stories/active/story-vibepro-cross-system-adjudication.md](https://github.com/Unson-LLC/vibepro/blob/main/docs/management/stories/active/story-vibepro-cross-system-adjudication.md)

### Compatibility

なし

### User Action

なし

<!-- vibepro-release-pr:413:end -->

<!-- vibepro-release-pr:417:start -->
## [#417](https://github.com/Unson-LLC/vibepro/pull/417) story-vibepro-test-tmpdir-fixture-cleanup - テストスイートが$TMPDIRに残すmkdtemp fixtureのクリーンアップ機構

- Author: @sintariran
- Merged: 2026-08-03T03:10:18Z
- Commit: `813bd5dd2aa17f90ef4997492faf80c3936cd0bc`

### Change Summary

Story文書を更新: [docs/management/stories/active/story-vibepro-test-tmpdir-fixture-cleanup.md](https://github.com/Unson-LLC/vibepro/blob/main/docs/management/stories/active/story-vibepro-test-tmpdir-fixture-cleanup.md)

### Compatibility

なし

### User Action

なし

<!-- vibepro-release-pr:417:end -->

<!-- vibepro-release-pr:418:start -->
## [#418](https://github.com/Unson-LLC/vibepro/pull/418) story-vibepro-verification-checkpoint-uiux-intake-gate - verification checkpoint の curated gate list に gate:uiux_intake_judgment を追加する

- Author: @sintariran
- Merged: 2026-08-03T06:55:00Z
- Commit: `2326a3c533d1e493f888f64e7eb49a4dd16abefc`

### Change Summary

Story文書を更新: [docs/management/stories/active/story-vibepro-verification-checkpoint-uiux-intake-gate.md](https://github.com/Unson-LLC/vibepro/blob/main/docs/management/stories/active/story-vibepro-verification-checkpoint-uiux-intake-gate.md)

### Compatibility

なし

### User Action

なし

<!-- vibepro-release-pr:418:end -->

<!-- vibepro-release-pr:419:start -->
## [#419](https://github.com/Unson-LLC/vibepro/pull/419) story-vibepro-pr-human-summary-dead-chain-removal - 死んだ人間向けPRサマリーレンダラーチェーンを削除する

- Author: @sintariran
- Merged: 2026-08-03T08:25:33Z
- Commit: `52da597503d976681590f6f5362d0479d3845027`

### Change Summary

Story文書を更新: [docs/management/stories/active/story-vibepro-pr-human-summary-dead-chain-removal.md](https://github.com/Unson-LLC/vibepro/blob/main/docs/management/stories/active/story-vibepro-pr-human-summary-dead-chain-removal.md)

### Compatibility

なし

### User Action

なし

<!-- vibepro-release-pr:419:end -->

<!-- vibepro-release-pr:420:start -->
## [#420](https://github.com/Unson-LLC/vibepro/pull/420) story-vibepro-strict-head-binding-origin-guard - strict HEAD bindingをfrozen final_reviewとrole policy例外に限定する

- Author: @sintariran
- Merged: 2026-08-03T14:46:26Z
- Commit: `c0be2d11de8704f070b0af6e872f2ab5cbbb1518`

### Change Summary

Story文書を更新: [docs/management/stories/active/story-vibepro-strict-head-binding-origin-guard.md](https://github.com/Unson-LLC/vibepro/blob/main/docs/management/stories/active/story-vibepro-strict-head-binding-origin-guard.md)

### Compatibility

なし

### User Action

なし

<!-- vibepro-release-pr:420:end -->

<!-- vibepro-release-pr:414:start -->
## [#414](https://github.com/Unson-LLC/vibepro/pull/414) story-vibepro-uiux-intake-judgment-gate - uiux intakeのSkill発火 + 判断記録gate

- Author: @sintariran
- Merged: 2026-08-04T02:09:12Z
- Commit: `a6610283e9688d1e768b588efc2eda886c2b36aa`

### Change Summary

「行為を強制せず、無言を禁止する」というVibePro内の確立パターン （`not_verifiable_by_automation` のaccepted decision、`not_applicable` decisionによる 正直な閉じ方、guardのbypass理由必須）に揃え、分業を次で切る: 1. **Skill側（発火判断）**: `skills/vibepro-workflow/SKILL.md` にStory受領時のintake要否 判断を追記する。UI/UX intentなら `vibepro uiux intake validate` を回し、不要と判断 したら理由付きの `intake_not_applicable` decision recordを記録する。 2. **ハーネス側（判断存在の検証）**: `pr prepare` はintake coverageそのものを要求しない。 要求するのは「intake要否の判断が記録されていること」のみ。 - intake coverage artifact（`.vibepro/uiux/&lt;story-id&gt;/uiux-intake-coverage.json` または `.vibepro/design-modernize/&lt;story-id&gt;/uiux-intake-coverage.json`）が存在すれば satisfied - `intake_not_applicable`...

### Compatibility

なし

### User Action

なし

<!-- vibepro-release-pr:414:end -->

<!-- vibepro-release-pr:408:start -->
## [#408](https://github.com/Unson-LLC/vibepro/pull/408) story-vibepro-progress-heartbeat-policy-kernel - src配下37箇所の長時間実行バウンドのうち理想形を満たすのはevaluateProgressBounds 1箇所のみ。バウンド皆無の子プロセスと進捗シグナル破棄サイトを正本kernelへ寄せたい

- Author: @sintariran
- Merged: 2026-08-04T04:40:27Z
- Commit: `bc722efef60c61c4ff4c58a93321e294a92c571d`

### Change Summary

Story文書を更新: [docs/management/stories/active/story-vibepro-progress-heartbeat-policy-kernel.md](https://github.com/Unson-LLC/vibepro/blob/main/docs/management/stories/active/story-vibepro-progress-heartbeat-policy-kernel.md)

### Compatibility

なし

### User Action

なし

<!-- vibepro-release-pr:408:end -->

<!-- vibepro-release-pr:421:start -->
## [#421](https://github.com/Unson-LLC/vibepro/pull/421) story-vibepro-conformance-delta-ledger - conformance delta ledger — base/head差分でアーキテクチャ逸脱を再現可能に観測する

- Author: @sintariran
- Merged: 2026-08-04T09:52:52Z
- Commit: `024737dc4a9560cd0b32da30ae7037fde8dd86e0`

### Change Summary

Story文書を更新: [docs/management/stories/active/story-vibepro-conformance-delta-ledger.md](https://github.com/Unson-LLC/vibepro/blob/main/docs/management/stories/active/story-vibepro-conformance-delta-ledger.md)

### Compatibility

なし

### User Action

なし

<!-- vibepro-release-pr:421:end -->

<!-- vibepro-release-pr:422:start -->
## [#422](https://github.com/Unson-LLC/vibepro/pull/422) fix: iterative pr-manager walkFiles + exclude .claude from repo scanners

- Author: @sintariran
- Merged: 2026-08-04T10:27:44Z
- Commit: `298bcc0d0e7a5ebfd614d2c33d2a1d059f7786be`

### Change Summary

なし

### Compatibility

なし

### User Action

なし

<!-- vibepro-release-pr:422:end -->

<!-- vibepro-release-pr:424:start -->
## [#424](https://github.com/Unson-LLC/vibepro/pull/424) story-vibepro-target-model-governance-rebaseline - target model governance rebaseline — 誰がモデルを変えてよいかを三分法で確定し、再baseline案と裁定カードを機械生成する

- Author: @sintariran
- Merged: 2026-08-04T14:16:30Z
- Commit: `b34a74cf8e9e5f17d4b258f8fff53473cfa4cc1b`

### Change Summary

Story文書を更新: [docs/management/stories/active/story-vibepro-target-model-governance-rebaseline.md](https://github.com/Unson-LLC/vibepro/blob/main/docs/management/stories/active/story-vibepro-target-model-governance-rebaseline.md)

### Compatibility

なし

### User Action

なし

<!-- vibepro-release-pr:424:end -->

<!-- vibepro-release-pr:427:start -->
## [#427](https://github.com/Unson-LLC/vibepro/pull/427) story-vibepro-target-model-projection-v2 - target model projection v2 — 佐藤裁定済みの5問を target-model.json へ機械的に投影し model_version を 2 へ上げる

- Author: @sintariran
- Merged: 2026-08-04T17:02:28Z
- Commit: `71bab5ec9f901dc724d07e94973979fd14a095cf`

### Change Summary

Story文書を更新: [docs/management/stories/active/story-vibepro-target-model-projection-v2.md](https://github.com/Unson-LLC/vibepro/blob/main/docs/management/stories/active/story-vibepro-target-model-projection-v2.md)

### Compatibility

なし

### User Action

なし

<!-- vibepro-release-pr:427:end -->

<!-- vibepro-release-pr:428:start -->
## [#428](https://github.com/Unson-LLC/vibepro/pull/428) story-vibepro-dependency-cycle-scc-reduction - dependency_cycle の SCC 縮約 — 69,490件の単純閉路列挙を「1つのSCC + 20の相互依存ペア」へ畳み、ratchet gate を載せられる粒度にする

- Author: @sintariran
- Merged: 2026-08-05T05:15:21Z
- Commit: `718aef115e8658bcc911e758cb6a1f91a5646801`

### Change Summary

Story文書を更新: [docs/management/stories/active/story-vibepro-dependency-cycle-scc-reduction.md](https://github.com/Unson-LLC/vibepro/blob/main/docs/management/stories/active/story-vibepro-dependency-cycle-scc-reduction.md)

### Compatibility

なし

### User Action

なし

<!-- vibepro-release-pr:428:end -->

<!-- vibepro-release-pr:429:start -->
## [#429](https://github.com/Unson-LLC/vibepro/pull/429) refactor: 縮小リファクタ Slice 1 — 診断/UIUX/architecture/performanceスキャナ群を削除

- Author: @sintariran
- Merged: 2026-08-06T10:49:23Z
- Commit: `fcb4b825098dcdc8b1781afa82f9196e16ebac91`

### Change Summary

なし

### Compatibility

なし

### User Action

なし

<!-- vibepro-release-pr:429:end -->

<!-- vibepro-release-pr:430:start -->
## [#430](https://github.com/Unson-LLC/vibepro/pull/430) refactor: 縮小リファクタ Slice 2 — 実行エンジン本体（execute/gate/adjudicate/outcome/checkpoint）を削除

- Author: @sintariran
- Merged: 2026-08-06T12:47:30Z
- Commit: `b81e78c9553b4ec8fb0c4ddc57328404cb24f25e`

### Change Summary

なし

### Compatibility

なし

### User Action

なし

<!-- vibepro-release-pr:430:end -->

<!-- vibepro-release-pr:431:start -->
## [#431](https://github.com/Unson-LLC/vibepro/pull/431) refactor: 縮小リファクタ Slice 3 — delivery-efficiency予算全系を削除

- Author: @sintariran
- Merged: 2026-08-06T14:00:25Z
- Commit: `ca1fd47bbe8ff15b36ce0cb06343fef5bd3fe7b9`

### Change Summary

なし

### Compatibility

なし

### User Action

なし

<!-- vibepro-release-pr:431:end -->

<!-- vibepro-release-pr:432:start -->
## [#432](https://github.com/Unson-LLC/vibepro/pull/432) refactor: 縮小リファクタ Slice 4 — run-context-capsuleスナップショット機構を削除（計画の実測更新込み）

- Author: @sintariran
- Merged: 2026-08-06T14:55:04Z
- Commit: `b49b07f1dfb3461b87430c74bed705fbca9826ae`

### Change Summary

なし

### Compatibility

なし

### User Action

なし

<!-- vibepro-release-pr:432:end -->

<!-- vibepro-release-pr:435:start -->
## [#435](https://github.com/Unson-LLC/vibepro/pull/435) feat: v-nextフォローアップ — report fingerprint再設計とstory_source/AC対応マップのpr prepare再統合

- Author: @sintariran
- Merged: 2026-08-06T22:51:31Z
- Commit: `f763e3f59fca9e938c8e49ca023f583a2ee3f53d`

### Change Summary

なし

### Compatibility

なし

### User Action

なし

<!-- vibepro-release-pr:435:end -->

<!-- vibepro-release-pr:437:start -->
## [#437](https://github.com/Unson-LLC/vibepro/pull/437) release: publish minimal core beta.3

- Author: @sintariran
- Merged: 2026-08-07T02:08:05Z
- Commit: `dbc88fc74dcf7f3472556b8b4a349032fb30846e`

### Change Summary

Publish VibePro 0.2.0-beta.3 as the rebuilt minimal core. Align the npm README and VitePress entry pages with the current Story, Spec, verification, review, decision, trace, and PR evidence boundary. Remove retired CI commands and stale TypeScript acceptance specs.

### Compatibility

Breaking beta cleanup. Removed Gate DAG, blocking readiness verdicts, managed execution and merge, lifecycle accounting, budget enforcement, automatic adjudication and audit, check, and checkpoint command surfaces are not restored as aliases.

### User Action

Update to vibepro@beta and migrate automation to commands listed by vibepro help. Pin vibepro@0.2.0-beta.2 only if temporary migration time is required.

<!-- vibepro-release-pr:437:end -->

<!-- vibepro-release-pr:438:start -->
## [#438](https://github.com/Unson-LLC/vibepro/pull/438) fix: v-next外部repo初適用で見つかった不具合5件を修正 (#436)

- Author: @sintariran
- Merged: 2026-08-07T06:16:59Z
- Commit: `73b62a58f2d024f986fcf77d7dcf66faf2b9ee69`

### Change Summary

なし

### Compatibility

なし

### User Action

なし

<!-- vibepro-release-pr:438:end -->

<!-- vibepro-release-pr:442:start -->
## [#442](https://github.com/Unson-LLC/vibepro/pull/442) feat: シニアエンジニア判断DAGを追加

- Author: @sintariran
- Merged: 2026-08-07T12:10:22Z
- Commit: `941e9ddacec2f10c56ef95c2b1a08a84d8a88519`

### Change Summary

なし

### Compatibility

なし

### User Action

なし

<!-- vibepro-release-pr:442:end -->

<!-- vibepro-release-pr:443:start -->
## [#443](https://github.com/Unson-LLC/vibepro/pull/443) fix: derive judgment mode from causal evidence

- Author: @sintariran
- Merged: 2026-08-07T14:25:44Z
- Commit: `584ba3f413e79f58f0645306aa616abf8d87e683`

### Change Summary

なし

### Compatibility

なし

### User Action

なし

<!-- vibepro-release-pr:443:end -->

<!-- vibepro-release-pr:444:start -->
## [#444](https://github.com/Unson-LLC/vibepro/pull/444) fix: 判断モードの証拠境界を分離

- Author: @sintariran
- Merged: 2026-08-07T16:07:53Z
- Commit: `af91a470adfb895701c0e0c56cc0788c0f5b39cd`

### Change Summary

Senior Engineering Judgment DAGが、問題の存在と解決方向の証拠を別々に扱うようになりました。構造的過剰はSIMPLIFY、価値制約はVALUE、判断証拠が不足・不明ならVALIDATEへ分岐します。公開versionの投影対象を現行版フィールドへ限定し、過去のrelease履歴とrollback先を保持したままVitePress metadataを同期します。

### Compatibility

Breaking beta change: senior judgment input schemaは0.2.0から0.3.0へ更新されました。0.2.0入力は曖昧な旧契約として拒否されます。

### User Action

senior judgment入力のcurrent_constraintへkindとdecision_evidenceを追加してください。kindはvalue_constraintまたはstructural_excess、decision_evidence.statusはsufficient、insufficient、unknownのいずれかです。

<!-- vibepro-release-pr:444:end -->

<!-- vibepro-release-pr:445:start -->
## [#445](https://github.com/Unson-LLC/vibepro/pull/445) fix: release履歴を追記型に修正

- Author: @sintariran
- Merged: 2026-08-08T01:06:40Z
- Commit: `5891a4cdb5fc1cb73cbd00ad3d510401a65aee1f`

### Change Summary

Version history now keeps published releases as an append-only ledger. This restores `0.2.0-beta.3`, corrects the `0.2.0-beta.4` summary, and validates bilingual history integrity before writing projected release documentation.

### Compatibility

No package or CLI compatibility change.

### User Action

No action required.

<!-- vibepro-release-pr:445:end -->

<!-- vibepro-release-pr:448:start -->
## [#448](https://github.com/Unson-LLC/vibepro/pull/448) fix: enforce immutable runtime identity

- Author: @sintariran
- Merged: 2026-08-10T16:12:18Z
- Commit: `5e19da4a890a6ae607241d40bbbb438dae6f5124`

### Change Summary

なし

### Compatibility

なし

### User Action

なし

<!-- vibepro-release-pr:448:end -->

<!-- vibepro-release-pr:450:start -->
## [#450](https://github.com/Unson-LLC/vibepro/pull/450) fix: PR準備成果物の不整合を修正

- Author: @sintariran
- Merged: 2026-08-11T10:12:36Z
- Commit: `a662da0d53d99399e21ffe1304be92fa790d619d`

### Change Summary

なし

### Compatibility

なし

### User Action

なし

<!-- vibepro-release-pr:450:end -->

<!-- vibepro-release-pr:451:start -->
## [#451](https://github.com/Unson-LLC/vibepro/pull/451) fix: GitHub Release分類を確実に収束

- Author: @sintariran
- Merged: 2026-08-11T11:48:10Z
- Commit: `4388cf10aa0a6cb6692fd79c00017a9824910979`

### Change Summary

なし

### Compatibility

なし

### User Action

なし

<!-- vibepro-release-pr:451:end -->

<!-- vibepro-release-pr:452:start -->
## [#452](https://github.com/Unson-LLC/vibepro/pull/452) chore: 0.2.0-beta.6を公開準備

- Author: @sintariran
- Merged: 2026-08-11T12:18:40Z
- Commit: `28775f0963d78aeba941145d50da8c4d96b1efd7`

### Change Summary

なし

### Compatibility

なし

### User Action

なし

<!-- vibepro-release-pr:452:end -->

<!-- vibepro-release-pr:453:start -->
## [#453](https://github.com/Unson-LLC/vibepro/pull/453) docs: リリース安全事例を公開

- Author: @sintariran
- Merged: 2026-08-11T13:50:05Z
- Commit: `50fcbd270e8d58930ab5940f408dab32077148fa`

### Change Summary

なし

### Compatibility

なし

### User Action

なし

<!-- vibepro-release-pr:453:end -->

<!-- vibepro-release-pr:456:start -->
## [#456](https://github.com/Unson-LLC/vibepro/pull/456) docs: 匿名化した実運用事例を追加

- Author: @sintariran
- Merged: 2026-08-12T00:19:51Z
- Commit: `67e5a9cc4c7e6d637d3f602d2f68e99f898487da`

### Change Summary

なし

### Compatibility

なし

### User Action

なし

<!-- vibepro-release-pr:456:end -->

<!-- vibepro-release-pr:455:start -->
## [#455](https://github.com/Unson-LLC/vibepro/pull/455) fix: accepted-specのHEAD系譜をPR成果物へ投影する

- Author: @sintariran
- Merged: 2026-08-12T00:42:24Z
- Commit: `c2e68b23a0da1708b323708a941aaf68837cd5b1`

### Change Summary

なし

### Compatibility

なし

### User Action

なし

<!-- vibepro-release-pr:455:end -->

<!-- vibepro-release-pr:457:start -->
## [#457](https://github.com/Unson-LLC/vibepro/pull/457) chore: 0.2.0-beta.7を公開準備

- Author: @sintariran
- Merged: 2026-08-12T01:36:11Z
- Commit: `a306c7789cece62ca46df85e40f39ca5c61a72a7`

### Change Summary

なし

### Compatibility

なし

### User Action

なし

<!-- vibepro-release-pr:457:end -->

<!-- vibepro-release-pr:459:start -->
## [#459](https://github.com/Unson-LLC/vibepro/pull/459) feat: VibePro npm公開Skillを追加する

- Author: @sintariran
- Merged: 2026-08-12T02:13:29Z
- Commit: `9b6f672d714818f128f80cc0b1d01fb579e35129`

### Change Summary

なし

### Compatibility

なし

### User Action

なし

<!-- vibepro-release-pr:459:end -->

<!-- vibepro-release-pr:461:start -->
## [#461](https://github.com/Unson-LLC/vibepro/pull/461) chore: 0.2.0-beta.8を公開準備

- Author: @sintariran
- Merged: 2026-08-12T04:04:47Z
- Commit: `b9e0a3493577b1fd86d6dc20694dcfcd85dfe1b1`

### Change Summary

Issue #458 と PR #460 のexact-SHA CI証拠再利用を含むmainを、vibepro 0.2.0-beta.8として公開します。リリースPR自体はversion metadataとStory・Spec・catalogだけを変更します。

### Compatibility

破壊的変更はありません。既存のbeta利用者は同じCLI契約のまま更新できます。

### User Action

必要に応じて npm install vibepro@0.2.0-beta.8 を実行してください。

<!-- vibepro-release-pr:461:end -->

<!-- vibepro-release-pr:465:start -->
## [#465](https://github.com/Unson-LLC/vibepro/pull/465) chore: 0.2.0-beta.9を公開準備

- Author: @sintariran
- Merged: 2026-08-15T00:18:54Z
- Commit: `6d5ef5e0d44123438890acbd714470ecb30e9e53`

### Change Summary

なし

### Compatibility

なし

### User Action

なし

<!-- vibepro-release-pr:465:end -->

<!-- vibepro-release-pr:473:start -->
## [#473](https://github.com/Unson-LLC/vibepro/pull/473) fix: バージョン据え置き時のマージ後処理を完了する

- Author: @sintariran
- Merged: 2026-08-17T03:46:56Z
- Commit: `aae2c85fa9e89c5cc7eb13224149a9cd547e4a31`

### Change Summary

なし

### Compatibility

なし

### User Action

なし

<!-- vibepro-release-pr:473:end -->

<!-- vibepro-release-pr:474:start -->
## [#474](https://github.com/Unson-LLC/vibepro/pull/474) fix: 旧形式Storyタスクを正規化する

- Author: @sintariran
- Merged: 2026-08-17T06:56:00Z
- Commit: `e9bb9c2e3309826dd09c72e737218f2c1e65a4c6`

### Change Summary

なし

### Compatibility

なし

### User Action

なし

<!-- vibepro-release-pr:474:end -->

<!-- vibepro-release-pr:475:start -->
## [#475](https://github.com/Unson-LLC/vibepro/pull/475) chore: 0.2.0-beta.10を公開準備

- Author: @sintariran
- Merged: 2026-08-17T07:00:04Z
- Commit: `92c1f79df53605eca6f262351c48df3531518b4a`

### Change Summary

なし

### Compatibility

なし

### User Action

なし

<!-- vibepro-release-pr:475:end -->

<!-- vibepro-release-pr:476:start -->
## [#476](https://github.com/Unson-LLC/vibepro/pull/476) docs: align VibePro with product intent traceability

- Author: @sintariran
- Merged: 2026-08-20T09:19:02Z
- Commit: `2cf9ce715d421edd8b8a68048ab6fa5599b0b2b1`

### Change Summary

なし

### Compatibility

なし

### User Action

なし

<!-- vibepro-release-pr:476:end -->

<!-- vibepro-release-pr:477:start -->
## [#477](https://github.com/Unson-LLC/vibepro/pull/477) feat: add minimal Development Judgment DAG

- Author: @sintariran
- Merged: 2026-08-20T09:19:43Z
- Commit: `373348fdde8ebbb460b68ba313666b7669ece830`

### Change Summary

なし

### Compatibility

なし

### User Action

なし

<!-- vibepro-release-pr:477:end -->

<!-- vibepro-release-pr:478:start -->
## [#478](https://github.com/Unson-LLC/vibepro/pull/478) 公開説明文の意図を保ったまま、旧文言に固定されたCI契約を修復する

- Author: @sintariran
- Merged: 2026-08-20T15:33:12Z
- Commit: `e1b9d7a5d4982b009924c778efac2c074e891198`

### Change Summary

なし

### Compatibility

なし

### User Action

なし

<!-- vibepro-release-pr:478:end -->

<!-- vibepro-release-pr:479:start -->
## [#479](https://github.com/Unson-LLC/vibepro/pull/479) fix: block PR creation until agent reviews complete

- Author: @sintariran
- Merged: 2026-08-21T11:38:27Z
- Commit: `598c4c3c13b36ea96900afca182124aa61232ff8`

### Change Summary

なし

### Compatibility

なし

### User Action

なし

<!-- vibepro-release-pr:479:end -->

<!-- vibepro-release-pr:480:start -->
## [#480](https://github.com/Unson-LLC/vibepro/pull/480) chore: 0.2.0-beta.11を公開準備

- Author: @sintariran
- Merged: 2026-08-21T11:47:49Z
- Commit: `65ad94c68250405438bdeb22b8940952d2b3b0ea`

### Change Summary

なし

### Compatibility

なし

### User Action

なし

<!-- vibepro-release-pr:480:end -->

<!-- vibepro-release-pr:481:start -->
## [#481](https://github.com/Unson-LLC/vibepro/pull/481) feat: connect Development Judgment to the delivery workflow

- Author: @sintariran
- Merged: 2026-08-22T01:15:19Z
- Commit: `fc17b4afafd233cc76ebd00bfc45a010fa1986c5`

### Change Summary

なし

### Compatibility

なし

### User Action

なし

<!-- vibepro-release-pr:481:end -->

<!-- vibepro-release-pr:482:start -->
## [#482](https://github.com/Unson-LLC/vibepro/pull/482) chore: 0.2.0-beta.12を公開準備

- Author: @sintariran
- Merged: 2026-08-22T04:47:16Z
- Commit: `cec99e07e77c863cb09965e691067252553c5ef7`

### Change Summary

なし

### Compatibility

なし

### User Action

なし

<!-- vibepro-release-pr:482:end -->

<!-- vibepro-release-pr:483:start -->
## [#483](https://github.com/Unson-LLC/vibepro/pull/483) feat: complete Development Judgment operating loop

- Author: @sintariran
- Merged: 2026-08-23T12:34:54Z
- Commit: `ed89f5683870dedd53244d1f6f81a3eeeba38dd7`

### Change Summary

なし

### Compatibility

なし

### User Action

なし

<!-- vibepro-release-pr:483:end -->

<!-- vibepro-release-pr:484:start -->
## [#484](https://github.com/Unson-LLC/vibepro/pull/484) chore: release 0.2.0-beta.13

- Author: @sintariran
- Merged: 2026-08-23T12:41:22Z
- Commit: `66a87a14992cee1559f3c4d5b56554e200ec2492`

### Change Summary

なし

### Compatibility

なし

### User Action

なし

<!-- vibepro-release-pr:484:end -->

<!-- vibepro-release-pr:486:start -->
## [#486](https://github.com/Unson-LLC/vibepro/pull/486) feat: add causal Review DAG freshness and progress-sensitive convergence

- Author: @sintariran
- Merged: 2026-08-24T01:21:06Z
- Commit: `b0d57d944fa9806cc517c83c6cf9620779bdec15`

### Change Summary

なし

### Compatibility

なし

### User Action

なし

<!-- vibepro-release-pr:486:end -->

<!-- vibepro-release-pr:488:start -->
## [#488](https://github.com/Unson-LLC/vibepro/pull/488) chore: release 0.2.0-beta.14

- Author: @sintariran
- Merged: 2026-08-24T04:00:45Z
- Commit: `fb35ee06d9a91b1bab7d7dab0584deb62a3b2086`

### Change Summary

なし

### Compatibility

なし

### User Action

なし

<!-- vibepro-release-pr:488:end -->

<!-- vibepro-release-pr:489:start -->
## [#489](https://github.com/Unson-LLC/vibepro/pull/489) fix: 非マルチテナント適用判定と実装証拠を分離する

- Author: @sintariran
- Merged: 2026-08-24T14:53:38Z
- Commit: `877dd461695edb52e138a811078551705799d433`

### Change Summary

なし

### Compatibility

なし

### User Action

なし

<!-- vibepro-release-pr:489:end -->

<!-- vibepro-release-pr:490:start -->
## [#490](https://github.com/Unson-LLC/vibepro/pull/490) chore: release 0.2.0-beta.15

- Author: @sintariran
- Merged: 2026-08-24T16:05:23Z
- Commit: `a1c4e9a593d03cc9bfbc94584b8bc64734a002fa`

### Change Summary

なし

### Compatibility

なし

### User Action

なし

<!-- vibepro-release-pr:490:end -->

<!-- vibepro-release-pr:491:start -->
## [#491](https://github.com/Unson-LLC/vibepro/pull/491) fix: project safe agent review instructions

- Author: @sintariran
- Merged: 2026-08-24T17:08:53Z
- Commit: `e9385b9846932a37456d62cf85f5ed6092eeec91`

### Change Summary

なし

### Compatibility

なし

### User Action

なし

<!-- vibepro-release-pr:491:end -->

<!-- vibepro-release-pr:492:start -->
## [#492](https://github.com/Unson-LLC/vibepro/pull/492) fix: bind PR readiness to canonical Story Tasks

- Author: @sintariran
- Merged: 2026-08-24T17:38:16Z
- Commit: `495b7fbc2724bd13c3f9d82c80b916dd4dd782e8`

### Change Summary

なし

### Compatibility

なし

### User Action

なし

<!-- vibepro-release-pr:492:end -->

<!-- vibepro-release-pr:494:start -->
## [#494](https://github.com/Unson-LLC/vibepro/pull/494) fix: Judgmentを通常計画フローへ接続

- Author: @sintariran
- Merged: 2026-08-25T09:51:26Z
- Commit: `feb4426600ddb48ec91fdd0bbbb47eca18915601`

### Change Summary

なし

### Compatibility

なし

### User Action

なし

<!-- vibepro-release-pr:494:end -->

<!-- vibepro-release-pr:493:start -->
## [#493](https://github.com/Unson-LLC/vibepro/pull/493) chore: prepare 0.2.0-beta.16 release

- Author: @sintariran
- Merged: 2026-08-25T12:43:06Z
- Commit: `8b9fd24b6614f8d55b4e6c42d1179a68e6f92f85`

### Change Summary

なし

### Compatibility

なし

### User Action

なし

<!-- vibepro-release-pr:493:end -->

<!-- vibepro-release-pr:495:start -->
## [#495](https://github.com/Unson-LLC/vibepro/pull/495) fix: make verification progress deadline test deterministic

- Author: @sintariran
- Merged: 2026-08-25T14:10:27Z
- Commit: `58de3ec992c4ef4aeb16317a534d1926aa4dee4d`

### Change Summary

なし

### Compatibility

なし

### User Action

なし

<!-- vibepro-release-pr:495:end -->

<!-- vibepro-release-pr:499:start -->
## [#499](https://github.com/Unson-LLC/vibepro/pull/499) fix: subagent回復ループを3回で収束させる

- Author: @sintariran
- Merged: 2026-08-28T15:22:17Z
- Commit: `026b26885a32960f7f2c21112f5a5e804999505d`

### Change Summary

なし

### Compatibility

なし

### User Action

なし

<!-- vibepro-release-pr:499:end -->

<!-- vibepro-release-pr:500:start -->
## [#500](https://github.com/Unson-LLC/vibepro/pull/500) fix: stop evidence loops with the minimal-core workflow

- Author: @sintariran
- Merged: 2026-08-30T02:25:13Z
- Commit: `ca32dc1ae1a54f5a2beff1eef9d50dbde27cded9`

### Change Summary

なし

### Compatibility

なし

### User Action

なし

<!-- vibepro-release-pr:500:end -->

<!-- vibepro-release-pr:502:start -->
## [#502](https://github.com/Unson-LLC/vibepro/pull/502) chore: prepare 0.2.0-beta.17 release

- Author: @sintariran
- Merged: 2026-08-30T02:42:48Z
- Commit: `1c3bebb6824d79c8e49ef66c9271c61c35c7cd29`

### Change Summary

なし

### Compatibility

なし

### User Action

なし

<!-- vibepro-release-pr:502:end -->

<!-- vibepro-release-pr:503:start -->
## [#503](https://github.com/Unson-LLC/vibepro/pull/503) fix: Minimal Core契約をCodex配布面まで収束させる

- Author: @sintariran
- Merged: 2026-08-30T14:32:58Z
- Commit: `afc13d90d296fbc358e21fb327753ba364468279`

### Change Summary

なし

### Compatibility

なし

### User Action

なし

<!-- vibepro-release-pr:503:end -->

<!-- vibepro-release-pr:504:start -->
## [#504](https://github.com/Unson-LLC/vibepro/pull/504) feat: bind Brainbase runtime context and emit verified learning

- Author: @sintariran
- Merged: 2026-08-30T23:46:16Z
- Commit: `ba100550ebab0cec5f3804b471a09bc46610b896`

### Change Summary

なし

### Compatibility

なし

### User Action

なし

<!-- vibepro-release-pr:504:end -->

<!-- vibepro-release-pr:505:start -->
## [#505](https://github.com/Unson-LLC/vibepro/pull/505) chore: release VibePro 0.2.0-beta.18

- Author: @sintariran
- Merged: 2026-08-31T02:29:30Z
- Commit: `2ff03db8045bceee47d3dad3da10695103ce91a1`

### Change Summary

なし

### Compatibility

なし

### User Action

なし

<!-- vibepro-release-pr:505:end -->
