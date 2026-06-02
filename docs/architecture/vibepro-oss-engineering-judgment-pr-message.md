---
summary: "OSS-facing PR body rendering for Engineering Judgment DAG reasoning."
read_when:
  - Changing PR body Engineering Judgment rendering
  - Changing pr prepare human decision brief
  - Explaining Engineering Judgment DAG to OSS reviewers
---

# OSS-facing Engineering Judgment PR Message

## Architecture

The Engineering Judgment DAG remains the canonical machine-readable route model in `pr_context.gate_dag`. The PR body now adds a human-facing reasoning trace above the existing decision graph.

The renderer separates five layers:

1. **Input**: Story purpose, source-of-truth file, changed surfaces, and PR route.
2. **Signals**: classifier signals such as `surface:agent_or_gate_workflow` or `risk_profile:light`, translated into reviewer language.
3. **Selected DAG**: the chosen `engineering_judgment.route_type` and `route_dag`.
4. **Required checks**: route-specific judgment gates and their reasons.
5. **Merge boundary**: required evidence statuses and unresolved blocking gates.

This keeps the internal DAG auditable while making the first screen useful to a reviewer who has never seen VibePro before.

## Design Constraints

- Do not replace the Gate DAG audit log. The reasoning trace is a digest, not a second source of truth.
- Do not expose only raw route labels. OSS reviewers need the input and reasoning behind the route.
- Do not make the message VibePro-specific. The language should describe engineering judgment, not internal implementation jargon.
- Keep the trace short enough to read before the detailed audit log.

## Flow

```text
pr_context.engineering_judgment
  + story_source
  + file_groups
  + gate_dag
      -> renderEngineeringJudgmentReasoning()
      -> PR body "Engineering Judgment の判断過程"
      -> existing "判断グラフ"
      -> existing audit log
```

## Compatibility

Existing PR body sections remain intact:

- `## このPRで決めたいこと`
- `### 判断グラフ`
- Gate DAG / Gate Enforcement audit sections
- Agent Review / split plan / verification evidence sections

The new reasoning trace is additive and uses already-computed `pr_context` data.
