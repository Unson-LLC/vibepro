---
story_id: story-vibepro-cross-system-adjudication
title: Cross-system adjudication requires a different model family than the implementer
status: historical
updated_at: 2026-09-02
reason: Deriving implementer identity from implementation-stage review records was rejected because those records carry the reviewer's system, not the implementer's; an explicit provenance record is the only truthful source. A global config switch to disable the check was rejected because it would make same-system passes an implicit default. The compatible boundary is additive staged rollout - stories with no recorded implementation provenance keep today's behavior except advisory warnings, evidence adjudication stays warning-only, and enforcement applies only to the judgment-DAG path that already exists solely on agent_workflow / workflow_heavy routes. Rollback is removal of the provenance command and the enforcement branch; all new artifacts are additive files under .vibepro/adjudication/<story-id>/. Model-level diversity (--agent-model) is out of scope; the enforced axis is agent_system only.
---

> **Historical (2026-09-02)**: The `vibepro adjudicate` mechanism (provenance, cross-system enforcement) this Story describes was removed in PR #430. Kept as design history only.

# Story: Cross-system adjudication requires a different model family than the implementer

## Background

Adjudicator independence is currently enforced on two axes only: state
independence (fresh context via the adjudication request documents) and
individual independence (a premise correction cannot be re-adjudicated by the
same `agent_system:agent_id` judge identity). The third axis - weight
independence - is not enforced: an adjudicator from the same model family as
the implementation agent shares the implementation agent's training-distribution
priors, so plausible-but-wrong patterns the implementer believes are correct
will be judged sound for the same reason. Errors and verdicts correlate, the
independent-verification error product does not hold, and N same-system judges
amount to one vote against weight-borne errors. `ADJUDICATION_AGENT_SYSTEMS`
(`codex` / `claude_code`) already provides the vocabulary needed to enforce the
axis; what is missing is capturing which system implemented the story and
comparing at adjudication time.

## Acceptance Criteria

- `vibepro adjudicate provenance <repo> --id <story-id> --agent-system codex|claude_code` records the implementation agent's system into `.vibepro/adjudication/<story-id>/implementation-provenance.json` with recorded_at and head commit; an agent system outside `ADJUDICATION_AGENT_SYSTEMS` is rejected before any write.
- When implementation provenance is recorded and `adjudicate record` receives the same `--agent-system` for an evidence-adjudication verdict, the recorded result carries a `same_system` warning naming both systems; verdict recording is not blocked on the evidence path.
- On the judgment-DAG path, `adjudicate record` and `adjudicate correct` with an `--agent-system` equal to the recorded implementation system are rejected before persistence unless `--allow-same-system <reason>` is provided; the granted override reason is appended to the append-only log `.vibepro/adjudication/<story-id>/same-system-log.jsonl` and stored on the persisted event's provenance.
- An accepted decision record with source `gate:judgment_dag_adjudication:same_system_environment` and a non-empty reason and artifact downgrades judgment-DAG same-system rejection to a warning for that story, so a single-system environment closes through an explicit recorded decision rather than an implicit same-system pass.
- When no implementation provenance is recorded for the story, judgment-DAG recording emits a `provenance_missing` warning and otherwise behaves exactly as before this story; a cross-system adjudicator with provenance recorded produces no same-system warning and no override requirement.
- The existing same-judge-identity rejection for premise-correction re-adjudication is preserved unchanged alongside the new system-level check.

## 検証

Verification runs through the targeted unit suites for adjudication and the
story e2e spec, exercising provenance recording, the warning path, the
enforcement-with-override path including the append-only log, the accepted
decision-record environment fallback, and the unchanged cross-system and
missing-provenance behaviors.
