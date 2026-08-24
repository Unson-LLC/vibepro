---
story_id: story-vibepro-review-dag-causal-freshness-and-convergence
title: Review DAGを因果的freshnessと収束制御へ変更する
status: active
view: dev
---

# Review DAGを因果的freshnessと収束制御へ変更する

## 背景

外部リポジトリの実装トレースで、候補HEADの2ファイルだけを修正した後に、21 review role中16 roleがstaleとなり、レビュー証跡の再生成がProgram進行を長時間占有した。

レビューは実際の契約矛盾や権限不足を発見しており、独立レビュー自体を削除するのは誤りである。一方、現在は「reviewerが読んだ全ファイル」をfreshness依存先として扱うため、実装だけの変更でもproduct requirementやarchitectureなど上流判断まで再証明される。さらに、同じ未解決role集合がHEAD更新を挟んで反復しても停止状態にならず、空結果・誤request・timeoutもproduct findingと同じ`needs_review`へ潰される。

この状態では、Reviewは判断DAGではなく候補HEAD全体の再認証ループとして動き、証跡が増えるほど開発の収束性と経済性が悪化する。

## Story

開発責任者として、各review roleの判断依存を方向付きDAGとして保持し、変更が触れた判断の子孫だけを再評価したい。

それにより、独立レビューの検出力とfail-closed境界を維持したまま、無関係な上流reviewを再実行せず、finding修正はdelta closureで確認し、同じ未解決状態が反復したときは明示的に停止できる。

## Acceptance Criteria

- review artifactは`inspection_surface`、`decision_dependencies`、`invalidation_surface`を区別し、reviewerが参考として読んだだけのファイルを自動的に全て判断依存先へ昇格しない。 <!-- ac:RDCF-001 -->
- roleごとにStory、Spec、Architecture、Implementation、Test、Release等の依存domainを持ち、変更ファイルをそのdomainへ分類してcausal invalidationを判定する。 <!-- ac:RDCF-002 -->
- 実装・テストだけを変更したfixtureでは、`planning_spec:product_requirement`はcurrentのまま再利用され、`implementation:runtime_contract`など下流roleだけがstaleになる。 <!-- ac:RDCF-003 -->
- StoryまたはSpec等の上流正本を変更した場合は、その正本へ依存するroleがstaleになり、因果的に必要なreviewを省略しない。 <!-- ac:RDCF-004 -->
- `strict_head` reviewは従来どおり異なるHEADへ再利用されず、最終認証のfail-closed境界を弱めない。 <!-- ac:RDCF-005 -->
- `needs_changes`または`block` findingを修正した後は、finding IDとclosure evidenceを結ぶdelta closureを記録し、未解決findingが残るpassを拒否する。 <!-- ac:RDCF-006 -->
- reviewerの空結果、誤request、timeout、実行エラーは`runtime_failed`としてproduct findingから分離され、再実行先を明示する。 <!-- ac:RDCF-007 -->
- unresolved role集合、finding ID集合、runtime failure集合からsemantic convergence signatureを作り、review eventが進んでも同じ状態が3 wave続けば`review_nonconvergent`として停止する。単なるstatus pollはwaveとして数えない。 <!-- ac:RDCF-008 -->
- `review status`およびPR向けreview summaryは、causal reuse、invalidation理由、delta closure、runtime failure、convergence状態と次行動を表示する。 <!-- ac:RDCF-009 -->
- 本変更は旧汎用Gate DAG、review budget、automatic merge、release authorityを復活させず、人間・CI・repository rulesの最終権限を維持する。 <!-- ac:RDCF-010 -->

## Non-goals

- Agent Reviewそのものの廃止
- review findingの自動修正
- 全roleの自動pass
- strict HEAD最終認証の緩和
- 旧review lifecycle会計やdelivery-efficiency budgetの復活
- 自動mergeまたは自動release

## 成功指標

- 2ファイルのimplementation/test deltaで、上流planning/requirement roleの再dispatchが0件
- `review_nonconvergent`検出後に同じrole集合を自動再dispatchしない
- runtime failureがproduct finding件数へ混入しない
- finding closure後の再reviewは未解決findingと修正deltaへ限定される
