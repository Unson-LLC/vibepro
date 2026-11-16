---
story_id: story-vibepro-review-dag-causal-freshness-and-convergence
title: Review DAG Causal Freshness and Progress-Sensitive Convergence Spec
architecture_ref: docs/architecture/story-vibepro-review-dag-causal-freshness-and-convergence.md
status: accepted
---

# Review DAG Causal Freshness and Progress-Sensitive Convergence Spec

## 1. Causal surface

review resultは次を持つ。

```json
{
  "causal_review": {
    "schema_version": "0.2.0",
    "model": "vibepro-review-causal-dag-v1",
    "stage": "planning_spec",
    "role": "product_requirement",
    "dependency_domains": ["story", "spec", "policy", "public_contract"],
    "inspection_surface": [
      { "path": "src/runtime.js", "domain": "implementation", "classified": true }
    ],
    "decision_dependencies": [
      { "path": "docs/management/stories/active/story-x.md", "domain": "story", "classified": true }
    ],
    "invalidation_surface": [
      { "path": "docs/management/stories/active/story-x.md", "domain": "story", "classified": true }
    ],
    "unknown_inspection_surface": [],
    "classification_status": "classified"
  }
}
```

- `inspection_surface`は監査用であり、その全要素をfreshness依存にしてはならない。
- `decision_dependencies`はrole dependency domainに属する入力だけを含む。
- `invalidation_surface`は後続freshness判定で実際に読み取る。
- replacement reviewではprevious reviewの`invalidation_surface`を継承し、delta inspectionだけで過去の正本依存を失わない。
- path分類不能時は`classification_status=inconclusive_fail_closed`とし、`causal_reuse`を許可しない。

## 2. Causal binding status

既存の`current`、`reused_merge_delta`に加えて`causal_reuse`をcurrent扱いする。

`evaluateReviewCausalInvalidation`は次の順に判定する。

1. `strict_head`なら異なる候補HEADへ再利用しない。
2. content bindingがstaleなのにchanged-file deltaが空または取得不能ならfail closedにする。
3. changed pathまたは記録済みsurfaceが分類不能ならfail closedにする。
4. changed pathが記録済み`invalidation_surface`と重なる、またはrole dependency domainに属する場合は`stale`にする。
5. いずれにも該当しない場合だけ`causal_reuse`にする。

結果は少なくとも次を持つ。

```text
reusable
invalidated
fail_closed
reason
classification_status
dependency_domains
changed_files
relevant_changed_files
invalidation_surface_used
recorded_invalidation_surface
```

## 3. Delta closure

previous reviewにfindingがあり、replacement recordが`--resolved-finding <finding-id>:<evidence>`を持つ場合、`delta_closure.mode=delta_closure`とする。

```text
source_recorded_at
source_status
source_head_sha
fix_head_sha
resolved_findings
unresolved_finding_ids
closure_inputs
```

`status=pass`時に`unresolved_finding_ids`が1件以上ならrecordを拒否する。finding IDだけでなくclosure evidenceとfix HEADを保持し、複数commitにまたがる修復を追跡可能にする。

## 4. Runtime failure

`review record --status runtime_failed`を許可する。この場合、次を必須とする。

```text
--runtime-failure-kind empty_result|wrong_request|timeout|execution_error
```

`--runtime-failure-detail`は任意。runtime failureは`findings`へ変換しない。成功したretryは同じroleの新しい完了eventとなり、runtime stateの変化を進展として扱う。

## 5. Completed review event cursor

convergence waveは完了したreview recordによってだけ進める。event cursorは、stage、role、recorded_at、recorded status、runtime failure kind、fix HEAD、artifactから作る正規化event集合のhashとする。

次はevent cursorを進めない。

- HEADだけの変更
- `review status`のpoll
- 同じreview recordから導出されるfreshness statusの再読込

同じevent cursorでHEADだけが変わった場合、`head_churn_count`だけを増やし、`wave_count`と`no_progress_count`は変更しない。

## 6. Progress signature

convergence snapshotは次を含む。

```text
head_sha
event_cursor
event_count
exact_signature
semantic_signature
progress_signature
component_hashes
unresolved_roles
findings
runtime_failures
completed_review_events
```

`progress_signature`は次のcomponentを含む。

```text
unresolved role state
finding id / severity / detail / disposition / reason
runtime failure kind / detail
inspection summary / evidence / inputs
judgment delta
role dependency domains
recorded invalidation surface
classification status
delta closure / closure evidence / fix HEAD
```

前waveと`progress_signature`が異なる場合は進展とみなし、`no_progress_count=0`へ戻す。component hashの差から次の`progress_reasons`を生成する。

```text
unresolved_roles_changed
finding_state_changed
runtime_state_changed
review_evidence_changed
dependency_surface_changed
repair_delta_changed
```

異なるevent cursorで`progress_signature`が同じ完了review waveが3回続いた場合だけ`review_nonconvergent`にする。

## 7. Convergence state

```json
{
  "schema_version": "0.2.0",
  "model": "vibepro-review-convergence-v2",
  "status": "converging",
  "wave_count": 2,
  "no_progress_count": 0,
  "head_churn_count": 1,
  "event_advanced": true,
  "progress_detected": true,
  "progress_reasons": ["review_evidence_changed"],
  "snapshot": {},
  "next_action": "Dispatch only unresolved causally-invalidated roles; do not recreate current reviews."
}
```

状態は次のいずれかとする。

```text
converging
converged
review_nonconvergent
```

`review_nonconvergent`はpass、waiver、merge許可を意味しない。

## 8. Dispatch stop

storyの`convergence/current.json`が`review_nonconvergent`の場合、roleを明示しない通常の`review prepare`は次を返す。

```text
roles: []
dispatch_allowed: false
parallel_dispatch.required: false
coordinator_behavior.expected: stop_nonconvergent
```

人間がroleを明示したretryは許可し、復旧経路を残す。

## 9. Projection

`review status`とPR向けreview summaryに次を投影する。

- causal binding statusとreason
- 記録済みinvalidation surfaceを使用したか
- relevant changed files
- classification statusとfail-closed理由
- delta closure modeと未解決finding数
- runtime failure kind
- convergence status
- wave count
- no-progress count
- head churn count
- event advanced
- progress detected / progress reasons
- next action

## 10. Compatibility and authority

- 既存review artifactに`causal_review`が無い場合は従来freshnessへfallbackする。
- `pass|needs_changes|block`の既存契約を維持し、`runtime_failed`を追加する。
- `causal_reuse`は既存の有効なpassだけを保持する。`needs_changes`、`block`、未解決findingをpassへ昇格しない。
- `strict_head`最終認証を緩和しない。
- 新しい状態は追加的であり、旧汎用Gate DAG、automatic merge、release authorityを復活させない。
- CIは検証だけを行い、実装branchを生成または書換しない。
