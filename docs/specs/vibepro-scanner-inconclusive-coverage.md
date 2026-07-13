---
story_id: story-vibepro-scanner-inconclusive-coverage
title: Scanner Inconclusive Coverage Spec
parent_design: vibepro-scanner-inconclusive-coverage
---

# Spec

機械可読の正本は `docs/specs/story-vibepro-scanner-inconclusive-coverage.vibepro.json`。この文書は人間向け要約。

## Contracts

### SIC-CONTRACT-001: 3状態の分離

走査0件かつ適用対象は `inconclusive`、走査0件かつ適用外は理由付き `not_applicable`、走査1件以上は既存のfindingsベース判定（pass/fail/block/needs_review）とし、走査0件で `pass` を返すことは許されない。

### SIC-CONTRACT-002: 走査実績の添付

対象スキャナ（flow-design / network-contract / regression-risk）は `scan_coverage`（走査件数・走査root）を結果へ添付し、passが「何を検査した上でのpassか」を監査可能にしなければならない。

### SIC-CONTRACT-003: 既存判定の不変

UI storyの走査0件で出る既存critical finding（FLOW-NO-UI-CODE）、network-contractのmissing route block、regression-riskのneeds_review等、findingsベースの既存判定は変更しない。走査1件以上の挙動は完全に従来どおり。

### SIC-CONTRACT-004: 非ブロッキング

`inconclusive` / `not_applicable` はgate DAGのunresolved集計へ入れず、ready判定を変えない。表示（diagnose summary / check packs）では「検査対象を発見できなかった＝合格ではない」を明示してpassと区別する。

## Non Goals

- inconclusiveのブロッキング化（採用実績を見て別Story）
- Next.js以外のフレームワーク規約の自動検出
- 対象3スキャナ以外への展開
