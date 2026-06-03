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
  invalid signature returns 400 without DB write"). Derive scenario clauses
  from Story acceptance criteria plus Architecture / IA / route-flow / state /
  boundary evidence when available.
- `contract` — an interface obligation (e.g., "`GET /api/foo` returns 200 with
  shape X").
- `sla` — a measurable bound (e.g., "p95 of /api/foo < 200ms").

## Rules

1. **One statement per clause.** Split compound sentences.
2. **Every clause must cite at least one origin.** `origin.story_refs[]`,
   `origin.architecture_refs[]`, `origin.code_refs[]`, or
   `origin.test_refs[]` must be non-empty.
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
        "architecture_refs": [],
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

## Design diagrams (MUST-HAVE, change-type-triggered)

Some change types make a design diagram mandatory. VibePro detects the trigger
and the `gate:design_diagrams` Gate blocks PR creation until the listed kinds
are present in `diagrams[]`. The 8 kinds are:

| kind | trigger | mermaid prefix |
|---|---|---|
| `er` | DB schema diff (`prisma/schema.prisma`, `db/migrations/**`, `*.sql` with CREATE/ALTER TABLE) | `erDiagram` |
| `state` | `status`/`state` enum or column, `xstate` / `state-machine` / `workflow` paths | `stateDiagram-v2` / `stateDiagram` |
| `sequence` | webhook route, queue/topic dep, 3rd party SDK (stripe/twilio/etc.) | `sequenceDiagram` |
| `flow` | multi-step user workflow (Story.AC >= 3 with checkout/onboarding/wizard keyword, or `**/checkout/**` path) | `flowchart` / `graph` |
| `c4_context` | new package boundary (`packages/<new>/package.json`), new `services/<new>/` | `C4Context` / `C4Container` |
| `deployment` | IaC diff (`*.tf`, `infra/**`, `pulumi/**`), `fly.toml`/`vercel.json`/`serverless.yml`, k8s manifest | `flowchart` / `graph` / `C4Deployment` |
| `threat_model` | auth/authz/PII/payment paths or deps (bcrypt/argon2/jose/stripe), PII column hints (email/phone/ssn/payment) | `flowchart` / `graph` |
| `dfd` | async pipeline (cron paths, stream deps: kafkajs/inngest/temporal, etl/pipeline/ingest paths) | `flowchart` / `graph` |

For `er`, `state`, `sequence`, `c4_context`, the `entities[]` field is **required and non-empty**.
Names in `entities[]` should also appear in at least one clause statement or rationale
(otherwise the validator emits a `diagram_entity_clause_mismatch` warning).

Example diagrams[] entry:

```jsonc
"diagrams": [
  {
    "kind": "er",
    "mermaid": "erDiagram\n  USER ||--o{ SUBSCRIPTION : has\n  SUBSCRIPTION { string id PK; int userType; string status }",
    "entities": ["USER", "SUBSCRIPTION"],
    "rationale": "schema diff at prisma/schema.prisma touches User and Subscription"
  }
]
```

If no trigger fires, omit `diagrams[]` entirely. Do not add a diagram just because
it might be nice — only the triggered MUST-HAVE kinds should be present.

## BDD-style scenario guidance

VibePro does not require an external BDD runner. Do not output free-form Gherkin
documents. Use `type: "scenario"` clauses as the machine-checkable BDD surface.

For each scenario clause:

- Include one concrete user/system state, one action/event, and one expected
  result in `statement`.
- Prefer Story acceptance criteria as the primary origin.
- Add `origin.architecture_refs[]` when Architecture / IA / route-flow / state /
  boundary docs explain the path.
- If the Story and Architecture imply a path but the expected result is
  ambiguous, add a blocker `open_questions[]` item instead of inventing behavior.
- Make the clause easy to connect to tests by keeping stable `S-<n>` ids.

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
- **Turning IA into Spec.** IA and route-flow evidence explain structure and
  navigation. The Spec clause must still state verifiable behavior.
