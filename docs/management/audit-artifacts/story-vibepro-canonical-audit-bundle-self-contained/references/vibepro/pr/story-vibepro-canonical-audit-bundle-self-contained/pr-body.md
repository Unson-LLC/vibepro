## このPRで決めたいこと
- このPRで閉じる問い: canonical audit bundleが.vibepro参照を残し、main checkout単体で再構成できない を満たす変更として、Runtime / Contract Docs / Tests の差分をこのPRで受け入れてよいか。
- Story: story-vibepro-canonical-audit-bundle-self-contained - canonical audit bundleが.vibepro参照を残し、main checkout単体で再構成できない
- Engineering Judgment: agent_workflow / dag=agent_workflow_dag / confidence=82% / axes=public_contract,scope_reviewability / suppressed=execution_topology[insufficient_signal]
- PR Route: runtime_change / body=runtime_contract_review / confidence=70% / required=decision_question, story_or_source_of_truth, gate_status, verification_or_waiver
- 判断: VibePro Gate上はPR作成可能。人間レビューでは設計判断・スコープ・運用影響を確認する。
- レビュー入口: Runtime / Contract Docs / Tests
- Gate状況: 未解決の必須Gateはありません。レビューでは差分の妥当性とスコープを確認してください。
- 管理worktree: disabled
- Scope判断: reviewable: current branchのままPR化可能 / split=keep_current_pr
- 変更規模: 7 files

### Engineering Judgment の判断過程
このPRは、単なる差分量ではなく「何を壊してはいけない変更か」で読みます。入力と差分シグナルから `agent_workflow` として読み、Senior first scanで必要な判断axisを複数active化しました。

#### 判断した入力
- 目的: canonical audit bundleが.vibepro参照を残し、main checkout単体で再構成できない
- 正本: [docs/management/stories/active/story-vibepro-canonical-audit-bundle-self-contained.md](https://github.com/Unson-LLC/vibepro/blob/feat/vibepro-canonical-audit-bundle-self-contained-final/docs/management/stories/active/story-vibepro-canonical-audit-bundle-self-contained.md)
- 差分面: runtime 2件 / contract docs 3件 / tests 2件を変更
- PR Route: runtime_change / body=runtime_contract_review / confidence=70% / required=decision_question, story_or_source_of_truth, gate_status, verification_or_waiver

#### 判断シグナル
- `surface:agent_or_gate_workflow`: agent/gate/review/DAGの判断面に触れるため、tool boundaryと証跡ライフサイクルを確認する。
- `risk_profile:light`: risk profileは light。証跡量とAgent Review要求の強さを決める入力にする。

#### 共通spineの確認
- intent: passed / surface=story / required=story_intent / evidence=docs/management/stories/active/story-vibepro-canonical-audit-bundle-self-contained.md / matched=story_intent:docs/management/stories/active/story-vibepro-canonical-audit-bundle-self-contained.md / 7 acceptance criterion/criteria or Story intent text found
- current_reality: passed / surface=workflow / required=flow_replay|artifact_replay|scenario_clause_e2e / evidence=node --test test/canonical-audit-self-contained.test.js test/traceability-usage-report.test.js / matched=flow_replay:node --test test/canonical-audit-self-contained.test.js test/traceability-usage-report.test.js / strong / current-bound focused evidence includes recorded observation plus durable artifact / artifact=.vibepro/manual-verification/story-vibepro-canonical-audit-bundle-self-contained/workflow-replay.json, artifact_replay:node --test test/canonical-audit-self-contained.test.js test/traceability-usage-report.test.js / strong / current-bound focused evidence includes recorded observation plus durable artifact / artifact=.vibepro/manual-verification/story-vibepro-canonical-audit-bundle-self-contained/workflow-replay.json, scenario_clause_e2e:node --test test/canonical-audit-self-contained.test.js test/traceability-usage-report.test.js / strong / current-bound focused evidence includes recorded observation plus durable artifact / artifact=.vibepro/manual-verification/story-vibepro-canonical-audit-bundle-self-contained/workflow-replay.json, graph_impact_scope:.vibepro/graphify/graph.json (2 changed / 4 related) / supporting / Graphify narrows impact scope but does not prove runtime correctness / workflow current reality is backed by flow_replay
- invariants: passed / surface=workflow / required=spec_clause|architecture_doc|test_contract / evidence=3 inferred spec clause(s) / matched=spec_clause:3 inferred spec clause(s) / supporting / spec clauses describe the invariant surface, architecture_doc:explicit spec/architecture docs / supporting / architecture/spec docs bound the invariant surface, test_contract:test files in diff / supporting / changed tests indicate intended contract coverage but are not focused proof by themselves, graph_impact_scope:.vibepro/graphify/graph.json (2 changed / 4 related) / supporting / Graphify narrows impact scope but does not prove runtime correctness / High-risk changes need Spec, Architecture, or test evidence for invariants
- boundaries: passed / surface=workflow / required=architecture_doc|decision_record|current_verification / evidence=explicit spec/architecture docs / matched=architecture_doc:explicit spec/architecture docs / supporting / architecture/spec docs describe the relevant boundary, decision_record:decision-1782091673925-54b057e4 / supporting / accepted decision records the boundary rationale, current_verification:git diff --name-only main...HEAD / supporting / current verification is HEAD-bound but lacks a durable artifact, graph_impact_scope:.vibepro/graphify/graph.json (2 changed / 4 related) / supporting / Graphify narrows impact scope but does not prove runtime correctness / Boundary-sensitive changes need architecture/spec, decision, or current verification evidence
- failure_modes: passed / surface=workflow / required=flow_replay|artifact_replay|scenario_clause_e2e / evidence=node --test test/canonical-audit-self-contained.test.js test/traceability-usage-report.test.js / matched=flow_replay:node --test test/canonical-audit-self-contained.test.js test/traceability-usage-report.test.js / strong / current-bound focused evidence includes recorded observation plus durable artifact / artifact=.vibepro/manual-verification/story-vibepro-canonical-audit-bundle-self-contained/workflow-replay.json, artifact_replay:node --test test/canonical-audit-self-contained.test.js test/traceability-usage-report.test.js / strong / current-bound focused evidence includes recorded observation plus durable artifact / artifact=.vibepro/manual-verification/story-vibepro-canonical-audit-bundle-self-contained/workflow-replay.json, scenario_clause_e2e:node --test test/canonical-audit-self-contained.test.js test/traceability-usage-report.test.js / strong / current-bound focused evidence includes recorded observation plus durable artifact / artifact=.vibepro/manual-verification/story-vibepro-canonical-audit-bundle-self-contained/workflow-replay.json / workflow changes need failure-mode evidence matching flow_replay|artifact_replay|scenario_clause_e2e
- done_evidence: passed / surface=workflow / required=flow_replay|artifact_replay|scenario_clause_e2e / evidence=node --test test/canonical-audit-self-contained.test.js test/traceability-usage-report.test.js / matched=flow_replay:node --test test/canonical-audit-self-contained.test.js test/traceability-usage-report.test.js / strong / current-bound focused evidence includes recorded observation plus durable artifact / artifact=.vibepro/manual-verification/story-vibepro-canonical-audit-bundle-self-contained/workflow-replay.json, artifact_replay:node --test test/canonical-audit-self-contained.test.js test/traceability-usage-report.test.js / strong / current-bound focused evidence includes recorded observation plus durable artifact / artifact=.vibepro/manual-verification/story-vibepro-canonical-audit-bundle-self-contained/workflow-replay.json, scenario_clause_e2e:node --test test/canonical-audit-self-contained.test.js test/traceability-usage-report.test.js / strong / current-bound focused evidence includes recorded observation plus durable artifact / artifact=.vibepro/manual-verification/story-vibepro-canonical-audit-bundle-self-contained/workflow-replay.json / workflow changes need done evidence matching flow_replay|artifact_replay|scenario_clause_e2e

#### Senior first scan axes
- public_contract: active_passed / confidence=84% / question=この変更は外部利用者、CLI/API、設定、出力形式、またはPR本文契約を壊さないか。 / required=story_spec_traceability|contract_doc|compat_or_output_test|current_verification / candidates=pr_route:runtime_change, file_group:contract_docs, text:public_contract / active_signals=pr_route:runtime_change, file_group:contract_docs, text:public_contract / precision=active:public_contract activated from 2 non-text corroborating signal(s) / matched=story_spec_traceability:story/spec docs in diff / supporting / story/spec docs exist in the diff and provide traceability, contract_doc:architecture/policy docs in diff / supporting / architecture/policy docs are present for the changed contract surface, topology_diagram:architecture docs in diff / supporting / architecture docs describe topology but are not replay proof, compat_or_output_test:test files in diff / supporting / changed tests signal intent but do not prove focused runtime coverage alone, semantic_invariant_test:test files in diff / supporting / changed tests indicate semantic coverage intent but remain indirect, focused_test:git diff --name-only main...HEAD / supporting / current-bound pass claim lacks a verified durable artifact, so it cannot be strong, focused_test:git diff --name-only main...HEAD / supporting / current-bound pass claim lacks a verified durable artifact, so it cannot be strong, runtime_path_evidence:git diff --name-only main...HEAD / supporting / current-bound pass claim lacks a verified durable artifact, so it cannot be strong, runtime_path_evidence:git diff --name-only main...HEAD / supporting / current-bound pass claim lacks a verified durable artifact, so it cannot be strong, integration_runtime_path:git diff --name-only main...HEAD / supporting / current-bound pass claim lacks a verified durable artifact, so it cannot be strong, integration_runtime_path:git diff --name-only main...HEAD / supporting / current-bound pass claim lacks a verified durable artifact, so it cannot be strong, focused_test:node --test test/canonical-audit-self-contained.test.js test/traceability-usage-report.test.js / strong / current-bound focused evidence includes recorded observation plus durable artifact / artifact=.vibepro/manual-verification/story-vibepro-canonical-audit-bundle-self-contained/workflow-replay.json, focused_test:node --test test/canonical-audit-self-contained.test.js test/traceability-usage-report.test.js / strong / current-bound focused evidence includes recorded observation plus durable artifact / artifact=.vibepro/manual-verification/story-vibepro-canonical-audit-bundle-self-contained/workflow-replay.json, runtime_path_evidence:node --test test/canonical-audit-self-contained.test.js test/traceability-usage-report.test.js / strong / current-bound focused evidence includes recorded observation plus durable artifact / artifact=.vibepro/manual-verification/story-vibepro-canonical-audit-bundle-self-contained/workflow-replay.json, runtime_path_evidence:node --test test/canonical-audit-self-contained.test.js test/traceability-usage-report.test.js / strong / current-bound focused evidence includes recorded observation plus durable artifact / artifact=.vibepro/manual-verification/story-vibepro-canonical-audit-bundle-self-contained/workflow-replay.json, e2e_runtime_path:node --test test/canonical-audit-self-contained.test.js test/traceability-usage-report.test.js / strong / current-bound focused evidence includes recorded observation plus durable artifact / artifact=.vibepro/manual-verification/story-vibepro-canonical-audit-bundle-self-contained/workflow-replay.json, e2e_runtime_path:node --test test/canonical-audit-self-contained.test.js test/traceability-usage-report.test.js / strong / current-bound focused evidence includes recorded observation plus durable artifact / artifact=.vibepro/manual-verification/story-vibepro-canonical-audit-bundle-self-contained/workflow-replay.json, flow_replay:node --test test/canonical-audit-self-contained.test.js test/traceability-usage-report.test.js / strong / current-bound focused evidence includes recorded observation plus durable artifact / artifact=.vibepro/manual-verification/story-vibepro-canonical-audit-bundle-self-contained/workflow-replay.json, flow_replay:node --test test/canonical-audit-self-contained.test.js test/traceability-usage-report.test.js / strong / current-bound focused evidence includes recorded observation plus durable artifact / artifact=.vibepro/manual-verification/story-vibepro-canonical-audit-bundle-self-contained/workflow-replay.json, artifact_replay:node --test test/canonical-audit-self-contained.test.js test/traceability-usage-report.test.js / strong / current-bound focused evidence includes recorded observation plus durable artifact / artifact=.vibepro/manual-verification/story-vibepro-canonical-audit-bundle-self-contained/workflow-replay.json, artifact_replay:node --test test/canonical-audit-self-contained.test.js test/traceability-usage-report.test.js / strong / current-bound focused evidence includes recorded observation plus durable artifact / artifact=.vibepro/manual-verification/story-vibepro-canonical-audit-bundle-self-contained/workflow-replay.json, scenario_clause_e2e:node --test test/canonical-audit-self-contained.test.js test/traceability-usage-report.test.js / strong / current-bound focused evidence includes recorded observation plus durable artifact / artifact=.vibepro/manual-verification/story-vibepro-canonical-audit-bundle-self-contained/workflow-replay.json, scenario_clause_e2e:node --test test/canonical-audit-self-contained.test.js test/traceability-usage-report.test.js / strong / current-bound focused evidence includes recorded observation plus durable artifact / artifact=.vibepro/manual-verification/story-vibepro-canonical-audit-bundle-self-contained/workflow-replay.json, focused_test:node --test test/canonical-audit-self-contained.test.js test/traceability-usage-report.test.js / supporting / current-bound pass claim lacks a verified durable artifact, so it cannot be strong / artifact=.vibepro/manual-verification/story-vibepro-canonical-audit-bundle-self-contained/focused.tap, runtime_path_evidence:node --test test/canonical-audit-self-contained.test.js test/traceability-usage-report.test.js / supporting / current-bound pass claim lacks a verified durable artifact, so it cannot be strong / artifact=.vibepro/manual-verification/story-vibepro-canonical-audit-bundle-self-contained/focused.tap, current_verification:git diff --name-only main...HEAD / supporting / current verification is bound to HEAD but lacks a durable artifact, scope_reviewed:scope.status=reviewable / supporting / scope classification says the current diff is reviewable, graph_impact_scope:.vibepro/graphify/graph.json (2 changed / 4 related) / declared / strength was not classified / optional=graph_impact_scope:.vibepro/graphify/graph.json (2 changed / 4 related) / supporting / Graphify narrows impact scope but does not prove runtime correctness
- scope_reviewability: active_accepted_followup / confidence=78% / question=このPRは1人のreviewerが一貫した判断として読める粒度か、分割すべきか。 / required=scope_reviewed|split_plan|review_owner_map|graph_impact_scope|decision_record / candidates=graphify:related_files / active_signals=graphify:related_files / precision=active:scope_reviewability activated from 1 non-text corroborating signal(s) / matched=story_spec_traceability:story/spec docs in diff / supporting / story/spec docs exist in the diff and provide traceability, contract_doc:architecture/policy docs in diff / supporting / architecture/policy docs are present for the changed contract surface, topology_diagram:architecture docs in diff / supporting / architecture docs describe topology but are not replay proof, compat_or_output_test:test files in diff / supporting / changed tests signal intent but do not prove focused runtime coverage alone, semantic_invariant_test:test files in diff / supporting / changed tests indicate semantic coverage intent but remain indirect, focused_test:git diff --name-only main...HEAD / supporting / current-bound pass claim lacks a verified durable artifact, so it cannot be strong, focused_test:git diff --name-only main...HEAD / supporting / current-bound pass claim lacks a verified durable artifact, so it cannot be strong, runtime_path_evidence:git diff --name-only main...HEAD / supporting / current-bound pass claim lacks a verified durable artifact, so it cannot be strong, runtime_path_evidence:git diff --name-only main...HEAD / supporting / current-bound pass claim lacks a verified durable artifact, so it cannot be strong, integration_runtime_path:git diff --name-only main...HEAD / supporting / current-bound pass claim lacks a verified durable artifact, so it cannot be strong, integration_runtime_path:git diff --name-only main...HEAD / supporting / current-bound pass claim lacks a verified durable artifact, so it cannot be strong, focused_test:node --test test/canonical-audit-self-contained.test.js test/traceability-usage-report.test.js / strong / current-bound focused evidence includes recorded observation plus durable artifact / artifact=.vibepro/manual-verification/story-vibepro-canonical-audit-bundle-self-contained/workflow-replay.json, focused_test:node --test test/canonical-audit-self-contained.test.js test/traceability-usage-report.test.js / strong / current-bound focused evidence includes recorded observation plus durable artifact / artifact=.vibepro/manual-verification/story-vibepro-canonical-audit-bundle-self-contained/workflow-replay.json, runtime_path_evidence:node --test test/canonical-audit-self-contained.test.js test/traceability-usage-report.test.js / strong / current-bound focused evidence includes recorded observation plus durable artifact / artifact=.vibepro/manual-verification/story-vibepro-canonical-audit-bundle-self-contained/workflow-replay.json, runtime_path_evidence:node --test test/canonical-audit-self-contained.test.js test/traceability-usage-report.test.js / strong / current-bound focused evidence includes recorded observation plus durable artifact / artifact=.vibepro/manual-verification/story-vibepro-canonical-audit-bundle-self-contained/workflow-replay.json, e2e_runtime_path:node --test test/canonical-audit-self-contained.test.js test/traceability-usage-report.test.js / strong / current-bound focused evidence includes recorded observation plus durable artifact / artifact=.vibepro/manual-verification/story-vibepro-canonical-audit-bundle-self-contained/workflow-replay.json, e2e_runtime_path:node --test test/canonical-audit-self-contained.test.js test/traceability-usage-report.test.js / strong / current-bound focused evidence includes recorded observation plus durable artifact / artifact=.vibepro/manual-verification/story-vibepro-canonical-audit-bundle-self-contained/workflow-replay.json, flow_replay:node --test test/canonical-audit-self-contained.test.js test/traceability-usage-report.test.js / strong / current-bound focused evidence includes recorded observation plus durable artifact / artifact=.vibepro/manual-verification/story-vibepro-canonical-audit-bundle-self-contained/workflow-replay.json, flow_replay:node --test test/canonical-audit-self-contained.test.js test/traceability-usage-report.test.js / strong / current-bound focused evidence includes recorded observation plus durable artifact / artifact=.vibepro/manual-verification/story-vibepro-canonical-audit-bundle-self-contained/workflow-replay.json, artifact_replay:node --test test/canonical-audit-self-contained.test.js test/traceability-usage-report.test.js / strong / current-bound focused evidence includes recorded observation plus durable artifact / artifact=.vibepro/manual-verification/story-vibepro-canonical-audit-bundle-self-contained/workflow-replay.json, artifact_replay:node --test test/canonical-audit-self-contained.test.js test/traceability-usage-report.test.js / strong / current-bound focused evidence includes recorded observation plus durable artifact / artifact=.vibepro/manual-verification/story-vibepro-canonical-audit-bundle-self-contained/workflow-replay.json, scenario_clause_e2e:node --test test/canonical-audit-self-contained.test.js test/traceability-usage-report.test.js / strong / current-bound focused evidence includes recorded observation plus durable artifact / artifact=.vibepro/manual-verification/story-vibepro-canonical-audit-bundle-self-contained/workflow-replay.json, scenario_clause_e2e:node --test test/canonical-audit-self-contained.test.js test/traceability-usage-report.test.js / strong / current-bound focused evidence includes recorded observation plus durable artifact / artifact=.vibepro/manual-verification/story-vibepro-canonical-audit-bundle-self-contained/workflow-replay.json, focused_test:node --test test/canonical-audit-self-contained.test.js test/traceability-usage-report.test.js / supporting / current-bound pass claim lacks a verified durable artifact, so it cannot be strong / artifact=.vibepro/manual-verification/story-vibepro-canonical-audit-bundle-self-contained/focused.tap, runtime_path_evidence:node --test test/canonical-audit-self-contained.test.js test/traceability-usage-report.test.js / supporting / current-bound pass claim lacks a verified durable artifact, so it cannot be strong / artifact=.vibepro/manual-verification/story-vibepro-canonical-audit-bundle-self-contained/focused.tap, current_verification:git diff --name-only main...HEAD / supporting / current verification is bound to HEAD but lacks a durable artifact, scope_reviewed:scope.status=reviewable / supporting / scope classification says the current diff is reviewable, graph_impact_scope:.vibepro/graphify/graph.json (2 changed / 4 related) / declared / strength was not classified, review_owner_map:agent review stage/role ownership map / supporting / agent review stages expose an ownership map for review responsibility, decision_record:decision-1782091673925-54b057e4 / supporting / accepted decision provides explicit follow-up rationale / artifact=.vibepro/pr/story-vibepro-canonical-audit-bundle-self-contained/split-plan.json / optional=graph_impact_scope:.vibepro/graphify/graph.json (2 changed / 4 related) / supporting / Graphify narrows impact scope but does not prove runtime correctness / missing=split_plan|graph_impact_scope
- suppressed_candidates: execution_topology[insufficient_signal]:execution_topology has only text-derived candidates; suppressing activation until a changed-path, route, scope, docs, network-contract, or risk-surface corroboration exists

#### 選んだDAGが要求した確認
- Context Acquisition Gate: agentが読むべきrepo/docs/log/graph/current stateを先に集める
- Tool Boundary Gate: どのtool/agentがどの副作用を持つかを分離する
- Delegation Policy Gate: どの段階でどのレビュー/サブエージェントを呼ぶかをDAGに置く
- Evidence Lifecycle Gate: agent/gate/DAG変更では、レビュー証跡が現在の差分に結びつき、missing/stale/timed-out/blockが残っていないことを確認する。
- Human Decision Contract Gate: 最後に人間が判断する問いと根拠をPRに出す

#### 証跡とマージ境界
- 要求証跡: Engineering Judgment Route Gate=passed / Common Judgment Spine Gate=passed / Managed Worktree Gate=not_applicable / Requirement Gate=passed / Unit Gate=passed / Integration Gate=passed / E2E Gate=passed / Agent Review Gate=passed / Network Contract Gate=passed / DAG Connectivity Gate=passed / Judgment Axis: public_contract=passed / Judgment Axis: scope_reviewability=accepted_followup / Evidence Lifecycle Gate=passed
- 判断境界: 必須Gateは閉じています。レビューでは、選ばれたDAGの前提と実差分が一致しているかを最終確認します。

### 判断グラフ
- 目的: canonical audit bundleが.vibepro参照を残し、main checkout単体で再構成できない
- Engineering Judgment: agent_workflow / dag=agent_workflow_dag
- Suppressed Axis Candidates: execution_topology[insufficient_signal]
- PR Route: runtime_change / body=runtime_contract_review
- 正本: [docs/management/stories/active/story-vibepro-canonical-audit-bundle-self-contained.md](https://github.com/Unson-LLC/vibepro/blob/feat/vibepro-canonical-audit-bundle-self-contained-final/docs/management/stories/active/story-vibepro-canonical-audit-bundle-self-contained.md)
- 差分: runtime 2件 / contract docs 3件 / tests 2件を変更（Runtime: [src/canonical-audit.js](https://github.com/Unson-LLC/vibepro/blob/feat/vibepro-canonical-audit-bundle-self-contained-final/src/canonical-audit.js), [src/usage-report.js](https://github.com/Unson-LLC/vibepro/blob/feat/vibepro-canonical-audit-bundle-self-contained-final/src/usage-report.js) / Contract Docs: [docs/management/stories/active/story-vibepro-canonical-audit-bundle-self-contained.md](https://github.com/Unson-LLC/vibepro/blob/feat/vibepro-canonical-audit-bundle-self-contained-final/docs/management/stories/active/story-vibepro-canonical-audit-bundle-self-contained.md), [docs/architecture/vibepro-canonical-audit-bundle-self-contained.md](https://github.com/Unson-LLC/vibepro/blob/feat/vibepro-canonical-audit-bundle-self-contained-final/docs/architecture/vibepro-canonical-audit-bundle-self-contained.md), [docs/specs/vibepro-canonical-audit-bundle-self-contained.md](https://github.com/Unson-LLC/vibepro/blob/feat/vibepro-canonical-audit-bundle-self-contained-final/docs/specs/vibepro-canonical-audit-bundle-self-contained.md) / Tests: [test/canonical-audit-self-contained.test.js](https://github.com/Unson-LLC/vibepro/blob/feat/vibepro-canonical-audit-bundle-self-contained-final/test/canonical-audit-self-contained.test.js), [test/traceability-usage-report.test.js](https://github.com/Unson-LLC/vibepro/blob/feat/vibepro-canonical-audit-bundle-self-contained-final/test/traceability-usage-report.test.js)）
- 証跡: Engineering Judgment passed / Story Source passed / Judgment Spine passed / PR Route passed / PR Body passed / Managed Worktree not_applicable / Requirement passed / Unit passed / Integration passed / E2E passed / Agent Review passed / Network Contract passed / DAG Connectivity passed
- 分割判断: single_pr_ok / keep_current_pr

## 変更内容
- Story文書を更新: docs/management/stories/active/story-vibepro-canonical-audit-bundle-self-contained.md
- アーキテクチャ判断を追加: docs/architecture/vibepro-canonical-audit-bundle-self-contained.md
- 仕様文書を更新: docs/specs/vibepro-canonical-audit-bundle-self-contained.md
- 実装を変更: src/canonical-audit.js, src/usage-report.js
- テストを追加・更新: test/canonical-audit-self-contained.test.js, test/traceability-usage-report.test.js

## なぜこの変更か
- 要求: canonical audit bundleが.vibepro参照を残し、main checkout単体で再構成できない
- 背景: VibeProはmerge後に `docs/management/audit-artifacts/<story-id>/` へ 監査コアartifactを昇格できるようになった。しかし2026-06-22の価値監査では、 最新のEngineering Judgment系Storyで、canonical artifact内の参照が `.vibepro/pr/<story-id>` や `.vibepro/reviews/<story-id>` のまま残り、 canonical `main` checkout上では多数の参照先が存在しなかった。 これは「artifactを保存した」ように見えるが、別engineer/agentがfres
- 要求ID: VP-VALUE-AUDIT-2026-06-22-CANONICAL-SELF-CONTAINED


## レビューしてほしい観点
- Storyの受け入れ基準と実装差分が対応しているか
- 主要ソース差分: src/canonical-audit.js, src/usage-report.js
- テスト差分: test/canonical-audit-self-contained.test.js, test/traceability-usage-report.test.js

## 検証
- [x] `node --test test/canonical-audit-self-contained.test.js test/traceability-usage-report.test.js` - 変更に対応する対象テスト / gate: passed / evidence: .vibepro/manual-verification/story-vibepro-canonical-audit-bundle-self-contained/workflow-replay.json
- [x] `npm run typecheck` - package.json の typecheck scriptでTypeScript/型境界を確認する / gate: passed
- [x] `git diff --name-only main...HEAD` - scope_reviewed split_plan decision_record: single-commit canonical audit bundle Story is reviewable as one PR; evidence: .vibepro/pr/story-vibepro-canonical-audit-bundle-self-contained/verification-evidence.json / gate: passed / evidence: .vibepro/pr/story-vibepro-canonical-audit-bundle-self-contained/verification-evidence.json

## リスク・確認事項
- 特記事項なし

## 明示的にやらないこと
- 変更ファイル外の既存挙動は、このPRの完了保証対象外
- Gate / Agent Review の詳細証跡は監査ログとして残すが、本文上部のレビュー範囲を広げるものではない
- API route / external API contract の追加・置換はスコープ外
- Browser UI の表示・操作体験変更はスコープ外

## レビュアー向け差分分類
- Runtime: 2 files - 実装・実行時挙動の変更: src/canonical-audit.js, src/usage-report.js
- Contract Docs: 3 files - Story / Spec / Architecture / 方針の変更: docs/management/stories/active/story-vibepro-canonical-audit-bundle-self-contained.md, docs/architecture/vibepro-canonical-audit-bundle-self-contained.md, docs/specs/vibepro-canonical-audit-bundle-self-contained.md
- Tests: 2 files - 自動テスト・E2E・検証コード: test/canonical-audit-self-contained.test.js, test/traceability-usage-report.test.js

## 監査ログ
- ここから下は VibePro の機械証跡です。レビュー・マージ判断は上部の判断、変更内容、レビュー観点、検証、リスクを先に確認してください。
- Gate / Agent Review / split plan / 実行メタデータは詳細確認と再現性のために残します。
- 管理worktree: disabled

## 概要
- Story: story-vibepro-canonical-audit-bundle-self-contained - canonical audit bundleが.vibepro参照を残し、main checkout単体で再構成できない
- VibePro scope: reviewable
- PR strategy: current_branch_pr
- 変更ファイル: 7 files

## 背景・要求
- 正本: docs/management/stories/active/story-vibepro-canonical-audit-bundle-self-contained.md
- 要求: canonical audit bundleが.vibepro参照を残し、main checkout単体で再構成できない
- 要求ID: VP-VALUE-AUDIT-2026-06-22-CANONICAL-SELF-CONTAINED

- 背景: VibeProはmerge後に `docs/management/audit-artifacts/<story-id>/` へ 監査コアartifactを昇格できるようになった。しかし2026-06-22の価値監査では、 最新のEngineering Judgment系Storyで、canonical artifact内の参照が `.vibepro/pr/<story-id>` や `.vibepro/reviews/<story-id>` のまま残り、 canonical `main` checkout上では多数の参照先が存在しなかった。 これは「artifactを保存した」ように見えるが、別engineer/agentがfres

## 実装判断
- ADR: ADRあり (docs/architecture/vibepro-canonical-audit-bundle-self-contained.md)
- Scope: reviewable
- Scope理由: current branchのままPR化可能

## Task / Handoff
- Task指定なし

## 受け入れ基準
- `audit-bundle.json` 内の各artifact参照は、canonical pathをprimaryとして持ち、
- canonical bundle内の `review-summary.json` / `review-result-*.json` /
- 解決不能な `.vibepro/...` 参照が残る場合、`audit-bundle.json` に
- handoffに必要な review request、review result、manual verification artifact、
- raw provider log、HTML report、一時dispatch scratch、巨大な途中状態は保存対象外のまま維持する。
- `vibepro usage report` は `handoff_replay_status=blocked` のStoryを
- 回帰テストは、`.vibepro` が存在しないfresh checkout fixtureで、

## 差分分類
- story_docs: 1
- architecture_docs: 1
- specifications: 1
- source: 2
- tests: 2

## 要件整合性
- Requirement Gate: pass - 3 invariants, 0 scenario gaps, 0 contradictions
- 補足: Story/Spec/Architectureと既知の実装分岐に明確な矛盾はありません。
- Requirement Sources: 2
- Spec Sources: 1
- Architecture Sources: 1
- Policy Sources: 0
- Requirement Source: spec:docs/specs/vibepro-canonical-audit-bundle-self-contained.md - Spec
- Requirement Source: architecture:docs/architecture/vibepro-canonical-audit-bundle-self-contained.md - Architecture
- Invariant: audit-bundle.json must expose handoff_replay_status and unresolved references for canonical audit handoff. (inferred_spec:docs/management/stories/active/story-vibepro-canonical-audit-bundle-self-contained.md)
- Invariant: Canonical audit bundle references must prefer canonical_path and copy durable review or verification artifacts needed for handoff replay. (inferred_spec:docs/management/stories/active/story-vibepro-canonical-audit-bundle-self-contained.md)
- Invariant: A missing referenced .vibepro artifact must block handoff replay and surface a usage report fake-value signal. (inferred_spec:docs/management/stories/active/story-vibepro-canonical-audit-bundle-self-contained.md)

## Network Contract
- status: pass
- API client calls: 0
- introduced API client calls: 0
- missing routes: 0
- dynamic routes: 0
- server function replacements: 0
- 問題なし

## Journey Map
- Status: available
- Generated: 2026-06-02T09:26:58.573Z
- Walking skeleton: covered
- Current Story step: -
- Affected release slices: -
- Conflicts: 0
- Open questions: 0

## Agent Review
- status: pass
- required reviews: 1
- unmet required reviews: 0
- checkpoint required reviews: 0
- unmet checkpoint reviews: 0
- parallel dispatch: 1 gate (complete) - vibepro review prepare . --id story-vibepro-canonical-audit-bundle-self-contained --stage gate --role gate_evidence -> .vibepro/reviews/story-vibepro-canonical-audit-bundle-self-contained/gate/parallel-dispatch.md
- PR-final roles passed or not required
- checkpoint roles passed or not required
### Stage Summary
- gate: pass / stale=0 / block=0
### Review Binding
- gate:gate_evidence binding=current / reason=review is bound to the current git state
### Review Artifacts
- gate:gate_evidence (pass) artifact: .vibepro/reviews/story-vibepro-canonical-audit-bundle-self-contained/gate/review-result-gate_evidence.json / history: .vibepro/reviews/story-vibepro-canonical-audit-bundle-self-contained/gate/history/review-result-gate_evidence-2026-06-22T01-23-26.579Z.json, .vibepro/reviews/story-vibepro-canonical-audit-bundle-self-contained/gate/history/review-result-gate_evidence-2026-06-22T01-26-48.462Z.json

## Explore Evidence
- Explore evidence未生成

## Gate DAG
- overall: ready_for_review
- acceptance criteria: 7
- suppressed axis candidates: execution_topology[insufficient_signal]:execution_topology has only text-derived candidates; suppressing activation until a changed-path, route, scope, docs, network-contract, or risk-surface corroboration exists
- story-vibepro-canonical-audit-bundle-self-contained - canonical audit bundleが.vibepro参照を残し、main checkout単体で再構成できない: present (required) - Story source is present
- Architecture Gate: satisfied (required) - ADRあり (docs/architecture/vibepro-canonical-audit-bundle-self-contained.md)
- Spec Gate: present (required) - explicit Spec docs are present (docs/specs/vibepro-canonical-audit-bundle-self-contained.md)
- PR Route Classification Gate: passed (required) - PR route selected: runtime_change; body template: runtime_contract_review
- PR Body Contract Gate: passed (required) - PR body must use runtime_contract_review and expose the route-specific decision contract sections=decision_question,story_or_source_of_truth,gate_status,verification_or_waiver
- Requirement Gate: passed (required) - Story不変条件と変更コードの既知分岐に明確な矛盾は検出されていない
- Agent Review Gate: passed (required) - Required staged agent reviews passed for the current git state
- Network Contract Gate: passed (required) - No broken API client route contracts detected
- Unit Gate: passed (required) - `node --test test/canonical-audit-self-contained.test.js test/traceability-usage-report.test.js`
- Integration Gate: passed (required) - `git diff --name-only main...HEAD`
- E2E Gate: passed (optional) - `node --test test/canonical-audit-self-contained.test.js test/traceability-usage-report.test.js`

## Gate Enforcement
- status: ready_for_review
- completion: Gate証跡が揃っているため、VibePro上は完了扱い可能

## Execution Gate
- status: ready
- pr_create_allowed: true
- blocking_gate_count: 0
- required: none

## AI Agent Handoff
- 目的: Story / Spec / Gate DAG に沿って実装し、未解決Gateを解消する
- 最初に見る: このPR本文、review-cockpit.html、gate-dag.html、split-plan.html
- 未解決Gate: none
- リリース判断Warning: none
- PR分割方針: keep_current_pr
- 注意: scope.status=reviewable は完了承認ではありません。Execution Gateがreadyになるまで証跡を追加してください。

## Flow Verification Evidence
- 未実行: `vibepro verify flow . --base-url <url>` で動線証跡を作成する

## Visual QA Evidence
- 未検出: `.vibepro/qa/<qa-id>/residual-analysis.md` または `*residual*.json` がある場合はPR判断に接続されます

## Completion Quality
- status: ready_for_human_acceptance
- e2e_experience_reach_rate: not_measured
- final_20_auto_closure_rate: not_measured
- visual_qa_pass_rate: not_measured
- human_usable_quality_rate: not_measured
- required: none

## Performance Evidence
- status: not_configured
- reason: このStoryには performanceMetrics が定義されていません

## VibePro refactoring delta
- 前回の同一Story診断runがないため、差分は未算出

## 分割計画
- status: single_pr_ok
- strategy: keep_current_pr
- graphify: 2 matched files / 4 related files
- stacked gates: cumulative=0, final validation required=false
- requirements-ssot: Story / Spec / Architecture / Policy SSOT
  - recommendation: same_pr_allowed
  - files: 3
- runtime-behavior: Runtime behavior and unit coverage
  - recommendation: primary_pr
  - files: 4
  - graph investigation: src/cli.js, src/language.js, src/review-repair.js, src/workspace.js

## VibePro
- latest story run: -
- gate: -
- Engineering Judgment: agent_workflow (agent_workflow_dag)
- PR route: runtime_change (runtime_contract_review)
- PR strategy: current_branch_pr
- runtime: vibepro@0.1.0-beta.0 6700b9ac8c75 feat/vibepro-canonical-audit-bundle-self-contained-final clean (story=story-vibepro-canonical-audit-bundle-self-contained)
