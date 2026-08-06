# Agent Review

Required Agent Review is an independent, parallel-subagent inspection of the current diff and evidence. A human note or an untracked second opinion does not substitute for required parallel-subagent provenance.

```bash
vibepro review prepare . --id <story-id> --stage gate --role <role>
```

Give the reviewer the prepared request, current diff, relevant Story/Architecture/Spec, verification artifacts, and exact inspection inputs. The reviewer must be separate from the implementation identity and return concrete findings.

After receiving the result, close/shut down that subagent thread or session, then record it:

```bash
vibepro review record . \
  --id <story-id> --stage gate --role <role> \
  --status pass --summary "<summary>" \
  --agent-system codex --execution-mode parallel_subagent \
  --agent-id <agent-id> --agent-closed \
  --reviewer-identity separate_session \
  --implementation-session-id <implementation-session> \
  --inspection-summary "<what was inspected>" \
  --inspection-input <source-test-story-spec-contract-or-config> \
  --inspection-evidence <transcript-or-result> \
  --judgment-delta "<initial judgment -> final judgment because evidence>"

vibepro review status . --id <story-id> --stage gate
```

Valid review statuses are `pass`, `needs_changes`, and `block`. A passing review must name an existing non-`.vibepro` source, test, Story, Spec, contract, or config as an inspection input; generated `.vibepro` artifacts alone do not define an inspection surface.

Reviews, including `gate_evidence` and `release_risk`, are content-surface-bound by default: later commits preserve the review while its inspected surface is unchanged, and changes to that surface make it stale. A role-specific `strict_head` policy with a reason remains HEAD-bound and becomes stale after any commit.

`--strict-head-binding --strict-head-reason <reason>` is **not** an unconditional CLI override. It is only authorized for two origins: a role whose policy already declares `freshness_mode: strict_head` with a `freshness_reason` (the flag is then redundant but harmless), or the `implementation:runtime_contract` `final_review` of an active, frozen validation sequence (TOCTOU protection for the release candidate). Any other role/stage rejects the flag with an explicit error naming the role's configured freshness mode; do not attempt to strict-ify an ordinary content-surface review from the CLI. `vibepro pr prepare` reports each strict binding's origin (`role_policy`, `validation_sequence`, or a legacy `cli_override`) and surfaces a migration warning for any pre-existing `cli_override` artifact instead of rewriting it automatically.

Fix accepted findings, re-verify, and repeat only the reviews invalidated by the final tree.

Adjudication is a separate independent judgment. Use `adjudicate prepare` and `adjudicate record` for clause-by-clause demonstration and senior-judgment items after the implementation and evidence are final.
