---
story_id: story-vibepro-bug-diagnosis-dag
title: "Verify-firstの問題解析をVibeProのバグ診断DAGへ統合する"
status: active
created_at: 2026-08-16
updated_at: 2026-08-16
artifact_profile: feature_packet
feature_slug: bug-diagnosis-dag
reason: "alternatives considered: (a) Verify-firstを独立した上位ワークフローとして維持する、(b) 既存の汎用Story診断へ説明文だけを追加する、(c) VibeProを唯一の上位DAGとし、バグ修正Storyにだけ型付き診断契約を組み込む。(c)を選択する。(a)はStory、Spec、Review、PR Gateを迂回でき、(b)は診断runの存在だけでreadinessが通る偽陽性を残す。compatibility impact: 既存のStory、Spec、Graphify、Review、PR Gateと通常のenhancement Storyは変更せず再利用する。旧Verify-first入口はVibeProのbug Storyへ誘導する薄い互換入口とし、独立DAGを作らない。rollback plan: 新しいbug diagnosis contract、DAG接続、互換入口、対応テストと文書を同一コミットでrevertする。永続データ移行はなく、新フィールドは後方互換な追加である。boundary and scope: バグStoryの診断証拠、Pre-Spec Readiness、Execution DAG、検証証拠の意味的結合、互換入口に限定する。Story/Spec/Graphify/Review/PRのSSOT、一般的な検証runner、リリース基盤は再実装しない。"
---

# Story: Verify-firstの問題解析をVibeProのバグ診断DAGへ統合する

## 背景

バグを修正する利用者は、再現、根本原因、回帰テスト、同じ経路での再検証を行っても、それらがStoryとGateへ結合されなければ、単体テストの成功だけで修正済みと誤判定される。

## ユーザー価値

バグ修正Storyを進めるとき、VibeProの一つのDAG上で未完了の診断段階と戻り先が分かり、実際の障害経路を確認するまでPR準備完了にならない。

## 受け入れ条件

- [x] BUG-DAG-AC-001: バグ診断証拠はStory ID、run ID、対象HEAD、診断ノードごとの状態と証拠参照を機械可読かつworktree非依存の保存先に保持し、派生Storyでもbug種別を失わず、各ノードのHEADまたはPR準備時のHEADが対象HEADと一致しなければ拒否する
- [x] BUG-DAG-AC-002: 再現未完了、根本原因未確定、回帰テスト未確認（適用不能の理由がある場合を除く）、または同経路再検証未完了なら実装完了/PR readinessはfail-closedする
- [x] BUG-DAG-AC-003: Execution DAGは再現、発生箇所、条件付き関係分析、前提条件、根本原因、回帰テスト、根本修正、同経路再検証を既存Review/PR Gateの前に接続する
- [x] BUG-DAG-AC-004: unitテストが成功していても実障害経路の再現・再検証証拠がなければ完了にならないことを統合テストで固定する
- [x] BUG-DAG-AC-005: 再検証失敗時は、失敗した前提に対応する診断ノードを `return_to_node` と次の行動として返す
- [x] BUG-DAG-AC-006: 旧Verify-first入口は独立DAGを実行せずVibeProのbug Storyへ誘導し、移行・廃止方針が文書化される

## 対象外

- すべてのバグ修正に本番E2Eを要求すること
- Story、Spec、Graphify、Review、PR Gateの複製
- 独立したリリース基盤や別の巨大DAGの追加

## 実装順

1. バグ診断証拠スキーマとFail-closed条件
2. VibePro Execution DAGへの診断ノード統合
3. unit成功だけでは通らない統合テスト
4. Verify-first互換入口と移行・廃止文書
