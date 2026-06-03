---
story_id: story-vibepro-gate-artifact-consistency
title: Gate/PR/Review証跡の同一HEAD整合性をhard gate化する
view: dev
period: 2026-06
source:
  type: codex-log-audit
  id: VP-EJD-AUDIT-001
  title: "Engineering Judgment DAG audit found repeated stale and cross-artifact evidence mismatches"
architecture_docs:
  - ../../../architecture/vibepro-gate-artifact-consistency.md
spec_docs:
  - ../../../specs/vibepro-gate-artifact-consistency.md
status: active
created_at: 2026-06-04
updated_at: 2026-06-04
---

# Gate/PR/Review証跡の同一HEAD整合性をhard gate化する

## 背景

直近のCodexレビューでは、実装やテスト自体が通っていても、`gate-dag.json`、PR本文、verification evidence、Agent Review結果が別HEADまたは別dirty fingerprintに紐づいていることで `needs_changes` になったケースが複数あった。

これは熟練エンジニアがPRレビューで最初に疑う「いま見ている証跡は同じ変更に対するものか」という基本確認である。現状はreview agentが発見できているが、Engineering Judgment DAGのhard gateとして一貫して止められていない。

## User Story

**As a** VibeProでPR作成前の証跡を確認する開発者
**I want to** Gate DAG、PR本文、verification evidence、review resultが同一HEADとdirty fingerprintに束縛されていることを機械的に検査したい
**So that** 古い証跡や別worktreeの証跡でPRがready扱いになることを防げる

## 方針

- `vibepro pr prepare` は最終生成物群のartifact bindingを集約する。
- `gate:artifact_consistency` をGate DAGに追加し、同一HEAD、同一dirty fingerprint、生成順序、story id、base/head refの整合性を検査する。
- PR本文のverification rowsはverification evidenceの実データから生成し、手元の表示だけが古い場合も検出する。
- 不整合がある場合は `needs_prepare` または `stale_evidence` としてcritical unresolved gateにする。

## 受け入れ基準

- [ ] `gate-dag.json` に `gate:artifact_consistency` が出る
- [ ] Gate DAG、PR body、verification evidence、Agent Review resultの `head_sha` が一致しない場合、`gate:artifact_consistency` は `stale_evidence` になる
- [ ] dirty fingerprintが一致しない場合、どのartifactが古いかをrequired actionに出す
- [ ] PR本文のverification command/status/evidence sourceがverification evidenceと一致しない場合、PR createを止める
- [ ] `pr prepare` 後にreview recordまたはverification evidenceが更新された場合、古いPR body/gate artifactを検出できる
- [ ] managed worktree modeではworktree id/path/branch/head/dirty fingerprintを整合対象に含める
- [ ] docs-only/light変更でもartifact consistencyは必ずcritical gateとして扱う
- [ ] 回帰テストは、同一HEAD pass、別HEAD stale、別dirty fingerprint stale、PR body mismatchを含む

## 非目標

- すべてのverification commandを再実行すること
- PR本文を人間が手修正した場合の任意差分を意味解析すること
