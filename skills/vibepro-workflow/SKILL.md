---
name: vibepro-workflow
description: Use when a repository uses VibePro for Story, Spec, verification, review, or PR evidence. Enforces the minimal-core workflow and prevents evidence/review loops.
---

# VibePro Minimal-Core Workflow

## Authority

`AGENTS.md` and `docs/management/REBUILD.md` are the authority for this Skill.

VibePro is a small development aid. It exists to keep these four things connected:

1. what the user asked for,
2. what was designed,
3. what changed,
4. what was verified.

It is not a workflow engine, a merge authority, or an evidence-collection game. Removed mechanisms must not be rebuilt through agent instructions.

The standard development loop is:

> Story → Spec → implement → affected tests → one review wave → GitHub PR → CI → merge

For the VibePro repository itself, always use the ordinary GitHub flow: branch, test, `gh pr create`, review, merge.

## Completion Definition

Work is complete when all of the following are true:

- the accepted Story scope is implemented,
- the acceptance criteria directly affected by the change are verified,
- no unresolved finding can break the accepted scope, security boundary, data integrity, or rollback safety,
- a PR exists and CI is green,
- any useful but out-of-scope finding has been moved to a follow-up Story instead of being absorbed into the current Story.

More evidence is not progress by itself. A new artifact, review, or test run counts as progress only when it reduces a concrete unresolved risk.

## Machine-Tested Convergence Contract

<!-- minimal-core-convergence-policy:start -->
```json
{
  "schema_version": "1.0",
  "workflow": [
    "story",
    "spec",
    "implement",
    "affected_tests",
    "single_review_wave",
    "github_pr",
    "ci",
    "merge"
  ],
  "review_waves": 1,
  "max_parallel_review_roles": 3,
  "max_total_review_dispatches": 5,
  "verification_scope_during_development": "affected_tests",
  "full_suite_location": "ci",
  "exact_head_scope": [
    "ci",
    "release_readback"
  ],
  "e2e": {
    "deterministic_fixture_required": true,
    "fresh_task_smoke_max": 1
  },
  "blocking_finding_action": "fix_then_reverify_affected_surface",
  "non_blocking_finding_action": "follow_up_story",
  "review_runtime_failure_action": "report_runtime_failure_without_product_finding",
  "legacy_gate_projection": "informational_only",
  "pr_command": "gh pr create"
}
```
<!-- minimal-core-convergence-policy:end -->

## Operating Flow

### 1. Establish the accepted scope

Read the repository instructions and identify one Story. Write or update only the minimum Story and Spec needed to make the requested outcome testable.

Before implementation, state:

- the user-visible outcome,
- the acceptance criteria that prove it,
- the files or runtime surfaces expected to change,
- what is explicitly outside the Story.

Do not add a newly discovered improvement to the current Story merely because it is nearby.

### 2. Inspect the relevant code

Inspect the implementation path, tests, public contract, and deployment boundary that can actually affect the accepted scope. Use Graphify or codebase-memory only when it changes the implementation or test decision. Do not generate broad artifacts by default.

### 3. Implement the smallest coherent change

Use TDD for bug fixes when practical:

1. reproduce the accepted failure,
2. add the smallest failing test,
3. implement the smallest fix,
4. run the affected tests.

Do not expand the Story to repair every issue found during inspection.

### 4. Verify only what changed

During development, run affected tests only.

Use this dependency rule:

- implementation changed → rerun tests covering that implementation,
- test fixture changed → rerun the tests consuming that fixture,
- executable public contract changed → rerun the contract tests,
- documentation wording changed → do not rerun runtime E2E unless the documentation is executable input,
- CI or release configuration changed → run the relevant configuration or release checks.

The full suite belongs in CI unless the user explicitly requests a local release rehearsal or the change can only be proven locally.

Evidence is bound to the content it tested. A new commit SHA alone does not invalidate an unrelated test or review.

### 5. Run one review wave

After the implementation and affected tests are stable, run at most one review wave. Use no more than three independent roles in parallel. Good default lenses are:

- user value and acceptance criteria,
- architecture and safety boundary,
- test and regression coverage.

Classify every finding immediately:

#### Blocking

A finding is blocking only when it directly demonstrates one of these:

- an acceptance criterion is not met,
- a security or tenant boundary can be violated,
- data can be corrupted or lost,
- the changed release or rollback path cannot complete safely,
- CI cannot validate the change.

Fix the blocker, rerun only the affected tests, and ask only the reviewer whose conclusion was changed to confirm the delta. This is not a new review wave.

#### Follow-up

Everything else is a follow-up finding. Record it in a separate Story or issue and continue the current PR. Examples include unrelated cleanup, broader architecture improvements, additional documentation polish, and risks that existed before the current Story and are not worsened by it.

A review runtime timeout, empty response, or wrong request is a review-system failure. It must not be converted into a product defect. Report it once and continue with direct verification or an explicit human review.

If total review dispatches reach five, stop dispatching. Treat the review process itself as defective, record a follow-up, and decide the current PR only from the accepted scope, tests, and concrete unresolved blockers.

### 6. Use deterministic E2E

E2E inputs must be fixed fixtures: exact tool name, exact arguments, exact expected result shape, and exact evidence path. Do not ask an agent to recreate the test protocol from prose on every run.

Use one real fresh-task smoke test only when the change affects an agent host, hook, process boundary, authentication path, deployment, or another runtime integration that a deterministic test cannot fully simulate.

Do not recreate fresh tasks until one happens to match. A mismatch in test instructions is a test-harness defect, not a product regression.

### 7. Prepare and open the PR

`vibepro pr prepare` may be used to generate a concise Story, Spec, verification, and review summary. Treat any legacy Gate status, stale-review projection, next-review command, or lifecycle count in that output as informational only. It must not create additional work or block the PR.

Open or refresh the PR with the repository's normal GitHub command. For VibePro itself:

```bash
gh pr create
```

After the PR exists:

1. let CI run the full suite,
2. fix only real failures caused by the diff,
3. obtain the normal repository review,
4. merge when CI and the concrete blockers are clear.

Do not import CI evidence and then restart the local review workflow.

## Forbidden Workflow Patterns

Do not:

- restart every review stage because HEAD changed,
- require exact-HEAD evidence during normal implementation,
- require all configured review stages to pass before opening a PR,
- use review lifecycle authorization, start, close, repair, or budget accounting,
- create replacement reviewers for the same role after a timeout,
- rerun the full local suite after a documentation-only change,
- regenerate Story, Spec, Architecture, Task, Gate, and E2E artifacts after every fix,
- keep a Story open to absorb newly discovered non-blocking work,
- treat generated audit artifacts as release authority,
- use VibePro-managed merge or execution machinery.

## Dirty Worktree Safety

Do not stash, reset, restore, or overwrite a dirty worktree before classifying it. Protect unrelated user changes. Prefer a clean feature branch or isolated worktree. Only files inside the accepted scope may enter the PR.

## Common Rationalizations

- “HEADが変わったので全部やり直す” — changed contentだけを再検証する。
- “レビューで見つけたので同じStoryへ入れる” — blocking条件を満たさなければfollow-upへ送る。
- “証跡が多いほど安全” — 未解決リスクを減らさない証跡は作業ではない。
- “fresh taskをもう一度作れば通る” — 入力が揺れるならtest harnessを固定する。
- “旧Gateがneeds_reviewなのでPRを作れない” — 旧Gate投影は参考情報であり、実ブロッカーではない。

## Red Flags

次のいずれかが起きたら、製品開発ではなくVibePro運用がループしている。

- 同じStoryでreview dispatchが5回を超えた。
- 文書だけの変更でruntime E2Eを再実行しようとしている。
- exact HEADだけを理由に、内容が変わっていないテストやレビューを失効させた。
- review runtimeのtimeoutや誤入力を製品不具合として数えた。
- 受入条件と無関係なfindingを現在のStoryへ追加した。
- PR作成前に複数段階のGateを再開しようとしている。

この場合はdispatchを止め、受入範囲・影響テスト・具体的なblocking findingだけで現在のPRを判断する。

## Verification

完了報告には次だけを含める。

1. 受入条件に対して何を直したか。
2. 変更内容を直接覆うテストと結果。
3. 未解決の具体的blocker。
4. PRとCIの状態。
5. follow-upへ分離したfinding。

次を完了証拠として数えない。

- review件数、
- 同じテストの反復回数、
- repeated exact HEAD、
- generated artifactの総量。

## Reporting

Report outcomes, not ceremony:

- what user-visible problem was fixed,
- which files changed,
- which affected tests passed,
- which concrete blockers remain,
- PR URL and CI state,
- follow-up Stories created for out-of-scope findings.

Do not present review counts, repeated exact HEADs, or artifact volume as the primary measure of progress.
