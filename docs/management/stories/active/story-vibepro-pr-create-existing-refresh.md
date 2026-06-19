---
story_id: story-vibepro-pr-create-existing-refresh
title: 既存PRへの追加コミット後もPR作成artifactを最新headへ更新する
status: active
source:
  type: value_audit
  id: vibepro-value-audit-2026-06-19
architecture_docs:
  - docs/architecture/vibepro-pr-create-existing-refresh.md
spec_docs:
  - docs/specs/vibepro-pr-create-existing-refresh.md
---

# Story

VibeProのPRライフサイクルartifactは、handoffやmain単体監査で「どのheadを根拠にPR判断したか」を復元するための正本である。

直近のself-dogfoodでは、PR作成後に追加コミットを載せた場合、GitHub上のPRは最新headを指す一方で、`.vibepro/pr/<story-id>/pr-create.json` が初回作成時のheadに束縛されたまま残る弱点が見えた。

`vibepro pr create` を再実行したとき、同一base/headの既存open PRがあるなら重複PR作成で失敗して終わるのではなく、既存PRを再利用し、最新headに束縛されたPR作成artifactを再発行する必要がある。

## Acceptance Criteria

- 同一base/headの既存open PRがある場合、`vibepro pr create` は重複PRを作らず既存PRを検出する。
- 既存PR検出時も `.vibepro/pr/<story-id>/pr-create.json` の `current_head_sha` と `artifact_freshness.artifact_head_sha` は現在のローカルheadになる。
- 既存PRのremote head SHAが現在headと一致しない場合、VibeProは最新artifactを成功扱いで残さず失敗する。
- 既存PR検出時、PR本文は最新のVibePro PR bodyで更新される。
- 既存PR refresh の実行経路は `results` と `commands` に残り、handoff先が「作成」ではなく「既存PR更新」だったことを再構成できる。

## Tasks

- [x] `vibepro pr create` に既存PR refresh経路を追加する。
- [x] 既存PR refresh成功時のartifact freshnessをテストで固定する。
- [x] 既存PR remote head不一致時に失敗することをテストで固定する。
- [x] Story/Spec/ArchitectureからPR artifactまでのtraceability evidenceを残す。
