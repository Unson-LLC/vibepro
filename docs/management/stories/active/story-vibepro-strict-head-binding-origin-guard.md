---
story_id: story-vibepro-strict-head-binding-origin-guard
title: "strict HEAD bindingをfrozen final_reviewとrole policy例外に限定する"
status: active
view: dev
period: 2026-08
category: quality
parent_design: vibepro-strict-head-binding-origin-guard
related_stories:
  - story-vibepro-surface-aware-agent-review-freshness
  - story-vibepro-merge-delta-review-reuse
  - story-vibepro-risk-adaptive-validation-sequencing
reason:
  decision: "review recordのstrict_head bindingに正当な由来（active frozen validation sequenceのfinal_review / role policyの明示例外）を要求し、由来のない任意CLI overrideは拒否またはgateを通過できないpolicy violationとして扱う"
  alternatives: "--strict-head-bindingフラグを完全撤去する案は、frozen release candidateへのfinal_review（TOCTOU防止）と独自高リスクroleの正当なstrict化まで塞ぐため採用しない。reasonの文言検査で判定する案は、エージェントが定型文で回避できるため由来の構造的検証に劣り採用しない"
  compatibility: "activeなfrozen validation sequenceが要求するimplementation:runtime_contractのfinal_reviewは引き続きstrict HEADで記録できる。role policyでstrict_headとfreshness_reasonを明示した高リスクroleも維持する。content_surface reviewの鮮度契約（PR #384）は変更しない"
  rollback: "由来検証を無効化するだけで従来の任意CLI override受理へ戻せる。保存済みreview artifactのbinding情報は破壊しない"
  boundary: "frozen final_reviewをcontent_surfaceへ弱めない。実際にsurfaceが変わったreviewの再利用は行わない。binding/inspection input欠落のlegacy evidenceはfail-openにしない。既存artifactの書き換えは行わず、移行診断/警告の表示に留める"
created_at: 2026-08-03
updated_at: 2026-08-03
---

# strict HEAD bindingをfrozen final_reviewとrole policy例外に限定する

## User Story

**As a** content-surface freshness契約（PR #384）の下でVibePro Storyを進める開発者
**I want** `--strict-head-binding`が正当な由来（frozen validation sequenceのfinal_review / role policyの明示例外）を持つ場合だけ受理されること
**So that** エージェントの保守的な任意判断で通常レビューがstrict化され、HEAD変更ごとの全面再レビュー運用が再発しない

## Context and Gap

- PR #384でAgent Review freshnessの既定は`content_surface`になり、無関係なHEAD移動ではレビューが失効しなくなった。
- しかし`vibepro review record --strict-head-binding --strict-head-reason`は任意のstage/roleでCLI overrideとして受理され、CLIはreasonの存在しか検証しない。
- 実タスクで`preview:human_usability`（configured: content_surface）がsource=cli_overrideでstrict化され、HEAD変更ごとの再レビュー運用が再発した。
- frozen release candidateへの`final_review`（マージ対象とレビュー対象の完全一致を要するTOCTOU防止）と、通常レビューの任意strict化が同じフラグで区別されていないのが原因。

## Acceptance Criteria

- [ ] SHBO-S-1: `content_surface`設定の通常role（例: preview:human_usability）への`--strict-head-binding`は無条件のCLI overrideとして受理されず、拒否されるか明示的なpolicy violationとしてgateを通過できない。
- [ ] SHBO-S-2: activeなfrozen validation sequenceが要求する`implementation:runtime_contract`の`final_review`は引き続きstrict HEADで記録できる。
- [ ] SHBO-S-3: role policyで`strict_head`と具体的な`freshness_reason`を明示した独自高リスクroleはstrict bindingを維持できる。
- [ ] SHBO-S-4: `review prepare`と`parallel-dispatch.md`とremediation commandは、通常roleへ`--strict-head-binding`を伝播させない。
- [ ] SHBO-S-5: `pr prepare`はstrict bindingの由来を`validation_sequence` / `role_policy` / rejected `cli_override`として説明する。
- [ ] SHBO-S-6: 既存artifactに「content_surface設定だがsource=cli_overrideでstrict」のreviewがある場合、移行診断または明示warningを出す。
- [ ] SHBO-S-7: 回帰テストで、unrelated HEAD change後もsurface不変の`human_usability`はcurrent、reviewed surface変更後はstale、frozen final reviewの`runtime_contract`はHEAD変更後にstaleであることを証明する。

## Inherited Behavior

- PR #384のcontent-surface freshness契約（surface不変なら再利用、fail-closed staleness）を変更せず、その上にstrict bindingの由来検証を追加する。
- frozen release candidateへの`final_review`のstrict HEAD要求（TOCTOU防止）は維持する。
- binding/inspection input欠落のlegacy evidenceのfail-closed扱いを維持する。

## Non Goals

- frozen release candidateの最終`runtime_contract`レビューをcontent-surfaceへ弱めること。
- 実際に検査surfaceが変わったレビューの再利用。
- verification evidence freshnessの再設計。
- 既存review artifactの書き換え・自動移行。

## 初期タスク

1. Strict binding origin model
   - strict bindingの由来（validation_sequence / role_policy / cli_override）をreview record時に構造的に判定する
   - 由来のないCLI overrideを拒否またはpolicy violation化する
2. Dispatch and reporting alignment
   - review prepare / parallel-dispatch / remediation commandから通常roleへのstrict伝播を排除する
   - pr prepareにstrict binding由来の説明と、cli_override strictの既存artifactへの移行警告を追加する
3. Regression coverage
   - 通常role拒否 / frozen final_review許可 / role policy例外許可 / 由来説明 / 移行警告の回帰テストを追加する
