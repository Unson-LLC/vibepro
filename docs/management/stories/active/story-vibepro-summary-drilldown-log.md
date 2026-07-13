---
story_id: story-vibepro-summary-drilldown-log
title: "summary-first と深掘り理由の記録"
status: active
parent_design: vibepro-summary-drilldown-log
view: dev
period: 2026-07
source:
  type: value_audit_followup
  id: VP-FAKE-VALUE-STORY-4
architecture_docs:
  - docs/architecture/vibepro-summary-drilldown-log.md
spec_docs:
  - docs/specs/vibepro-summary-drilldown-log.md
reason: "full artifact の暗黙投入は判断 token を浪費するため summary-first とし、必要な深掘りだけを理由・consumer・target・HEAD に結び付ける。既存 artifact は正本として維持し、summary に戻せばロールバックできる。"
created_at: 2026-07-13
updated_at: 2026-07-13
---

# Story

VibePro は限定 view を提供しているが、通常のコード変更では `standard` が既定であり、full JSON/HTML を暗黙に生成できる。深掘り時も対象 artifact を記録しないため、後から「何を、なぜ読ませたか」を再構成できない。

## User Story

**As a** VibePro の証跡をレビュー agent に渡す engineer  
**I want to** summary を標準入力にし、深掘りした対象と理由だけを記録したい  
**So that** risk detection を維持しながら stale/irrelevant evidence の再投入を抑制できる

## Acceptance Criteria

- [x] source/high-risk を含む `pr prepare` も既定 depth は `summary` で、risk surface は compact plan/index に残る。
- [x] `standard` / `full` の明示要求は reason、consumer、1件以上の target が揃わなければ失敗する。
- [x] 明示深掘りは `.vibepro/pr/<story-id>/evidence-drilldown-log.json` に depth、target、reason、consumer、HEAD、risk surface を追記する。
- [x] 同一 Story の再実行で既存 ledger entry を消さず、深掘りをしていない summary 実行は entry を捏造しない。
- [x] README と CLI help が summary-first と `--evidence-depth-target` の契約を説明する。

## Non Goals

- canonical full artifact の保存禁止。
- risk-bearing gate や Engineering Judgment の省略。
- agent が実際に artifact を読んだという telemetry の推測。
