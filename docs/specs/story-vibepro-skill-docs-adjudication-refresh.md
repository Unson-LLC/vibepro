---
story_id: story-vibepro-skill-docs-adjudication-refresh
parent_design: vibepro-agent-guidance-ssot
---

# Spec: gate進化（adjudication・inconclusive・release guard）をagent Skillsへ反映する

- story_id: story-vibepro-skill-docs-adjudication-refresh
- 正本: `.vibepro/spec/story-vibepro-skill-docs-adjudication-refresh/spec.json`（`vibepro spec write --final` で登録済み）。本ドキュメントはその人間可読ミラー。

## Clauses

| id | type | 内容 |
|---|---|---|
| C-1 | contract | `skills/vibepro-gate-evidence/SKILL.md` が `gate:evidence_adjudication` / `gate:judgment_dag_adjudication` の閉鎖手順（`vibepro adjudicate prepare`（`--judgment`）→ 実装エージェント以外の独立fresh-context subagentへdispatch → `vibepro adjudicate record`（`--judgment`））を記述する |
| C-2 | contract | 同ファイルが verdict語彙（demonstrated / not_demonstrated / not_verifiable_by_automation、judged_sound / judged_unsound / needs_human_judgment）と、decision record（`--source gate:evidence_adjudication:<clause-id>` / `gate:judgment_dag_adjudication:<item-id>`、reason + artifact 必須）による人間閉鎖を記述する |
| C-3 | contract | 同ファイルが adjudication verdict の head-bound fail-closed 性（head_commit 欠落・current HEAD 不明は fresh と数えない）を記述する |
| C-4 | contract | 同ファイルが scanner status の `inconclusive`（検査対象0件はpassの証拠にならない）と `not_applicable` の区別を記述し、inconclusive を pass 扱いしないことを明記する |
| C-5 | contract | `skills/vibepro-workflow/SKILL.md` の Operating Order が pr prepare 後・pr create 前に adjudication gate を閉じるステップを含む |
| C-6 | contract | 同ファイルが Release Surface Guard（`vibepro guard check|install|status`、ブロック時の `pr prepare` 復旧導線、`VIBEPRO_GUARD_BYPASS` の `bypass-log.jsonl` 監査記録）を記述する |
| C-7 | contract | `node bin/vibepro.js skills lint .` が全Skill pass・error/warning 0 を維持する |
| INV-1 | invariant | `CLAUDE.md` と `AGENTS.md` は byte-for-byte 一致のまま、本Storyのdiffに含まれない |

## Diagrams

正本 spec.json の `diagrams[]` に flow（gate閉鎖ワークフロー順序）と state（adjudication verdict lifecycle）を登録済み。

## Verification

- `verify-ac.sh`（27機械チェック、artifact: `.vibepro/evidence-artifacts/ac-verify.json`）が C-1〜C-7 / INV-1 を検証する。
- `vibepro guard check` の block/allow 実挙動 replay（artifact: `.vibepro/evidence-artifacts/e2e-flow-replay.json`）が C-6 記述の正確性を検証する。
