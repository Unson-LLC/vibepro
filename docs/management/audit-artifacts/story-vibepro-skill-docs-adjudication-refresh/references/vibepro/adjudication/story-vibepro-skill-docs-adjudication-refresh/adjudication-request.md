# Evidence Adjudication Request: story-vibepro-skill-docs-adjudication-refresh

- story: docs/management/stories/active/story-vibepro-skill-docs-adjudication-refresh.md
- generated_at: 2026-07-15T02:12:10.797Z

## 裁定者への指示

あなたはこのStoryの実装エージェントとは**独立したfresh contextの裁定者**として起動されている。
実装セッションの文脈・実装者の自己申告・「テストが通った」という事実を成果の代替として受け取らないこと。

- 一次コンテキストは下記のStory受け入れ基準の**原文**である。gate JSONやテスト名ではなく、clauseが記述する成果そのものを基準にする。
- 各clauseについて「下記の証拠はこの成果を実証しているか」を**反証の立場**で検討する。実証していないと言える筋があれば、その筋を優先して検討する。
- 文字列やフィールドの存在確認テストは、人間の理解・判断・行動に関するclauseを実証しない。
- 判定に迷う場合は demonstrated を選ばない。

### verdict語彙（3値）

- `demonstrated`: 紐づく証拠が、このclauseの成果が実際に起きたことを実証している。証拠の観測内容から成果へ推論の飛躍なしに到達できる場合のみ選ぶ。
- `not_demonstrated`: 証拠は存在するが、このclauseの成果を実証していない。文字列・フィールドの存在確認、無関係なテストのpass、成果と接地しない観測はこの判定にする。
- `not_verifiable_by_automation`: このclauseの成果は自動テストでは原理的に検証できず、人間の観測（実利用・実操作・目視確認）が必要。正直にこの判定を選ぶこと自体が正しい成果であり、罰ではない。

### 記録方法

clauseごとに以下を実行する（reasonには判断根拠を具体的に書く）:

```bash
vibepro adjudicate record . --id story-vibepro-skill-docs-adjudication-refresh --clause <clause-id> --verdict <verdict> --reason "<判断根拠>" --agent-system <codex|claude_code> --agent-id <subagent-id> [--session-ref <ref>]
```

## 受け入れ基準 clauses

### AC-1

> `skills/vibepro-gate-evidence/SKILL.md` が `gate:evidence_adjudication` と `gate:judgment_dag_adjudication` の閉鎖手順を記述している: `vibepro adjudicate prepare`（`--judgment`）で依頼文を生成し、実装エージェント以外の独立fresh-context subagentへdispatchし、`vibepro adjudicate record`（`--judgment`）でclause/item毎のverdictを記録する。

### AC-2

> 同ファイルが adjudication のverdict語彙（demonstrated / not_demonstrated / not_verifiable_by_automation、judged_sound / judged_unsound / needs_human_judgment）と、not_verifiable_by_automation / needs_human_judgment を `vibepro decision record --source gate:evidence_adjudication:<clause-id>`（judgment側は `gate:judgment_dag_adjudication:<item-id>`）+ reason + artifact で人間閉鎖する手順を記述している。

### AC-3

> 同ファイルが adjudication verdict のhead-bound fail-closed性（head_commit欠落・current HEAD不明のverdictはfreshと数えない）を記述している。

### AC-4

> 同ファイルが scanner status の `inconclusive`（検査対象0件はpassの証拠にならない）と `not_applicable` の区別を記述し、inconclusiveをpass扱いしないことを明記している。

### AC-5

> `skills/vibepro-workflow/SKILL.md` の Operating Order が adjudication ステップ（pr prepare後・PR create前にadjudication gateを閉じる）を含んでいる。

### AC-6

> `skills/vibepro-workflow/SKILL.md` が Release Surface Guard を記述している: `vibepro guard check|install|status`、ブロック時は `pr prepare` で readiness を回復する導線、bypass は `VIBEPRO_GUARD_BYPASS` 理由付きで `bypass-log.jsonl` に監査記録されること。

### AC-7

> `node bin/vibepro.js skills lint .` が全Skill passのまま維持される。

### AC-8

> `CLAUDE.md` と `AGENTS.md` はbyte-for-byte一致のまま変更されない。

## 記録済み検証証拠

### 証拠 E-1: kind=e2e status=pass

- command: `node bin/vibepro.js guard check . --command 'gh pr create --title test' --story-id story-vibepro-skill-docs-adjudication-refresh (exit 2, decision=block) && node bin/vibepro.js guard check . --command 'git status' ... (exit 0, decision=allow) && node bin/vibepro.js adjudicate prepare/record replay`
- summary: flow_replay / artifact_replay of the workflows the updated Skills document, executed against the real CLI at head 8901e58: Release Surface Guard blocked gh pr create (exit 2) while the story is not ready_for_pr_create and allowed a non-release command; the adjudication workflow (prepare -> independent subagent -> record) was replayed end-to-end and the head amends demonstrated fail-closed head binding (stale verdicts dropped in pr-prepare / gate-dag artifacts).
- observation.targets: .vibepro/evidence-artifacts/guard-check-block.json, .vibepro/evidence-artifacts/guard-check-allow.json, .vibepro/adjudication/story-vibepro-skill-docs-adjudication-refresh/adjudication-request.md
- observation.scenarios:
  - flow_replay: story-vibepro-skill-docs-adjudication-refresh replay of the documented Release Surface Guard workflow — guard check on a release surface command returns decision=block with blocking gates listed while ready_for_pr_create=false; non-release command returns decision=allow (failure mode negative path: blocked release surface observed)
  - artifact_replay: pr-prepare and gate-dag artifacts re-read after each head amend show adjudication verdicts dropped as stale (fail-closed head binding), matching the documented behavior; done_evidence is the machine-readable e2e-flow-replay.json generated from real exit codes
  - scenario_clause_e2e: spec clause C-6 (Release Surface Guard documentation) validated against live CLI behavior; spec clause C-1 (adjudication closure procedure) validated by replaying adjudicate prepare/record for story-vibepro-skill-docs-adjudication-refresh ac:6 ac:1
- observation.values: status=pass, exit_code=0, guard_block_exit=2, guard_allow_exit=0, adjudication_head_binding=fail_closed_observed
- artifact: .vibepro/evidence-artifacts/e2e-flow-replay.json

### 証拠 E-2: kind=unit status=pass

- command: `bash verify-ac.sh (27 mechanical checks: grep contract anchors in changed SKILL.md files + node bin/vibepro.js skills lint . + cmp -s CLAUDE.md AGENTS.md + git diff main...HEAD scope check); exit 0`
- summary: All 27 acceptance checks pass at head 8901e58. skills lint pass=7 error_count=0 warning_count=0. cmp -s CLAUDE.md AGENTS.md exit 0 and neither file appears in the diff. Version stamp: the verification running session recorded git rev-parse HEAD=8901e5822bb0d385a1251301175244dd21255d48 inside the artifact JSON, confirming the running session reads the expected artifact version of the changed SKILL.md docs (docs-only change; no deployed runtime exists).
- observation.targets: skills/vibepro-gate-evidence/SKILL.md, skills/vibepro-workflow/SKILL.md, docs/management/stories/active/story-vibepro-skill-docs-adjudication-refresh.md, docs/specs/story-vibepro-skill-docs-adjudication-refresh.md
- observation.scenarios:
  - contract clause C-1: gate-evidence SKILL.md documents vibepro adjudicate prepare / vibepro adjudicate record / --judgment flow dispatched to an independent fresh-context subagent, never the implementing agent (checks AC-1a..AC-1e pass)
  - contract clause C-2: verdict vocabularies demonstrated / not_demonstrated / not_verifiable_by_automation / judged_sound / judged_unsound / needs_human_judgment and human closure via decision record source gate:evidence_adjudication:<clause-id> and gate:judgment_dag_adjudication:<item-id> are documented (checks AC-2 pass)
  - contract clause C-3: head-bound fail closed rule with head_commit freshness is documented in gate-evidence SKILL.md (checks AC-3a, AC-3b pass)
  - contract clause C-4: scanner conclusiveness inconclusive vs not_applicable distinction documented; inconclusive is never presented as a passing gate (checks AC-4a..AC-4c pass)
  - contract clause C-5: workflow SKILL.md Operating Order step 19 closes the adjudication gates before PR create, naming gate:evidence_adjudication and gate:judgment_dag_adjudication (checks AC-5a, AC-5b pass)
  - contract clause C-6: workflow SKILL.md documents Release Surface Guard commands vibepro guard check|install|status, recovery via rerun vibepro pr prepare, and VIBEPRO_GUARD_BYPASS bypass recorded to bypass-log.jsonl (checks AC-6a..AC-6e pass)
  - contract clause C-7: node bin/vibepro.js skills lint . exits 0 with pass=7 error_count=0 warning_count=0 (checks AC-7a, AC-7b pass)
  - invariant clause INV-1: cmp -s CLAUDE.md AGENTS.md exits 0 and git diff main...HEAD contains neither CLAUDE.md nor AGENTS.md (checks AC-8a, AC-8b pass)
  - path_surface:review_surface documentation-only change: the changed SKILL.md docs and the spec doc mirror are verified by anchor greps and skills lint
  - release_note: the PR body (pr-body.md) is the release note for this docs-only change; its only consumers are agents/maintainers of this repo. rollback_instruction: single git revert of the one docs commit restores the previous Skill text, declared owner-visibly in story frontmatter reason.rollback and the spec doc mirror. observability_evidence: e2e-flow-replay.json and guard-check-block/allow.json give owner-visible evidence of the documented guard behavior; no runtime observability change is needed because nothing deploys (docs-only).
- observation.values: status=pass, exit_code=0, surface=review_surface, skills_lint=pass_7_error_0_warning_0, cmp_claude_agents=identical, checks_passed=27, rollback_instruction=single_git_revert_of_docs_commit, release_note=pr_body, observability_evidence=e2e_flow_replay_artifacts
- artifact: .vibepro/evidence-artifacts/ac-verify.json

