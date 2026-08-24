---
story_id: story-vibepro-review-dag-causal-freshness-and-convergence
title: Review DAG Causal Freshness and Convergence Spec
architecture_ref: docs/architecture/story-vibepro-review-dag-causal-freshness-and-convergence.md
status: accepted
---

# Review DAG Causal Freshness and Convergence Spec

## 1. Causal surface

review resultは次を持つ。

```json
{
  "causal_review": {
    "model": "vibepro-review-causal-dag-v1",
    "stage": "planning_spec",
    "role": "product_requirement",
    "dependency_domains": ["story", "spec", "policy", "public_contract"],
    "inspection_surface": [{ "path": "src/runtime.js", "domain": "implementation" }],
    "decision_dependencies": [{ "path": "docs/management/stories/active/story-x.md", "domain": "story" }],
    "invalidation_surface": [{ "path": "docs/management/stories/active/story-x.md", "domain": "story" }]
  }
}
```

`inspection_surface`は監査用であり、その全要素をfreshness依存にしてはならない。`decision_dependencies`はrole dependency domainに属する入力だけを含む。

## 2. Binding status

既存の`current`、`reused_merge_delta`に加えて`causal_reuse`をcurrent扱いする。

- role dependency domainに関係するchanged fileが0件なら`causal_reuse`
- 1件以上なら`stale`
- `strict_head`はchanged fileの有無に関わらず異なるHEADで`stale`

## 3. Delta closure

previous reviewにfindingがあり、replacement recordが`--resolved-finding <finding-id>:<evidence>`を持つ場合、`delta_closure.mode=delta_closure`とする。

`status=pass`時に`unresolved_finding_ids`が1件以上ならrecordを拒否する。

## 4. Runtime failure

`review record --status runtime_failed`を許可する。この場合、次を必須とする。

```text
--runtime-failure-kind empty_result|wrong_request|timeout|execution_error
```

`--runtime-failure-detail`は任意。runtime failureは`findings`へ変換しない。

## 5. Convergence

convergence snapshotは次を含む。

```text
head_sha
exact_signature
semantic_signature
event_cursor
unresolved_roles
finding_ids
runtime_failures
```

同じ`event_cursor`の再読込ではrepeat countを増やさない。異なるevent cursorで同じsemantic signatureが3回続くと`review_nonconvergent`になる。

## 6. Projection

`review status`とPR向けreview summaryに次を投影する。

- causal binding statusとreason
- relevant changed files
- delta closure modeと未解決finding数
- runtime failure kind
- convergence status、repeat count、head churn count、next action

## 7. Compatibility

- 既存review artifactに`causal_review`が無い場合は従来freshnessへfallbackする
- `pass|needs_changes|block`の既存契約を維持する
- 新しい状態は追加的であり、旧汎用Gate DAGやautomatic mergeを復活させない
