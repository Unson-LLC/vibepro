---
summary: "OSS-facing PR body rendering for Engineering Judgment DAG reasoning."
parent_design: vibepro-manual-pr-flow-alignment
read_when:
  - Changing PR body Engineering Judgment rendering
  - Changing pr prepare human decision brief
  - Explaining Engineering Judgment DAG to OSS reviewers
---

# OSS-facing Engineering Judgment PR Message

## Status

Superseded for GitHub PR body rendering by `docs/architecture/vibepro-concise-pr-body.md` and `docs/specs/vibepro-concise-pr-body.md`.

Engineering Judgment evidence remains required, but the GitHub PR body no longer expands the full reasoning trace or the legacy decision graph. The durable evidence lives in `.vibepro/pr/<story-id>/pr-prepare.json`, `decision-index.json`, Gate DAG artifacts, and canonical audit artifacts.

## Architecture

The Engineering Judgment DAG remains the canonical machine-readable route model in `pr_context.gate_dag`. The GitHub PR body renders only a concise summary of the selected route, review focus, and artifact references.

The renderer separates five layers:

1. **Input**: Story purpose, source-of-truth file, changed surfaces, and PR route.
2. **Signals**: classifier signals such as `surface:agent_or_gate_workflow` or `risk_profile:light`, translated into reviewer language.
3. **Selected DAG**: the chosen `engineering_judgment.route_type` and `route_dag`.
4. **Required checks**: route-specific judgment gates and their reasons.
5. **Merge boundary**: required evidence statuses and unresolved blocking gates.

This keeps the internal DAG auditable while making the first screen useful to a reviewer who has never seen VibePro before, without turning GitHub body text into the audit store.

## Design Constraints

- Do not replace the Gate DAG audit log. The PR body summary is a digest, not a second source of truth.
- Do not expose only raw route labels. OSS reviewers need the input and reasoning behind the route.
- Do not make the message VibePro-specific. The language should describe engineering judgment, not internal implementation jargon.
- Keep the GitHub body short enough to read before following artifact references.

## Flow

```text
pr_context.engineering_judgment
  + story_source
  + file_groups
  + gate_dag
      -> render concise Engineering Judgment summary
      -> PR body "How to review" / "VibePro"
      -> artifact references for detailed Gate and decision evidence
```

## Compatibility

The legacy body sections `## このPRで決めたいこと`, `### 判断グラフ`, and expanded Gate / Agent Review / split-plan audit sections are not part of the current concise GitHub body contract.

Compatibility is preserved through artifacts: the same `pr_context` data remains available in `pr-prepare.json`, `decision-index.json`, Gate DAG artifacts, verification evidence, `pr-create.json`, and `pr-merge.json`.
