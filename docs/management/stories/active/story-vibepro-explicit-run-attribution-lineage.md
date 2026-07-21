---
story_id: story-vibepro-explicit-run-attribution-lineage
title: "Thread分離に依存せずRun lineageでstory attributionを確定する"
status: active
view: dev
period: 2026-07
category: product
source:
  type: operator_feedback
  title: "Codex DesktopのThreadと内部sessionの対応は公開契約ではなく、利用者によるThread分離を正確な価値監査の前提にできない"
related_stories:
  - story-vibepro-session-attribution-boundary-guard
  - story-vibepro-session-attribution-inference
  - story-vibepro-guarded-run-session-contract
  - story-vibepro-run-context-capsule
parent_design:
  - vibepro-explicit-run-attribution-lineage
created_at: 2026-07-21
updated_at: 2026-07-21
reason: "alternatives considered: require operators to create one Codex Thread per Story (not enforceable and Thread-to-session mapping is not a public contract), keep heuristic inference plus mixed-parent warnings only (honest but cannot establish positive lineage), or propagate VibePro-owned Story/Run identity through dispatch, evidence, and audit artifacts; selected explicit Run lineage with heuristic fallback. compatibility impact: existing session-cost and execution fields remain additive-compatible; sessions outside VibePro continue to report inferred, ambiguous, or unavailable attribution. rollback plan: remove the additive lineage envelope, dispatch/evidence propagation, and run-aware audit resolver while retaining existing guarded Run state and mixed-parent detection. boundary and scope: VibePro may authoritatively identify only work it dispatched or recorded under a validated Run; Thread ids and provider session ids are observations, never authority. shared parent and unmatched activity remain explicit buckets and are never silently assigned to a Story. accepted followups: provider-specific adapters may add stronger observation links without changing the lineage contract."
---

# Thread分離に依存せずRun lineageでstory attributionを確定する

## Problem

現在の価値監査は、Codex session JSONL、cwd、branch、worktree、Story idの文字列、process managerを組み合わせてStory帰属を推定している。`session-attribution-boundary-guard` によりmixed parentの過大帰属は検知できるが、VibeProが実行した作業についても「どのStory/Runがどのagent実行・証跡・session eventを生んだか」という正のlineageは残らない。

Codex DesktopのThreadは利用者向けの会話単位であり、内部sessionとの1対1対応はVibeProが依存できる公開契約ではない。したがって「StoryごとにThreadを分ける」は任意の運用改善にはなっても、正確な監査の成立条件にはできない。

VibeProにはすでにGuarded Runの正本である`story_id`と`run_id`がある。このidentityをagent dispatch、provider observation、verification/review evidence、session-costへ伝播し、VibePro自身が開始・記録した作業だけを明示帰属する。親sessionに複数Storyが混在しても、Story固有event、共有parent overhead、未帰属、replayed contextを混ぜない。

## User Story

**As a** Codex Desktop上で複数Storyを並行して進めるVibePro利用者と価値監査automation  
**I want** Threadや内部sessionの分離方法に依存せず、VibeProが開始・記録した作業のStory/Run lineageが機械可読に追跡されること  
**So that** 複数Storyを含む親sessionでも、実装・検証・review・共有コストを過大帰属せず、後から同じ判断を再構成できる

## Value

- 利用者はCodex Desktopの内部session構造を意識せずに作業できる。
- VibeProが制御したagent実行は、推測ではなくauthoritative RunからStoryへ追跡できる。
- mixed parent sessionでも、共有contextや未帰属eventを単一Storyの価値・工数に押し込まない。
- PR、merge、価値監査が同じStory/Run identityと証跡を参照できる。

## Scope

### 1. Lineage envelope

VibePro-owned executionに、少なくとも次を持つversioned lineage envelopeを定義する。

```json
{
  "schema_version": "0.1.0",
  "story_id": "story-vibepro-example",
  "run_id": "run-20260721T000000Z-1234abcd",
  "dispatch_id": "dispatch-example",
  "provider_run_id": "optional-observation",
  "provider_session_id": "optional-observation",
  "thread_id": "optional-observation",
  "worktree_root": "/authoritative/worktree",
  "branch": "codex/story-vibepro-example",
  "head_sha": "..."
}
```

`story_id`と`run_id`はGuarded Run authorityから取得する。provider/session/Thread識別子は外部観測値であり、Story authorityとして受け入れない。

### 2. Propagation

- Agent Runtime Adapterへのdispatch requestとdispatch journalへlineage envelopeを保存する。
- providerが実行/session idを返す場合、既存Runに観測リンクとしてappendし、別Story/Runへの付け替えを拒否する。
- verification、review、decision、action journalがactive Runからlineageを継承できるようにする。
- evidenceのStory、Run、worktree、HEADがauthorityと矛盾する場合は、黙って補正せずtyped mismatchとして記録を拒否する。

### 3. Run-aware attribution

- `vibepro audit session-cost` にRun-awareな入力経路を追加し、明示`run_id`またはStory配下のRun artifactから関連dispatch/provider/session observationを解決する。
- 帰属の優先順位を `explicit_run_lineage > validated artifact binding > branch/worktree inference > textual heuristic` として機械可読に返す。
- event/token exposureを最低限 `story_attributed`、`shared_parent`、`other_story`、`unattributed`、`replayed_context` に分ける。
- 複数Runに共通するparent context、automation prompt、permissions、world state、帰属不能なtool outputはStoryへ比例配賦しない。

### 4. Decision and handoff surface

- `pr-prepare.json`とRun context capsuleは、使用したlineage source、帰属confidence、shared/unattributedの有無をbounded summaryとして参照できる。
- handoff先はsession transcript全体を再読込せず、Run artifactからStory、dispatch、evidence、provider observationを再構成できる。

### 5. Architecture boundary

- 既存の`src/session-efficiency-audit.js`へRun resolution、lineage validation、provider observationの責務を積み増さない。
- Run lineageのschema/validationとattribution resolutionを独立moduleに置き、session-efficiency auditはevent accountingと公開出力の組み立てに集中させる。
- Agent Runtime Adapter、evidence recorder、context capsuleは同じlineage contractをimportし、個別のStory推定ロジックを持たない。

## Acceptance Criteria

- [ ] ERAL-S-1: Guarded Runから開始されたagent dispatchは、authority由来の`story_id`、`run_id`、`dispatch_id`、worktree/HEAD bindingを持つversioned lineage envelopeを永続化する。
- [ ] ERAL-S-2: provider runtime/session idが得られた場合は同じRunへappend-only observationとして保存され、別Story/Runへの再binding、重複identityの矛盾、古いHEADへの黙示更新をfail closedで拒否する。
- [ ] ERAL-S-3: verification、review、decision、action evidenceはactive Run lineageを継承でき、明示されたStory/Run/worktree/HEADとの不一致をtyped errorとして拒否する。
- [ ] ERAL-S-4: `audit session-cost`は明示Run lineageを最優先し、各帰属結果に`method`、`source_artifact`、`confidence`、`run_id`を返す。Thread id単独ではStoryを確定しない。
- [ ] ERAL-S-5 [S-002]: 2つのStory/Runが同一親sessionに観測されるfixtureで、各Run固有eventは対応Storyへ帰属し、共通parent eventは`shared_parent`、他Story固有eventは`other_story`、残りは`unattributed`へ入り、分類合計が対象event総数と一致する。
- [ ] ERAL-S-6: `shared_parent`、`unattributed`、`replayed_context`はStory token/timeへ自動配賦されず、0または対象Storyの価値として表示されない。
- [ ] ERAL-S-7: VibePro外で開始されたCodex sessionは既存の推定経路を維持し、根拠不足時は`ambiguous`または`unavailable`を返す。利用者へThread分離を要求しない。
- [ ] ERAL-S-8: 既存の`audit session-cost --session-id`出力、Guarded Run schema reader、Agent Runtime Adapter利用者はadditive互換を維持する。
- [ ] ERAL-S-9: Run context capsuleまたはcompact decision indexから、fresh processがStory→Run→dispatch→evidence→provider observationをtranscript本文なしで再構成できる。
- [ ] ERAL-S-10 [AC-10] [S-006]: unit testsはidentity validation・mismatch・shared parent分類・unattributed保持を、E2EはGuarded Run作成からdispatch、evidence、session-cost、handoff再構成までを検証する。
- [ ] ERAL-S-11: lineage schema/validationとRun-aware attribution resolverは`session-efficiency-audit.js`から分離され、既存audit出力との互換testとGraphifyによる責務境界確認がある。

## Attribution Contract

| Bucket | 意味 | Storyコストへの扱い |
|---|---|---|
| `story_attributed` | 明示Run lineageまたはvalidated bindingで対象Storyに確定 | 帰属可能 |
| `shared_parent` | 複数Runに共通し、単一Storyへ決定不能 | 共有として独立表示 |
| `other_story` | 同じ観測範囲内の別Story/Runに確定 | 対象Storyへ含めない |
| `unattributed` | 根拠不足またはmixed outputで決定不能 | 未確認として保持 |
| `replayed_context` | compaction replacementや再掲context | 新規audit evidenceから除外 |

## Non Goals

- Codex Desktop、CLI、IDE側のThread/session管理UIを変更すること。
- 1 Threadまたは1 sessionにつき1 Storyを強制すること。
- VibePro外で開始された全作業へauthoritativeなStory identityを後付けすること。
- shared parent costを任意の比率でStoryへ配賦すること。
- provider transcript、prompt、hidden reasoningをRun artifactへ複製すること。

## Implementation Tasks

0. `[DOC]` Accepted Spec JSONへfailure-mode、current-head Done Evidence、Graphify、scope reviewabilityの識別子と参照を固定する。`split_plan.status=split_recommended`は助言に留め、当StoryのPR数はcurrent independent `pr_split_scope` decisionで確定する（`DOC-ERAL-001`）。
1. `[ARCH]` 既存Guarded RunとAgent Runtime Adapterを基準にlineage envelope、authority、provider observation、mismatch contract、およびsession-efficiency auditから分離するmodule境界をArchitecture/Specへ固定する。
2. `[CORE]` dispatch/action/evidence recorderへlineageの生成・検証・append-only永続化を追加する。
3. `[AUDIT]` session-costへRun resolverと`story_attributed/shared_parent/other_story/unattributed/replayed_context`分類を追加する。
4. `[HANDOFF]` context capsuleとPR decision surfaceへbounded lineage summary/refを追加する。
5. `[QA]` 単一Run、mixed parent、provider id衝突、stale HEAD、VibePro外session、fresh-process handoffのunit/E2E fixtureを追加する。

## Done Evidence

- `DE-ERAL-001-current-head-verification`: 現行HEADにboundされたfocused unit/integration/E2E verification evidence at `.vibepro/pr/story-vibepro-explicit-run-attribution-lineage/verification-evidence.json`; commit後は `node bin/vibepro.js pr prepare . --story-id story-vibepro-explicit-run-attribution-lineage --summary-json` でrefreshする。
- `DE-ERAL-002-current-head-graphify-boundary`: current-head Graphify impact and resolver boundary at `.vibepro/graphify/graph.json`。
- `DE-ERAL-003-scope-reviewability-decision`: current `pr_split_scope` review request/result/lifecycle artifacts are `.vibepro/reviews/story-vibepro-explicit-run-attribution-lineage/gate/review-request-pr_split_scope.md`, `.vibepro/reviews/story-vibepro-explicit-run-attribution-lineage/gate/review-result-pr_split_scope.json`, and `.vibepro/reviews/story-vibepro-explicit-run-attribution-lineage/gate/lifecycle.json`; no SHA-named close-evidence file is part of the SSOT. The current independent `pr_split_scope` decision is authoritative for this Story: one PR, because the owned changes are one coherent Run-attribution contract with no independently reviewable boundary. `split_plan.status=split_recommended` is advisory only.
- `node --test test/run-context-capsule-lineage.test.js` によるfresh-process lineage reconstruction。
- `node --test test/run-lineage.test.js test/session-efficiency-run-lineage.test.js` によるcanonical resolver境界とaudit互換性。
- `node --test test/e2e/story-vibepro-explicit-run-attribution-lineage-main.test.js` による実CLIのmethod/confidence/source artifact/bucketとunavailable/ambiguous可視性。
- 既存session-cost fixtureとの後方互換比較。
- mixed parent fixtureにおける分類総数一致とshared/unattributed非配賦のmachine-readable artifact。
- fresh processからのhandoff再構成結果。
- Agent ReviewとEngineering Judgmentによるauthority boundary、privacy、provider failure modeの確認。

## Machine-readable judgment SSOT

Accepted Spec JSON `docs/specs/story-vibepro-explicit-run-attribution-lineage.vibepro.json` is the machine-readable authority for adjudication. Its `failure_modes[]` identifiers are `FM-ERAL-001` through `FM-ERAL-005`; its `done_evidence[]` identifiers are `DE-ERAL-001` through `DE-ERAL-003`. Evidence is current only when the referenced artifact HEAD binding matches `.vibepro/pr/story-vibepro-explicit-run-attribution-lineage/pr-prepare.json#/git/head_sha`.

The `scope_reviewability` object records the current independent `pr_split_scope` request/result/lifecycle, owner role, one-PR decision, rationale, and Graphify blast-radius source. `split_plan.status=split_recommended` is advisory and cannot override that decision. An adjudicating agent must inspect those linked artifacts and treat a stale review artifact as requiring refresh, not as a current pass.
