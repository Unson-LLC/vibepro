# The Guarded Delivery Control Loop

VibePro treats delivery as a sequence of current-head contracts, not a checklist that can be satisfied once and forgotten.

```text
Story → Architecture / Spec → Code → Verification
      → Independent Review → Adjudication → Release Guard
      → PR → CI refresh → Merge → Canonical Audit / ROI
```

## 1. Bind Intent and Design

```bash
vibepro story diagnose . --id <story-id> --pre-architecture --run-graphify
vibepro architecture write . --id <story-id> --input <architecture.json> --final
vibepro spec write . --id <story-id> --input <spec.json> --final
vibepro story diagnose . --id <story-id> --phase pre-implementation --run-graphify
```

Story is the outcome contract. Architecture owns boundaries and rollback. Spec owns machine-checkable clauses, code/test references, and required diagrams. Graph and Journey context are impact lenses; they do not replace those authorities.

## 2. Implement and Prove Behavior

```bash
vibepro verify record . \
  --id <story-id> \
  --kind build \
  --status pass \
  --command "npm run build" \
  --artifact <durable-status-artifact> \
  --scenario "production build completes" \
  --observed "exit_code=0"
```

Use `pass`, `fail`, or `needs_setup`. A passing exit code without a durable artifact and concrete observations may be supporting evidence rather than completion proof.

## 3. Inspect Independently

Run the lifecycle in [Agent Review](/guide/agent-review): prepare, start a separate reviewer, inspect, close the lifecycle, then record the result with provenance. Use `adjudicate prepare` and `adjudicate record` when Spec clauses or senior-judgment items require an independent verdict.

## 4. Guard and Prepare the PR

```bash
vibepro guard check . --story-id <story-id>
vibepro pr prepare . --story-id <story-id> --base origin/main --summary-json
vibepro pr create . --story-id <story-id> --base origin/main
```

`pr-prepare.json` and its `gate_status` are the readiness source of truth. A concise PR body is a decision brief, not a substitute for the evidence artifacts.

## 5. Refresh CI and Merge

```bash
vibepro verify import-ci . --id <story-id> --pr <number>
vibepro pr prepare . --story-id <story-id> --base origin/main --summary-json
vibepro pr create . --story-id <story-id> --base origin/main
vibepro execute merge . --story-id <story-id> --strategy merge
```

Importing CI changes the evidence set. Re-run preparation and PR refresh before merge so artifacts and the PR body describe the current head.

## 6. Preserve the Outcome

```bash
vibepro audit replay . --story-id <story-id>
vibepro usage report . --gate-roi --subagent-roi
```

Canonical audit answers what shipped and whether it can be replayed from the authoritative checkout. Usage reporting separates delivery value from evidence and review cost.
