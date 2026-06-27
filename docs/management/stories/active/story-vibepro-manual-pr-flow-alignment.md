---
story_id: story-vibepro-manual-pr-flow-alignment
title: VibeProマニュアルを短いPR本文とPRライフサイクル運用へ揃える
status: active
source:
  type: operator_request
  id: manual-pr-flow-alignment-2026-06-27
architecture_docs:
  - docs/architecture/vibepro-manual-pr-flow-alignment.md
spec_docs:
  - docs/specs/vibepro-manual-pr-flow-alignment.md
parent_design: vibepro-manual-pr-flow-alignment
---

# Story: VibeProマニュアルを短いPR本文とPRライフサイクル運用へ揃える

## Background

`story-vibepro-concise-pr-body` により、GitHub PR本文は監査ログではなく短い判断ブリーフになった。一方で、README、VibePro workflow skill、human review skill、古いPR本文設計docには、`pr-body.md` にGate DAG / Agent Review / split-plan / runtime metadata を詳細展開する前提が残っている。

このズレは、AIエージェントがPR本文へ詳細証跡を戻したり、HTML artifactを常に存在する前提でレビュー順序を組んだり、PR作成後のCI import / PR refresh / `execute merge` を抜かしたりする原因になる。

## Acceptance Criteria

- README / README.ja / CLI help / review cockpit handoff は、`pr-body.md` を短いGitHub判断ブリーフとして説明し、詳細証跡の正本を `.vibepro/pr/<story-id>/` のJSON artifactとして案内する。
- VibePro workflow skill と human review skill は、`pr-prepare.json`、`decision-index.json`、`evidence-plan.json`、`verification-evidence.json` を優先し、HTML artifactを evidence-depth 依存の任意表示面として扱う。
- 古いPR本文architecture/specは、現行のGitHub本文契約として使わないことを明示し、`vibepro-concise-pr-body` に誘導する。
- CLI spec は、既存PR refresh、CI import後の再prepare/recreate、`execute merge` による `pr-merge.json` とcanonical audit永続化を運用として説明する。

## Non-goals

- PR本文生成ロジックを変更しない。
- Gate DAG、Agent Review、split-planの生成や判定を削除しない。
- 古いhistory docを削除しない。
