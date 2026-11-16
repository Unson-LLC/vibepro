---
story_id: story-vibepro-review-dag-causal-freshness-and-convergence
title: Review DAG Causal Freshness and Progress-Sensitive Convergence Architecture
status: active
---

# Review DAG Causal Freshness and Progress-Sensitive Convergence Architecture

## 決定

Agent Reviewのfreshnessを、reviewerが読んだ全ファイルのbyte一致ではなく、role固有の判断依存、記録済みinvalidation surface、変更domainの因果関係で評価する。

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

Review結果は引き続きcontent-bound evidenceを持つ。ただし、inspection surfaceが変わっただけでは上流判断を無効化しない。後続freshness判定はartifactに保存された`invalidation_surface`を読み、変更pathとの重なりとrole dependency domainの双方を評価する。

`strict_head`は例外であり、異なる候補HEADへ一切再利用しない。changed-file deltaを取得できない場合、分類不能pathがある場合、または記録済みsurface自体がinconclusiveな場合はfail closedにする。

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

roleはdomain集合を明示的に持つ。未知roleはstage既定domainへfallbackするが、分類不能な変更pathを無条件に再利用しない。

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

closureで解決していないfinding IDが残る場合、replacement reviewは`pass`になれない。過去reviewとfindingはhistoryへ残り、後のpassで消去しない。複数commitにまたがる段階的修復では、closure evidence、repair delta、finding dispositionの変化を進展として扱う。

## Runtime failure

subagentの失敗とproduct findingを分離する。

```text
runtime_failed:
  empty_result
  wrong_request
  timeout
  execution_error
```

`runtime_failed`はreview未完了として扱うが、product codeの欠陥とは数えない。次行動は「実装を直す」ではなく「正しいrequestでreview runtimeを再実行する」。runtime retryが成功してpassへ変わった場合は、runtime stateの進展としてconvergenceを更新する。

## Progress-sensitive convergence

### Event cursor

waveは完了したreview recordによってだけ進む。HEAD、status poll、derived freshnessの再読込は観測でありreview waveではない。

```text
completed review records
  -> normalized event set
  -> event_cursor
```

HEADだけが変わりevent cursorが同じ場合、head churnは記録するが`wave_count`と`no_progress_count`は増やさない。

### Progress signature

単なるunresolved role ID集合では進展を正しく測れない。各review event後、次を正規化する。

```text
unresolved role state
finding content and disposition
runtime failure state
inspection summary / evidence / inputs
judgment delta
dependency domains / invalidation surface
repair and closure delta
```

これらから`progress_signature`を作る。前waveからsignatureが変われば進展ありとして`no_progress_count=0`へ戻し、変化理由を記録する。

```text
progress reasons:
  unresolved_roles_changed
  finding_state_changed
  runtime_state_changed
  review_evidence_changed
  dependency_surface_changed
  repair_delta_changed
```

完了review waveが進んだにもかかわらずprogress signatureが同じ状態を3回観測した場合だけ、`review_nonconvergent`へ遷移させる。

```text
converging
  -> converged
  -> review_nonconvergent
```

## Dispatch control

`review_nonconvergent`は自動waiverではない。通常の`review prepare`はrolesを空にし、automatic redispatchを停止する。明示的にroleを指定した人間主導retryだけは許可する。

```text
review_nonconvergent
  -> automatic prepare: no roles
  -> explicit human role retry: allowed
```

これにより、証跡ループを止めながら復旧経路を失わない。

## Artifact

既存review resultに以下を追加する。

```text
causal_review
  inspection_surface
  decision_dependencies
  invalidation_surface
  unknown_inspection_surface
  classification_status
  dependency_domains

delta_closure
runtime_failure
```

Story review rootに以下を追加する。

```text
convergence/current.json
convergence/history/*.json
```

convergence artifactは次を持つ。

```text
event_cursor
wave_count
no_progress_count
head_churn_count
progress_signature
component_hashes
progress_detected
progress_reasons
next_action
```

## 権限境界

- reviewは引き続き独立subagent evidenceを要求できる
- strict HEADは最終認証で維持する
- causal reuseは既存passの有効性だけを保持し、`needs_changes`、`block`、未解決findingをpassへ変換しない
- classification不明またはdelta解決不能はfail closedにする
- `review_nonconvergent`は自動waiverではない
- CIは検証者であり、実装branchの生成者・書換者にしない
- merge、release、例外受容の最終権限は人間・CI・repository rulesに残る
