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

## When to Use

Use this Skill when a repository uses VibePro to connect a Story, Spec, implementation, verification, review, or PR. Also use it when deciding whether VibePro-managed evidence is current, sufficient, or blocking delivery.

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
  "external_side_effects": {
    "read_before_write": true,
    "required_retry_context": [
      "previous_run_id",
      "first_failure_boundary",
      "error_code",
      "observable_delta",
      "retry_hypothesis",
      "terminal_receipt_target"
    ],
    "retry_requires_observable_delta": true,
    "mutation_budget": 3,
    "no_progress_limit": 3,
    "semantic_progress_fields": [
      "first_failure_boundary",
      "error_code",
      "observable_delta",
      "retry_hypothesis",
      "terminal_receipt"
    ],
    "at_no_progress_limit": "root_cause_summary_or_block",
    "progress_states": [
      "accepted",
      "processing",
      "delivered",
      "verified-complete"
    ],
    "non_terminal_states": [
      "accepted",
      "processing",
      "delivered"
    ],
    "completion_state": "verified-complete",
    "scope_expansion": {
      "requires_first_failure_boundary": true,
      "when_boundary_unknown": [
        "record_expansion_rationale",
        "carry_forward_unidentified_boundary"
      ]
    },
    "enforcement_mode": "instruction_contract",
    "host_runtime_boundary": "host_enforces_external_mutation_stop",
    "unsupported_host_action": "block_mutation_and_open_upstream_issue"
  },
  "blocking_finding_action": "fix_then_reverify_affected_surface",
  "non_blocking_finding_action": "follow_up_story",
  "review_runtime_failure_action": "report_runtime_failure_without_product_finding",
  "legacy_gate_projection": "informational_only",
  "pr_command": "gh pr create"
}
```
<!-- minimal-core-convergence-policy:end -->

## Workflow

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

### 3. Run the Development Judgment loop (advisory)

After Story diagnosis and before `vibepro story plan`, run the Development Judgment loop. It is ADVISORY: it never changes PR readiness, merge, or release authority. `not_applicable`, missing, or unactionable Judgment must not block planning or the PR.

**Applicability criterion** (answer this question, not the multi-tenant or authority question):

- `--applicable yes` when an engineering choice is still open for this Story: two or more viable delivery options (build / fix / delete / consolidate / redesign / retire / measure / experiment), an unverified problem or effect claim, or a structural addition whose value has not been observed. In other words, a VALUE / SIMPLIFY / VALIDATE decision remains to be made.
- `--applicable no` only when the implementation is fully determined by an already adopted decision (Story, Architecture, Spec, or plan fixes the single option) and no such choice remains. State which decision fixed it in `--reason`.
- Tenant boundaries, authority, security scope, or "organizational judgment" are NOT this criterion; they belong to the multi-tenant applicability check. Do not default to `no`.

1. Record applicability with a reason — non-applicability is an explicit recorded state, not a silent skip:
   ```bash
   vibepro judgment applicability record [repo] --id <story-id> --applicable <yes|no> --reason <text>
   ```
2. If applicable, prepare a conservative draft input, then have a human or delegated agent review and adopt it with provenance before it can be evaluated:
   ```bash
   vibepro judgment prepare [repo] --id <story-id>
   vibepro judgment input adopt [repo] --id <story-id> --input <input.json> --reviewed-by <actor> --authority <source> --summary <text>
   ```
3. Evaluate the adopted input into the Development Judgment DAG:
   ```bash
   vibepro judgment evaluate [repo] --id <story-id> --input <adopted-input.json>
   ```
   Use `vibepro judgment status [repo] --id <story-id>` at any point to see the current lifecycle state and next action.

Actionable Judgment may inform the plan; `story plan` also accepts the combined `--judgment-*` flags to run applicability, adoption, and evaluation inline. Either form is acceptable.

After `vibepro story plan`, record the disposition — what the human decided and what effect it had on the plan, still advisory only:

```bash
vibepro judgment disposition record [repo] --id <story-id> --run <run-id> --human-decision <accepted|modified|rejected> --effect <changed_plan|changed_review_focus|escalated_to_human|no_effect> --summary <text>
```

### 4. Implement the smallest coherent change

Use TDD for bug fixes when practical:

1. reproduce the accepted failure,
2. add the smallest failing test,
3. implement the smallest fix,
4. run the affected tests.

Do not expand the Story to repair every issue found during inspection.

### 5. Verify only what changed

During development, run affected tests only.

Use this dependency rule:

- implementation changed → rerun tests covering that implementation,
- test fixture changed → rerun the tests consuming that fixture,
- executable public contract changed → rerun the contract tests,
- documentation wording changed → do not rerun runtime E2E unless the documentation is executable input,
- CI or release configuration changed → run the relevant configuration or release checks.

The full suite belongs in CI unless the user explicitly requests a local release rehearsal or the change can only be proven locally.

Evidence is bound to the content it tested. A new commit SHA alone does not invalidate an unrelated test or review.

### 6. Run one review wave

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

### 7. Use deterministic E2E

E2E inputs must be fixed fixtures: exact tool name, exact arguments, exact expected result shape, and exact evidence path. Do not ask an agent to recreate the test protocol from prose on every run.

Use one real fresh-task smoke test only when the change affects an agent host, hook, process boundary, authentication path, deployment, or another runtime integration that a deterministic test cannot fully simulate.

Do not recreate fresh tasks until one happens to match. A mismatch in test instructions is a test-harness defect, not a product regression.

### 8. Prepare and open the PR

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

After merge, or once real observation exists, close the loop by recording the Outcome. This feeds the next `judgment prepare` run and remains advisory — it never reopens or blocks the merged PR:

```bash
vibepro judgment outcome record [repo] --id <story-id> --run <run-id> --status <confirmed|mixed|falsified|unknown> --summary <text>
```

Use `vibepro judgment pending [repo]` to find Stories with a disposition recorded but no Outcome yet.

### 9. Bound external side effects

When diagnosis or recovery can create an external side effect, define its `success_contract`, `first_failure_boundary`, `terminal_receipt`, and `mutation_budget` before retrying it. An upload, enqueue, or API acceptance is not completion. Report the observed state separately as `accepted`, `processing`, `delivered`, or `verified-complete`; only the last state, backed by the declared terminal receipt, completes the task.

Read the previous run before writing again. Every retry must carry the previous run ID, first failing stage and error code, an observable code/configuration/credential delta, the hypothesis connecting that delta to the failure, and the terminal receipt to inspect. If the previous run cannot be read, report that missing observability as a blocker instead of guessing that another mutation will help.

Tool success is not semantic progress. Progress exists only when at least one declared semantic field changes: the first failure boundary, error code, observable delta, supported or rejected hypothesis, or terminal receipt. Apply at most three mutations for one artifact and operation. If the same boundary and error persist without semantic progress three times, do not perform a fourth mutation. Carry forward the known facts, rejected hypotheses, unidentified boundary, and next smallest read-only probe, then produce a root-cause summary or explicit block.

Identify the first failure boundary before expanding across hosts, deployments, credentials, or networks. If that boundary cannot be identified, record why the additional surface is necessary and carry the unidentified boundary forward. Terms such as “after synchronization”, “aligned”, or “recovered” require evidence for that claimed state.

VibePro publishes an instruction contract but does not own or intercept external execution. The Codex/Claude host or adapter that can perform the side effect must enforce the stop decision. When the host cannot enforce it, do not execute the mutation: state that capability boundary, block locally, and open an upstream host issue. Do not claim runtime prevention from this Skill alone, and do not weaken the local completion or retry criteria.

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
- run `vibepro execute start`; the execution orchestrator is retired,
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
- 同一artifact・operationでsemantic progressなしの外部mutationを4回目まで実行しようとしている。
- uploadやAPI受付だけを`verified-complete`として報告しようとしている。

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
