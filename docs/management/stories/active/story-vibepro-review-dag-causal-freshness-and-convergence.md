---
story_id: story-vibepro-review-dag-causal-freshness-and-convergence
title: Review DAGを因果的freshnessと進展感知型収束制御へ変更する
status: active
view: dev
---

# Review DAGを因果的freshnessと進展感知型収束制御へ変更する

## 背景

外部リポジトリの実装トレースで、候補HEADの2ファイルだけを修正した後に、21 review role中16 roleがstaleとなり、レビュー証跡の再生成がProgram進行を長時間占有した。

レビューは実際の契約矛盾や権限不足を発見しており、独立レビュー自体を削除するのは誤りである。一方、現在は「reviewerが読んだ全ファイル」をfreshness依存先として扱うため、実装だけの変更でもproduct requirementやarchitectureなど上流判断まで再証明される。さらに、HEAD更新・status poll・review完了を区別せず、findingの内容や証拠が改善したかを見ない単純な反復制限では、正しい段階的修復まで`review_nonconvergent`として誤停止し得る。

空結果・誤request・timeoutもproduct findingと同じ`needs_review`へ潰されるため、Orchestratorは「製品を直す」「review runtimeを再試行する」「自動再dispatchを停止する」を区別できない。

この状態では、Reviewは判断DAGではなく候補HEAD全体の再認証ループとして動き、証跡が増えるほど開発の収束性と経済性が悪化する。

## Story

開発責任者として、各review roleの判断依存を方向付きDAGとして保持し、変更が触れた判断の子孫だけを再評価したい。

それにより、独立レビューの検出力とfail-closed境界を維持したまま、無関係な上流reviewを再実行せず、finding修正はdelta closureで確認し、実際の進展がないreview waveだけを数えて有限に停止できる。

## Acceptance Criteria

- review artifactは`inspection_surface`、`decision_dependencies`、`invalidation_surface`を区別し、reviewerが参考として読んだだけのファイルを自動的に全て判断依存先へ昇格しない。記録済み`invalidation_surface`は後続のreuse判定で実際に使用される。 <!-- ac:RDCF-001 -->
- roleごとにStory、Spec、Architecture、Implementation、Test、Release等の依存domainを持ち、変更ファイルをそのdomainへ分類してcausal invalidationを判定する。分類不能な変更、またはchanged-file deltaを解決できない状態では`causal_reuse`せずfail closedにする。 <!-- ac:RDCF-002 -->
- 実装・テストだけを変更したfixtureでは、`planning_spec:product_requirement`はcurrentのまま再利用され、`implementation:runtime_contract`など下流roleだけがstaleになる。 <!-- ac:RDCF-003 -->
- StoryまたはSpec等の上流正本を変更した場合は、その正本へ依存するroleがstaleになり、因果的に必要なreviewを省略しない。 <!-- ac:RDCF-004 -->
- `strict_head` reviewは従来どおり異なるHEADへ再利用されず、最終認証のfail-closed境界を弱めない。 <!-- ac:RDCF-005 -->
- `needs_changes`または`block` findingを修正した後は、finding ID、fix HEAD、closure evidence、changed pathを結ぶdelta closureを記録し、未解決findingが残るpassを拒否する。 <!-- ac:RDCF-006 -->
- reviewerの空結果、誤request、timeout、実行エラーは`runtime_failed`としてproduct findingから分離され、runtime retryが成功した場合はproduct defect loopとして数えない。 <!-- ac:RDCF-007 -->
- 完了したreview recordからevent cursorを作り、HEADだけの変更や同じstatusのpollをreview waveとして数えない。 <!-- ac:RDCF-008 -->
- 進展signatureは、unresolved role、findingの内容・状態遷移、inspection evidence、judgment delta、invalidation surface、repair delta、runtime stateを含む。signatureが変わればno-progress counterを0へ戻し、変化のない完了review waveが3回続いた場合だけ`review_nonconvergent`へ遷移する。 <!-- ac:RDCF-009 -->
- `review status`およびPR向けreview summaryは、causal reuse、invalidation理由、delta closure、runtime failure、wave count、no-progress count、進展理由、convergence状態と次行動を表示する。 <!-- ac:RDCF-010 -->
- `review_nonconvergent`では通常の`review prepare`が自動再dispatch対象を返さず停止する。明示的な人間指示でroleを指定したretryだけは許可する。 <!-- ac:RDCF-011 -->
- 本変更は旧汎用Gate DAG、review budget、automatic merge、release authorityを復活させず、人間・CI・repository rulesの最終権限を維持する。 <!-- ac:RDCF-012 -->

## Non-goals

- Agent Reviewそのものの廃止
- review findingの自動修正
- 全roleの自動pass
- strict HEAD最終認証の緩和
- 旧review lifecycle会計やdelivery-efficiency budgetの復活
- 自動mergeまたは自動release
- CIが実装branchを生成・書換する運用

## 成功指標

- 2ファイルのimplementation/test deltaで、上流planning/requirement roleの再dispatchが0件
- HEAD-only changeとstatus pollでwave countが増えない
- 同じfindingを複数commitで修復し、証拠またはrepair deltaが進展している間は誤停止しない
- `review_nonconvergent`検出後に同じrole集合を自動再dispatchしない
- runtime failureがproduct finding件数へ混入しない
- finding closure後の再reviewは未解決findingと修正deltaへ限定される
