---
story_id: story-vibepro-subagent-roi-audit
title: VibePro Subagent ROI Audit Spec
---

# Spec: VibePro Subagent ROI Audit

## Invariants

- SRA-INV-1: ROI監査はGate判定を変更しない。`usage report --subagent-roi` は観測レポートであり、PR作成可否の正本ではない。
- SRA-INV-2: subagent valueの正本は `.vibepro/reviews/**/review-summary.json` とその元になる `review-result-*.json` である。外部ログは補助シグナルとして扱う。
- SRA-INV-3: token/cost実数が未記録でも、lifecycle elapsedとagent provenanceから監査を継続できる。

## Contracts

- SRA-CON-1: `vibepro review record` は `--finding-disposition <finding-id:accepted|rejected|duplicate|deferred|false_positive[:reason]>` と `--resolved-finding <finding-id:ref>` を受け取り、`finding_dispositions[]` として保存する。
- SRA-CON-2: `vibepro review record` は `--agent-input-tokens`, `--agent-output-tokens`, `--agent-total-tokens`, `--agent-cost-usd` を受け取り、`agent_usage` として保存する。`total_tokens` 未指定かつinput/outputがある場合は合算する。
- SRA-CON-3: `vibepro usage report --subagent-roi` は `subagent_roi.summary`, `subagent_roi.by_story`, `subagent_roi.by_review` をJSONに含める。
- SRA-CON-4: ROI集計はCodex/Claude Codeの `parallel_subagent` provenanceだけを対象にする。

## Scenarios

- SRA-SC-1: accepted findingがfollow-up commitで解決されたreviewはhigh value signalとして集計される。
- SRA-SC-2: pass-onlyでfindingもjudgment_deltaもないreviewはwaste signalとして集計される。
- SRA-SC-3: duplicate/false_positive/stale/timed_out reviewはvalue scoreを下げる。
- SRA-SC-4: Codex logに `multi_agent_v1spawn_agent`, `multi_agent_v1wait_agent`, `multi_agent_v1close_agent` があれば補助的なsubagent activityとして表示する。

## Anti-patterns

- SRA-AP-1: findings数だけで価値を断定しない。accepted/resolved/dispositionとmerge判断への寄与を重視する。
- SRA-AP-2: token未記録の既存artifactをROI監査不能として捨てない。
- SRA-AP-3: 外部ログだけでsubagent valueを断定しない。

## Verification

- SRA-V-1: `SRA-CON-1 review record captures finding disposition and agent usage for subagent ROI audit`
- SRA-V-2: `SRA-SC-1 usage report aggregates subagent ROI with VibePro artifacts, optional logs, and localized text`
- SRA-V-3: `npm test`
- SRA-V-4: `npm run typecheck`
