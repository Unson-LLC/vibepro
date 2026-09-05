# Minimal Core Flow

VibePro preserves context through five explicit steps. It does not turn them into an automatic pass/fail gate.

## 1. Story

```bash
vibepro story diagnose /path/to/repo --id story-example --run-graphify
```

Use a Story to state the intended user or operational outcome. Graphify is optional.

## 2. Spec

```bash
vibepro spec readiness /path/to/repo --id story-example --base origin/main
vibepro spec write /path/to/repo --id story-example --draft --input spec.json
```

A Spec can carry acceptance clauses plus code and test references. Draft and final states remain explicit.

## 3. Verification

```bash
vibepro verify run /path/to/repo --id story-example --kind unit -- npm test
```

`verify run` executes an argv command and records its result. `verify record` is available for evidence produced elsewhere; the source remains distinguishable.

## 4. Review and decisions

```bash
vibepro review prepare /path/to/repo --id story-example --role reviewer
vibepro review record /path/to/repo --id story-example --role reviewer \
  --status pass --summary "Reviewed the Story, Spec, and changed surface" \
  --inspection-input src/example.js
vibepro review status /path/to/repo --id story-example
vibepro decision status /path/to/repo --id story-example
```

These commands preserve a lightweight content-bound review and decision records. A missing inspection input alone does not block a review; concrete findings are recorded as `needs_changes` or `block`.

## 5. PR handoff

```bash
vibepro pr prepare /path/to/repo --story-id story-example --base origin/main
```

Inspect `.vibepro/pr/story-example/pr-prepare.json` and the generated PR body. Humans and repository policy decide what must happen next. `pr create` is an optional GitHub CLI handoff, not a safety gate.
