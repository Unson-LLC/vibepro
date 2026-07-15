---
story_id: story-vibepro-skill-docs-adjudication-refresh
title: gate進化（adjudication・inconclusive・release guard）をagent Skillsへ反映する
status: active
view: dev
period: 2026-07
spec_docs:
  - docs/specs/story-vibepro-skill-docs-adjudication-refresh.md
parent_design: vibepro-agent-guidance-ssot
reason:
  alternatives: CLAUDE.md本体へ追記する案は、thin entrypoint方針（150行上限・詳細はskills/へ）に反するため退けた。新Skillを新設する案は、既存のvibepro-gate-evidence / vibepro-workflowの責務（gate閉鎖手順・ワークフロー順序）と完全に重なり、正本を分散させるため退けた。
  compatibility: 既存セクションへの追記のみで、既存の手順・コマンド記述は変更しない。機械可読artifactへの影響はない（docs-only）。
  rollback: 対象2ファイルのdocs-only変更のため、revert一発で戻せる。runtime影響なし。
  boundary: 対象はskills/vibepro-gate-evidence/SKILL.mdとskills/vibepro-workflow/SKILL.md、本Story doc、Spec docミラー（docs/specs/story-vibepro-skill-docs-adjudication-refresh.md）、およびdesign-ssot.jsonへのtraceability登録（`vibepro design-ssot link`がCLI生成する正規化差分＝既存rootのchild_links backfillを含む。手編集はしない）。CLI実装・他Skill・CLAUDE.md/AGENTS.mdの本文は変更しない。
---

# Story

2026-07-13〜14に、Gate DAGへ3つの実挙動が追加された:

1. **Evidence Adjudication Gate / Judgment DAG Adjudication Gate**（`gate:evidence_adjudication` / `gate:judgment_dag_adjudication`）: AC clauseと判断項目（spine/axes/failure modes）の証拠を、独立したfresh-context subagentが意味的に裁定する。verdictはhead-boundでfail closed。
2. **Scanner inconclusive分離**: 検査対象0件のスキャナ結果は `inconclusive` / `not_applicable` として分離され、passとして扱われない（vacuum pass排除）。
3. **Release Surface Guard**（`vibepro guard`）: story が `ready_for_pr_create=true` でない間、`gh pr create` / `gh pr merge` / deploy系のrelease surfaceコマンドをブロックする。bypassは理由付きで監査ログに記録される。

しかし、エージェントが実際に読む正本Skill（`skills/vibepro-gate-evidence/SKILL.md`、`skills/vibepro-workflow/SKILL.md`）はこれらを一切記述しておらず、エージェントは新gateに初見で遭遇して手探りで解決することになる。gate閉鎖の運用知識をSkillに反映し、初見コストと誤運用（inconclusiveをpass扱いする等）を防ぐ。

## Acceptance Criteria

- `skills/vibepro-gate-evidence/SKILL.md` が `gate:evidence_adjudication` と `gate:judgment_dag_adjudication` の閉鎖手順を記述している: `vibepro adjudicate prepare`（`--judgment`）で依頼文を生成し、実装エージェント以外の独立fresh-context subagentへdispatchし、`vibepro adjudicate record`（`--judgment`）でclause/item毎のverdictを記録する。
- 同ファイルが adjudication のverdict語彙（demonstrated / not_demonstrated / not_verifiable_by_automation、judged_sound / judged_unsound / needs_human_judgment）と、not_verifiable_by_automation / needs_human_judgment を `vibepro decision record --source gate:evidence_adjudication:<clause-id>`（judgment側は `gate:judgment_dag_adjudication:<item-id>`）+ reason + artifact で人間閉鎖する手順を記述している。
- 同ファイルが adjudication verdict のhead-bound fail-closed性（head_commit欠落・current HEAD不明のverdictはfreshと数えない）を記述している。
- 同ファイルが scanner status の `inconclusive`（検査対象0件はpassの証拠にならない）と `not_applicable` の区別を記述し、inconclusiveをpass扱いしないことを明記している。
- `skills/vibepro-workflow/SKILL.md` の Operating Order が adjudication ステップ（pr prepare後・PR create前にadjudication gateを閉じる）を含んでいる。
- `skills/vibepro-workflow/SKILL.md` が Release Surface Guard を記述している: `vibepro guard check|install|status`、ブロック時は `pr prepare` で readiness を回復する導線、bypass は `VIBEPRO_GUARD_BYPASS` 理由付きで `bypass-log.jsonl` に監査記録されること。
- `node bin/vibepro.js skills lint .` が全Skill passのまま維持される。
- `CLAUDE.md` と `AGENTS.md` はbyte-for-byte一致のまま変更されない。

## Non Goals

- CLI実装・gate判定ロジックの変更。
- CLAUDE.md / AGENTS.md 本文への機能記述の追加。
- vibepro-workflow / vibepro-gate-evidence 以外のSkillの更新。
- adjudication・guard・scan-statusの仕様自体の再設計。
