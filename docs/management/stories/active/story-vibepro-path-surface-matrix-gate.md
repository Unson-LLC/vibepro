---
story_id: story-vibepro-path-surface-matrix-gate
title: 入力からユーザー表示までのPath Surface MatrixをGate化する
view: dev
period: 2026-06
source:
  type: codex-log-audit
  id: VP-EJD-AUDIT-004
  title: "Review logs found data persisted in one artifact but not proven on report/HQ/user surfaces"
architecture_docs:
  - ../../../architecture/vibepro-path-surface-matrix-gate.md
spec_docs:
  - ../../../specs/vibepro-path-surface-matrix-gate.md
status: active
created_at: 2026-06-04
updated_at: 2026-06-04
---

# 入力からユーザー表示までのPath Surface MatrixをGate化する

## 背景

直近レビューでは、DBや中間artifactには新しい候補値が存在する一方で、summary/report/HQ reviewなどユーザーが見るsurfaceに届いている証跡がないため `needs_changes` になった。

この種の不備は「データは作ったが、ユーザー価値として届いていない」問題であり、熟練エンジニアは入力、保存、変換、表示、運用確認の経路を一本のpathとして確認する。VibeProにはmandatory review lensとして `path_surface_coverage` があるが、現状はreviewerの判断に依存しているため、DAG側でも構造化したmatrixを持つ必要がある。

## User Story

**As a** VibeProで複数surfaceをまたぐ変更を検証する開発者
**I want to** 入力から永続化、中間artifact、API、UI、report、PR bodyまでの到達証跡をmatrixで確認したい
**So that** 一部surfaceだけの証跡でユーザー導線全体が完成したと誤判定しない

## 方針

- `gate:path_surface_matrix` を追加し、変更で生まれる値または状態の経路をmatrixとして出す。
- matrix列は route に応じて `input`, `transform`, `persistence`, `api`, `ui`, `report`, `review_surface`, `operations` から選ぶ。
- 各cellは evidence ref、status、根拠、未確認理由を持つ。
- mandatory review lensの自由記述と接続し、reviewerが指摘したpath gapを次回DAGで再検出できる形にする。

## 受け入れ基準

- [ ] `gate-dag.json` に `gate:path_surface_matrix` が出る
- [ ] 変更対象の値または状態ごとにpath rowが生成される
- [ ] DBまたは中間artifactだけに証跡があり、ユーザー向けsurfaceが未確認の場合は `partial_surface` になる
- [ ] UI/report/APIを変更するPRでは、該当surfaceのcurrent evidenceがない限りpassしない
- [ ] Agent Reviewの `path_surface_coverage` findingをmatrix row/cellに紐づけられる
- [ ] PR bodyにpath gapが短く表示され、人間が「どこまで届いたか」を読める
- [ ] docs-only変更ではmatrixをcritical化せず、変更surfaceがないことを明示する
- [ ] 回帰テストは、persistence-only、api-only、full-path、report-missingのケースを含む

## 非目標

- アプリ固有の全画面マップをVibeProが手書き管理すること
- screenshotの画像内容を完全自動判定すること
