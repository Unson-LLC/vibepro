---
story_id: story-vibepro-review-dag-causal-freshness-and-convergence
title: Review DAG Causal Freshness and Convergence Architecture
status: active
---

# Review DAG Causal Freshness and Convergence Architecture

## 決定

Agent Reviewのfreshnessを、reviewerが読んだ全ファイルのbyte一致ではなく、role固有の判断依存と変更domainの因果関係で評価する。

```text
Inspection Surface
  reviewerが確認した全入力
          |
          | role-specific projection
          v
Decision Dependencies
  その判断を成立させる正本・契約
          |
          v
Invalidation Surface
  変更時にだけ判断をstaleにする面
```

Review結果は引き続きcontent-bound evidenceを持つ。ただし、そのsurfaceが変わった場合でも、変更がroleのdecision dependency domain外なら`causal_reuse`できる。`strict_head`は例外であり、HEAD変更時に必ず再評価する。

## Review DAG

```text
Story
  -> Product Requirement
  -> Architecture / Spec
  -> Test Plan
  -> Implementation
  -> Gate / Release
```

無効化は上流から下流へ伝播する。下流の実装変更で上流のStory判断を無効化しない。

| Changed domain | 主な再評価対象 |
|---|---|
| story / policy / public contract | requirement以下 |
| spec | requirement・architecture・test・implementation・gate |
| architecture | architecture・test・implementation・gate |
| implementation | test・implementation・preview・gate |
| test | test・implementation・preview・gate |
| release / config | runtime・preview・gate |
| docs | UX・preview・release関連role |

roleはdomain集合を明示的に持つ。未知roleはstage既定domainへfallbackし、意味の分からない変更を無条件に再利用しない。

## Finding delta closure

finding修正後のreviewは、元review全体の再証明ではなく次を正本にする。

```text
previous review
  + finding_id
  + fix HEAD
  + closure evidence
  + changed paths
  -> delta closure review
```

closureで解決していないfinding IDが残る場合、replacement reviewは`pass`になれない。過去reviewとfindingはhistoryへ残り、後のpassで消去しない。

## Runtime failure

subagentの失敗とproduct findingを分離する。

```text
runtime_failed:
  empty_result
  wrong_request
  timeout
  execution_error
```

`runtime_failed`はreview未完了として扱うが、product codeの欠陥とは数えない。次行動は「実装を直す」ではなく「正しいrequestでreview runtimeを再実行する」。

## Convergence

各review event後に次を正規化する。

```text
unresolved(stage, role, status, dependency domains)
finding ids
runtime failures
```

これらからHEADを含まないsemantic signatureを作る。review event cursorが進んだにもかかわらず同じsemantic signatureが3 wave続いた場合、状態を`review_nonconvergent`へ遷移させる。

```text
converging
  -> converged
  -> review_nonconvergent
```

status pollだけではevent cursorが変わらないためwaveを増やさない。`review_nonconvergent`では同じroleの再dispatchを停止し、review契約またはruntime defectを別Storyへ切り出す。

## Artifact

既存review resultに以下を追加する。

```text
causal_review
  inspection_surface
  decision_dependencies
  invalidation_surface
  dependency_domains

delta_closure
runtime_failure
```

Story review rootに以下を追加する。

```text
convergence/current.json
convergence/history/*.json
```

## 権限境界

- reviewは引き続き独立subagent evidenceを要求できる
- strict HEADは最終認証で維持する
- causal reuseはPR readinessを勝手にpassへ変えず、既存passの有効性だけを保持する
- `review_nonconvergent`は自動waiverではない
- merge、release、例外受容の最終権限は人間・CI・repository rulesに残る
