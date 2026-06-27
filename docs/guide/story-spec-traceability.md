# Story, Spec, and Traceability

Story and Spec are the intent layer. They explain why the change exists and what must remain true.

Use:

```bash
vibepro story list .
vibepro story derive . --json
vibepro story diagnose . --id <story-id>
```

Traceability connects Story clauses, Spec clauses, changed files, verification evidence, and PR gates. Impact Context can suggest related code, but it cannot decide product intent.
