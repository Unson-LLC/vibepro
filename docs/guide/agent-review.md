# Agent Review

Required Agent Review is an independent, lifecycle-bound inspection of the current diff and evidence. A human note or an untracked second opinion does not substitute for required parallel-subagent provenance.

```bash
vibepro review prepare . --id <story-id> --stage gate --role <role>
vibepro review start . \
  --id <story-id> --stage gate --role <role> \
  --agent-system codex --agent-id <agent-id>
```

Give the reviewer the prepared request, current diff, relevant Story/Architecture/Spec, verification artifacts, and exact inspection inputs. The reviewer must be separate from the implementation identity and return concrete findings.

After receiving the result, close the lifecycle before recording it:

```bash
vibepro review close . \
  --id <story-id> --stage gate --role <role> \
  --agent-id <agent-id> --close-reason completed \
  --close-evidence <transcript-or-result>

vibepro review record . \
  --id <story-id> --stage gate --role <role> \
  --status pass --summary "<summary>" \
  --agent-system codex --execution-mode parallel_subagent \
  --agent-id <agent-id> --agent-closed \
  --reviewer-identity separate_session \
  --implementation-session-id <implementation-session> \
  --inspection-summary "<what was inspected>" \
  --inspection-input <diff-or-artifact> \
  --inspection-evidence <transcript-or-result>

vibepro review status . --id <story-id> --stage gate
```

Valid review statuses are `pass`, `needs_changes`, and `block`. Any commit after recording makes head-bound evidence stale; fix accepted findings, re-verify, and repeat the review once for the final tree.

Adjudication is a separate independent judgment. Use `adjudicate prepare` and `adjudicate record` for clause-by-clause demonstration and senior-judgment items after the implementation and evidence are final.
