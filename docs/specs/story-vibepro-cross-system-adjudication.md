---
story_id: story-vibepro-cross-system-adjudication
title: Cross-system adjudication requires a different model family than the implementer Spec
status: active
parent_design: story-vibepro-cross-system-adjudication
last_reviewed_root_hash: 1f7acc2880b8117ff6e79685b2bca607346131588374119be28da03d7d428ca3
---

# Cross-system adjudication requires a different model family than the implementer Spec

正本のSpec artifactは `.vibepro/spec/story-vibepro-cross-system-adjudication/spec.json`（clauses: INV-001 / S-001..S-006 / C-001、diagrams: flow / threat_model）。本ファイルはDesign SSOTのlineage束縛用のspec pointerであり、Storyの受け入れ基準・Inherited Behaviorは
`docs/management/stories/active/story-vibepro-cross-system-adjudication.md` を参照する。

## Contract Summary

- INV-001: 強制する重み独立性の軸は agent_system のみ（codex / claude_code）。judgment-DAGの `adjudicate record --judgment` / `adjudicate correct` は、実装エージェントと同一の agent_system を `--allow-same-system <reason>` か accepted `gate:judgment_dag_adjudication:same_system_environment` decision なしに永続化前に拒否する。
- S-001 (AC-1): `adjudicate provenance` が `implementation-provenance.json` に recorded_at / head commit を記録し、未知の agent_system は書き込み前に拒否する。
- S-002 (AC-2): evidence path の `adjudicate record` は同一 agent_system で `same_system` warning のみを付与し、verdict記録をブロックしない。
- S-003 (AC-3): judgment-DAG path は同一 agent_system を永続化前に拒否し、`--allow-same-system` の override reason は append-only `same-system-log.jsonl` と永続化イベントの provenance に記録される。
- S-004 (AC-4): accepted decision record（source `gate:judgment_dag_adjudication:same_system_environment`、reason/artifact必須）が同一システム拒否を warning へ降格する。
- S-005 (AC-5): provenance未記録時は `provenance_missing` warning のみを出し、それ以外は本Story導入前と同じ挙動を保つ。cross-systemの adjudicator は provenance記録済みでも warning もoverride要求も発生しない。
- S-006 (AC-6): premise correction再裁定の既存 same-judge-identity 拒否は、新しいsystemレベルの検査と並存して変更されない。
- C-001: CLI契約 `vibepro adjudicate provenance <repo> --id <story-id> --agent-system codex|claude_code` および `adjudicate record --judgment` / `adjudicate correct` の `--allow-same-system <reason>` 追加。evidence pathには新規必須フラグはない。
