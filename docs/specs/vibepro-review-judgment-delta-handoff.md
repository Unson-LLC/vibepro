---
story_id: story-vibepro-review-judgment-delta-handoff
title: Review Judgment Delta Handoff Spec
---

# 仕様

## 必須挙動

- `vibepro review record` MUST accept repeated `--inspection-input <ref>` flags.
- `vibepro review record` MUST accept repeated `--judgment-delta <text>` flags.
- Recorded review result JSON MUST include `inspection.inputs[]`; missing inputs MUST serialize as an empty array.
- Recorded review result JSON MUST include `judgment_delta[]`; missing deltas MUST serialize as an empty array.
- Stage summary roles in `review-summary.json` and `review status --json` MUST surface both fields for each role.
- `review-summary.md` MUST render a compact role-level handoff suffix when either field is non-empty.
- `review prepare` request and parallel-dispatch artifacts MUST ask subagents to return `inspection_inputs` and `judgment_delta`.
- Existing artifacts with `inspection.summary` and `inspection.evidence` but no `inspection.inputs` or `judgment_delta` MUST remain readable.

## Flow Diagram

```mermaid
flowchart TD
  Request["review prepare request"] --> Subagent["subagent inspection"]
  Subagent --> Inputs["inspection_inputs"]
  Subagent --> Delta["judgment_delta"]
  Inputs --> Record["review record"]
  Delta --> Record
  Record --> Result["review-result-<role>.json"]
  Result --> Status["review status JSON"]
  Result --> Summary["review-summary.md handoff suffix"]
```

## 非目標

- review outcomeを新しいfieldだけで自動変更すること。
- `inspection_inputs` をfile pathだけに制限すること。commands、artifact path、logs、URLs、state refsも許容する。
