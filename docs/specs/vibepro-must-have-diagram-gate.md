---
title: "VibePro MUST-HAVE Design Diagram Gate Spec"
status: draft
created_at: 2026-05-29
updated_at: 2026-05-29
related_architecture:
  - ../architecture/vibepro-must-have-diagram-gate.md
related_stories:
  - story-vibepro-must-have-diagram-gate
---

# VibePro MUST-HAVE Design Diagram Gate Spec

## Diagram Kinds (machine-checkable enum)

```
"er" | "state" | "sequence" | "flow" | "c4_context" | "deployment" | "threat_model" | "dfd"
```

## Trigger Detection Rules

Each rule is a pure function over `{ story, code_diff }`. Order of evaluation does not matter; rules are independent.

### Rule R1: ER required when schema changes

- Detect `code_diff.files[].path` matching any of:
  - `prisma/schema.prisma`
  - `db/migrations/**`
  - `migrations/**/*.sql`
  - `**/*.sql` containing `CREATE TABLE` or `ALTER TABLE` (content scan)
- → require `er`

### Rule R2: State machine required for status / state changes

- Detect either:
  - file in `code_diff.files[]` that contains `enum.*[sS]tatus` or `enum.*[sS]tate`
  - new column named `status` / `state` in schema diff
  - file path matches `**/*xstate*` / `**/*workflow*` / `**/*state-machine*`
- → require `state`

### Rule R3: Sequence required for inter-actor messaging

- Detect any of:
  - new route under `**/webhook**` or `**/webhooks/**`
  - new queue / topic / pubsub usage (deps: `bullmq`, `bull`, `kafkajs`, `@aws-sdk/client-sqs`, `nats`)
  - new 3rd party SDK dep (heuristic: dep name starts with provider prefix `stripe`, `twilio`, `sendgrid`, `slack`, `@google-cloud/`, `@aws-sdk/`)
- → require `sequence`

### Rule R4: Flow required for multi-step user workflows

- Detect any of:
  - `story.ac_count >= 3` AND `story.ac_keywords` includes any of: `checkout`, `onboarding`, `wizard`, `multi-step`, `flow`, `purchase`, `signup`
  - file path matches `**/checkout/**` / `**/onboarding/**` / `**/wizard/**`
- → require `flow`

### Rule R5: C4 Context required for service / boundary changes

- Detect either:
  - new file at `packages/<name>/package.json` with `status: "added"` (monorepo new package boundary)
  - any new file with `status: "added"` under `services/<name>/` (new service directory)
- → require `c4_context`

Note: "new top-level directory under src/" and "new external system import" are
out of scope for v1 because they require either snapshot diffing of the directory
tree or dep-import classification, which the current resolver does not have. The
sequence rule (R3) covers external SDK additions via the deps_added stream.

### Rule R6: Deployment required for IaC changes

- Detect any of:
  - file paths matching `**/*.tf`, `**/*.tfvars`, `infra/**`, `pulumi/**`, `terraform/**`
  - k8s manifest changes: `**/*.yaml` / `**/*.yml` with `kind: Deployment|StatefulSet|Service|Ingress`
  - deploy config files: `fly.toml`, `vercel.json`, `serverless.yml`, `wrangler.toml`
- → require `deployment`

### Rule R7: Threat model required for security-sensitive changes

- Detect any of:
  - file paths containing `auth`, `login`, `oauth`, `session`, `jwt`, `password`, `permission`, `policy`, `acl`, `rbac`
  - schema diff containing PII column hints: `email`, `phone`, `ssn`, `tax_id`, `dob`, `address`, `payment`
  - deps added related to crypto / security: `bcrypt`, `argon2`, `jose`, `passport`, `stripe`
- → require `threat_model`

### Rule R8: DFD required for async pipelines

- Detect any of:
  - new cron config: `**/*cron*` files, vercel cron, GitHub Actions schedule
  - stream / event-driven deps: `kafkajs`, `@aws-sdk/client-kinesis`, `nats`, `inngest`, `@trigger.dev/sdk`, `temporal`
  - ETL keywords in file paths: `pipeline`, `etl`, `ingest`, `stream`
- → require `dfd`

## spec.json `diagrams[]` Schema

Each diagram entry:

```jsonc
{
  "kind": "er" | "state" | "sequence" | "flow" | "c4_context" | "deployment" | "threat_model" | "dfd",
  "mermaid": "<mermaid source>",      // required, non-empty string
  "entities": ["..."],                 // required, non-empty for `er`/`state`/`sequence`/`c4_context`; optional for others
  "rationale": "..."                   // optional but recommended
}
```

### Mermaid prefix validation

For each `kind`, mermaid must start with one of:

| kind | acceptable prefix (case-sensitive after whitespace strip) |
|------|---|
| `er` | `erDiagram` |
| `state` | `stateDiagram-v2`, `stateDiagram` |
| `sequence` | `sequenceDiagram` |
| `flow` | `flowchart `, `graph ` |
| `c4_context` | `C4Context`, `C4Container` |
| `deployment` | `flowchart `, `graph `, `C4Deployment` |
| `threat_model` | `flowchart `, `graph ` |
| `dfd` | `flowchart `, `graph ` |

## Validation Algorithm

```
1. For each diagram in spec.diagrams[]:
   a. Validate against JSON schema (kind enum, mermaid non-empty)
   b. Check mermaid first non-empty line matches the kind's allowed prefix
   c. For kinds requiring entities: ensure entities[] non-empty
   d. Cross-check: for `er`/`state`/`sequence`, every entity in entities[] must
      appear as substring in at least one clause.statement OR clause.rationale
      (warn-only if mismatch — not blocking)

2. Compute required_set = diagram-requirement-resolver(story, code_diff).required_diagrams
3. Compute provided_set = unique kinds in spec.diagrams[]
4. missing = required_set \ provided_set
5. If missing is non-empty → return validation error with each missing kind
```

## Gate `gate:design_diagrams`

```jsonc
{
  "id": "gate:design_diagrams",
  "label": "Design Diagrams (MUST-HAVE)",
  "status": "blocked" | "pass" | "not_applicable",
  "blocking": true,
  "missing": ["er", "sequence"],
  "reasons": [
    { "kind": "er", "signal": "prisma/schema.prisma modified" }
  ]
}
```

- `not_applicable` when no trigger fires (required_set empty)
- `pass` when missing == []
- `blocked` when missing != []

## Backward Compatibility

- `diagrams` field is optional in spec-schema.json
- Existing spec.json files without diagrams[] validate as if `diagrams: []`
- When `required_diagrams` is empty (no triggers fire), gate yields `not_applicable` and never blocks
