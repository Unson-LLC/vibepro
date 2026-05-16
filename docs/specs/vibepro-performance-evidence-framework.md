# VibePro Performance Evidence Framework Spec

## CLI

### `vibepro performance define`

```
vibepro performance define [repo] \
  --id <story-id> \
  --metric-id <id> \
  --user-story <text> \
  --start-condition <text> \
  --completion-condition <text> \
  [--intermediate-marker <id>] \
  [--timeout-ms <ms>] \
  [--failure-classification <class>] \
  [--evidence-source <server_log|browser_e2e|api_log|client_marker|manual_observation>] \
  [--readiness-kind <server_side|user_perceived|external_dependency|system_internal>] \
  [--comparison-policy <json|name>] \
  [--json]
```

対象Storyの `performanceMetrics[]` にmetricをupsertする。

### `vibepro performance record`

```
vibepro performance record [repo] \
  --id <story-id> \
  --metric-id <id> \
  --label <before|after> \
  --status <completed|blocked|needs_review|timeout|auth_required|resource_unavailable|unknown> \
  [--duration-ms <ms>] \
  [--marker <id=ms>] \
  [--evidence-source <type:ref:summary>] \
  [--completion-condition <text>] \
  [--run-id <id>] \
  [--json]
```

runを `.vibepro/pr/<story-id>/performance-runs/<run-id>.json` に保存する。

### `vibepro performance compare`

```
vibepro performance compare [repo] \
  --id <story-id> \
  [--metric-id <id>] \
  [--before-label <label>] \
  [--after-label <label>] \
  [--json]
```

同じ `metricId` と `completionCondition` のcompleted runだけを使い、p50/p90/max差分を出す。

## Run Schema

```json
{
  "schema_version": "0.1.0",
  "story_id": "story-id",
  "metric_id": "session-switch.user-terminal-ready",
  "run_id": "after-1",
  "label": "after",
  "status": "completed",
  "status_classification": null,
  "metric_definition": {},
  "measurement_definition": {
    "start_condition": {},
    "completion_condition": {},
    "intermediate_markers": [],
    "timeout_ms": 30000
  },
  "observation": {
    "duration_ms": 600,
    "intermediate_markers": [],
    "evidence_sources": []
  },
  "comparison_key": {
    "metric_id": "session-switch.user-terminal-ready",
    "completion_condition": "owner + inputReady=true"
  },
  "quality": {
    "status": "ok",
    "issues": []
  }
}
```

## 受入仕様

- `user_perceived` metricは `server_log` だけでは比較可能にしない
- completion conditionが異なるrunは同じmetricでも比較対象にしない
- `blocked`, `needs_review`, `timeout`, `auth_required`, `resource_unavailable`, `unknown` はrunとして保存し、未完了率に含める
- comparison不能時は `not_comparable_reasons[]` を返す
- 不足marker/sourceは `missing_evidence[]` に出す
- diagnose evidenceとPR bodyにperformance evidence summaryを含める
