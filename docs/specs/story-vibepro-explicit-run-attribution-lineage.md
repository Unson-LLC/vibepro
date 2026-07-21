---
story_id: story-vibepro-explicit-run-attribution-lineage
title: Explicit Run Attribution Lineage Spec
status: final
parent_design:
  - vibepro-explicit-run-attribution-lineage
---

# Explicit Run Attribution Lineage Spec

## Contract

VibePro-owned dispatchはGuarded Run authorityから`0.1.0` lineage envelopeを生成する。必須fieldは`story_id`、`run_id`、`dispatch_id`、`worktree_root`、`branch`、`head_sha`である。`provider_run_id`、`provider_session_id`、`thread_id`はoptional observationであり、単独ではStory authorityにならない。

lineage付きrecordはauthority bindingをvalidateしてから書く。field不一致は`invalid_run_lineage`、`run_lineage_mismatch`、`stale_run_lineage_head`、`provider_observation_conflict`のいずれかで非破壊的に失敗する。lineageなしの既存callerは従来どおり動作する。

## Public output

Run-aware attributionは各結果に以下を返す。

- `bucket`: `story_attributed | shared_parent | other_story | unattributed | replayed_context`
- `method`: `explicit_run_lineage | validated_artifact_binding | worktree_inference | textual_heuristic | unavailable`
- `source_artifact`: repository-relative pathまたは`null`
- `confidence`: `authoritative | high | medium | low | unavailable`
- `run_id`: 確定時のみRun id

各event/exposureは1 bucketにのみ入り、分類合計は入力合計と一致する。`shared_parent`、`other_story`、`unattributed`、`replayed_context`は対象Storyの帰属token/timeへ加算しない。

## Persistence

- Runtime dispatch journalはdispatch record内にvalidated envelopeを保存する。
- Provider observationは同じdispatchへdeduplicateしてappendし、既存authority fieldを変更しない。
- Verification/review/decision/action artifactはactive Runが一意に解決できる場合にlineageまたは安定refを保存する。
- Context capsuleはbounded summaryとartifact refだけを保存し、transcript、prompt、tool output、hidden reasoningを保存しない。

## Resolution

明示Run指定またはStory配下のRun artifactからdispatch/provider observationを解決する。優先順位は`explicit_run_lineage > validated_artifact_binding > branch/worktree inference > textual heuristic`。複数Runに一致するparent eventは`shared_parent`、対象外Runに確定するeventは`other_story`、根拠不足または不可分mixed outputは`unattributed`とする。compaction replacementと再掲contextは常に`replayed_context`を優先する。

## Code references

- `src/run-lineage.js` — schema、validation、observation merge、attribution resolver
- `src/agent-runtime-adapter.js` — dispatch/observation propagation
- `src/guarded-run-session.js` — Run authority binding
- `src/session-efficiency-audit.js` — accountingとadditive public output
- `src/run-context-capsule.js` — bounded handoff projection

## Test references

- `test/run-lineage.test.js`
- `test/agent-runtime-adapter-lineage.test.js`
- `test/session-efficiency-run-lineage.test.js`
- `test/e2e/story-vibepro-explicit-run-attribution-lineage-main.test.js`

## Acceptance mapping

| Clause | Verification |
|---|---|
| ERAL-S-1 | `test/run-lineage.test.js`: `creates and validates a version 0.1.0 envelope from Run authority`; `test/agent-runtime-adapter-lineage.test.js`: `persists Run authority and provider observations while preserving compatibility fields` |
| ERAL-S-2 | `test/run-lineage.test.js`: `rejects malformed and mismatched bindings with typed errors` / `provider observations merge append-only, deduplicate, and reject rebind/conflict`; adapter provider identity rejection case |
| ERAL-S-3 | `test/run-lineage-evidence-propagation.test.js`: additive recorder inheritance and mismatch-before-write cases |
| ERAL-S-4 | `test/session-efficiency-run-lineage.test.js`: embedded lineage attribution leaves Thread-only observations unattributed; `test/run-lineage.test.js`: Thread-only observations are not authoritative |
| ERAL-S-5 | `test/run-lineage.test.js`: `resolves five attribution buckets with bounded provenance and reconciled totals` |
| ERAL-S-6 | Five-bucket reconciliation case plus `session efficiency audit accepts the run_id alias without changed-line allocation` |
| ERAL-S-7 | `test/run-lineage.test.js`: `thread-only observations never become authoritative story attribution` |
| ERAL-S-8 | `test/session-efficiency-run-lineage.test.js`: run_id alias compatibility; `test/agent-runtime-adapter-lineage.test.js`: polling preserves lineage and observations |
| ERAL-S-9 | `test/run-context-capsule-lineage.test.js`: bounded Story→Run→dispatch→provider observation projection and bounded many-dispatch projection |
| ERAL-S-10 | Focused unit coverage plus `test/e2e/story-vibepro-explicit-run-attribution-lineage-main.test.js`, which exercises Guarded Run→dispatch→evidence→canonical Run session-cost→transcript-free handoff and all attribution buckets |
| ERAL-S-11 | `src/run-lineage.js` resolver boundary, `src/session-efficiency-audit.js` consumer import, plus existing audit compatibility and bucket reconciliation tests; Graphify boundary is recorded in readiness artifact |

## Rollback and privacy

additive lineage fieldとresolver呼び出しを削除して既存推定経路へ戻せる。既存readerは未知fieldを無視する。provider transcriptやprompt本文はlineage artifactへ複製しない。
