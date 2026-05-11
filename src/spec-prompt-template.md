# VibePro Spec authoring instructions (for the calling AI)

You are receiving a JSON payload from `vibepro spec fingerprint`. Your job is to
emit an updated `spec.json` and pipe it back into `vibepro spec write --from-stdin`.

VibePro will validate your output against `schema_for_your_output`. If any
clause fails validation, VibePro returns a `validation_report.errors[]` and you
must regenerate only the failing clauses.

## What a clause is

A clause is a single machine-checkable statement about the system. Four types:

- `invariant` — a property that must hold always (e.g., "premium user keeps
  `userType=2` until `current_period_end`").
- `scenario` — a concrete given/when/then path (e.g., "Stripe webhook with
  invalid signature returns 400 without DB write").
- `contract` — an interface obligation (e.g., "`GET /api/foo` returns 200 with
  shape X").
- `sla` — a measurable bound (e.g., "p95 of /api/foo < 200ms").

## Rules

1. **One statement per clause.** Split compound sentences.
2. **Every clause must cite at least one origin.** `origin.story_refs[]`,
   `origin.code_refs[]`, or `origin.test_refs[]` must be non-empty.
3. **`code_refs[].file` must be a real path** in the repo (relative to repo
   root). `code_refs[].anchor` must be a substring grep-findable in that file.
4. **`verifiable_by` patterns must actually match** when run by the validator.
   Prefer narrow `file_glob` and specific `must_contain` / `must_not_contain` /
   `must_cover`. Do not use overly generic globs like `src/**/*`.
5. **Reuse clause ids when possible.** If `previous_spec` contains a clause
   whose statement is semantically equivalent, copy its `id`. Otherwise use
   `INV-NEW-<n>` / `S-NEW-<n>` etc. — the validator will assign stable ids.
6. **No prose blocks, no markdown.** Output strict JSON only.
7. **Use `open_questions[]`** when Story / Code / Test conflict or the spec
   cannot be determined. Do not invent clauses to paper over ambiguity.

## Output format

```jsonc
{
  "schema_version": "0.1.0",
  "story_id": "<copy from fingerprint.story_id>",
  "generated_by": { "caller": "<your name, e.g. claude-code>", "stage": "ai_synthesis" },
  "clauses": [
    {
      "id": "INV-NEW-1",
      "type": "invariant",
      "statement": "Premium ユーザーは current_period_end まで userType=2 を保持する",
      "rationale": "Story acceptance_criteria[2] と src/billing.ts:142 cancelAtPeriodEnd 分岐から",
      "origin": {
        "story_refs": [{ "kind": "acceptance_criteria", "index": 2 }],
        "code_refs": [{ "file": "src/billing.ts", "anchor": "cancelAtPeriodEnd" }],
        "test_refs": []
      },
      "confidence": 0.9,
      "verifiable_by": {
        "code_pattern": [
          { "file_glob": "src/**/billing*.ts",
            "must_not_contain": "userType: 1, cancelAtPeriodEnd: true" }
        ],
        "test_pattern": [
          { "file_glob": "test/**/billing*.{test,spec}.{js,ts}",
            "must_cover": "cancelAtPeriodEnd" }
        ]
      }
    }
  ],
  "open_questions": []
}
```

## What VibePro does with your output

- Runs JSON schema validation.
- Verifies every `code_refs[].file` exists and `anchor` is grep-findable.
- Runs each `verifiable_by.code_pattern` / `test_pattern` against the actual
  repo. If `must_contain` / `must_not_contain` / `must_cover` fails to match
  as declared, the clause is rejected.
- Assigns stable clause ids by comparing your `statement` text to the previous
  spec (text similarity > 0.7 → preserve id; first_seen_at preserved).
- Writes `.vibepro/spec/<story-id>/spec.json` and rotates history.
- Optionally runs `vibepro spec drift` to detect Spec↔Code↔Test↔PR
  inconsistencies. Drift items are surfaced via Gate DAG and PR body.

## Common mistakes

- **Citing a file that does not exist.** Always use the actual paths from
  `code_fingerprint.branches[].file` or grep the repo first.
- **Vague statements.** "The system should be secure" is not a clause. Be
  specific: "Stripe webhook signatures must be verified before any DB write."
- **Patterns that don't match anything.** Test your `file_glob` mentally —
  does `src/**/*.ts` actually contain a file that matches `must_contain`?
- **Trying to author Story.** You are not editing Story. Story is the input.
  Treat NocoDB Story acceptance criteria as immutable for this session.
