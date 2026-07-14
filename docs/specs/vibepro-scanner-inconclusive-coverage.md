---
story_id: story-vibepro-scanner-inconclusive-coverage
title: Scanner Inconclusive Coverage Spec
parent_design: vibepro-scanner-inconclusive-coverage
---

# Spec

機械可読の正本は `docs/specs/story-vibepro-scanner-inconclusive-coverage.vibepro.json`。この文書は人間向け要約。

## Contracts

### SIC-CONTRACT-001: 3状態の分離

findingsベース判定（block / fail / needs_review）は走査件数に関わらず常に優先される。findingsが無い走査0件は、適用対象なら `inconclusive`、適用外なら理由付き `not_applicable` とし、走査0件で `pass` を返すことは許されない。走査1件以上でfindingsが無い場合は従来どおり `pass`。

### SIC-CONTRACT-002: 走査実績の添付

対象スキャナ（flow-design / network-contract / regression-risk）は `scan_coverage`（走査件数・走査root）を結果へ添付し、passが「何を検査した上でのpassか」を監査可能にしなければならない。

### SIC-CONTRACT-003: 既存判定の不変

UI storyの走査0件で出る既存critical finding（FLOW-NO-UI-CODE）による `block`、network-contractのmissing route block、regression-riskのneeds_review等、findingsベースの既存判定（blocking exit code含む）は変更しない。走査1件以上の挙動は完全に従来どおり。

### SIC-CONTRACT-004: 非ブロッキング

`inconclusive` / `not_applicable` はgate DAGのunresolved集計へ入れず、ready判定を変えない。check-packの集計statusは非failing扱いだが `inconclusive_count` を添付し、機械消費者が未検査込みのpassを区別できるようにする。表示（diagnose summary / check packs）では「検査対象を発見できなかった＝合格ではない」を明示してpassと区別する。

## Non Goals

- inconclusiveのブロッキング化（採用実績を見て別Story）
- Next.js以外のフレームワーク規約の自動検出
- 対象3スキャナ以外への展開
