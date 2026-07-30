---
story_id: story-vibepro-budget-override-residual-findings
title: owner-gated budget override の残余 low finding 2件（fallback 方向性の文書精度 / design root の空登録）を解消する
status: active
view: dev
period: 2026-07
category: architecture
source:
  type: parent_story
  title: "story-vibepro-owner-gated-budget-override の architecture_boundary preflight が挙げ、gate:judgment_axis_public_contract の decision record で residual として受け入れられた low finding 2件への後続対応"
parent_design: story-vibepro-owner-gated-budget-override
related_stories:
  - story-vibepro-owner-gated-budget-override
  - story-vibepro-session-cost-source-health-fail-soft
reason: "alternatives considered: finding 1 は (a) 文書の書き換え（採用） と (b) non-effective override が base より広くならないことをコードで強制する床の追加、の2択。preflight 自身が『in-repo に tighten する override は存在しない（sweep で実証）ため live defect ではなく doc accuracy』と分類しており、(b) は着地したばかりの機能への挙動変更で grandfathered override 16件の digest 互換にも触れるため、最小変更の (a) を採る。将来 tighten 用途が実在した時点で floor 追加を別 Story とする。finding 2 は (a) owned_surfaces にこの Story が統治する src 6ファイルを登録（採用） と (b) architecture+spec 子文書の新規作成。子文書は現存せず、required_child_kinds を埋めるためだけの文書生成は形骸化するため、実在する統治対象 surface の登録のみ行う。compatibility impact: コード挙動の変更なし。design-ssot の reconciliation が当該 root の src 6ファイルの drift を検出できるようになる（従来は root_only_change: needs_review しか返せなかった）。rollback plan: CHANGELOG/コメントの文言 revert と design-ssot.json の root エントリの owned_surfaces を空配列へ戻すだけで単独 revert 可能。boundary and scope: 対象は CHANGELOG.md の Unreleased 段落、src/delivery-efficiency-guardrail.js の resolveEfficiencyPolicyDecision 直前コメント、design-ssot.json の vibepro-owner-gated-budget-override root のみ。override の実挙動・digest・grandfather 判定は変更しない。"
created_at: 2026-07-30
updated_at: 2026-07-30
---

# owner-gated budget override の残余 low finding 2件を解消する

## Background（実測）

`story-vibepro-owner-gated-budget-override` の architecture_boundary preflight は
low finding を2件挙げ、decision record で residual として受け入れられた
（`.vibepro/reviews/story-vibepro-owner-gated-budget-override/architecture_spec/review-result-architecture_boundary.json`）。

**Finding 1: fallback 方向性の文書精度。**
CHANGELOG.md の Unreleased 段落は、未承認 override が「base budget — the tighter
one — に落ちる。It never fails open」と消費者に告げている。しかし
`resolveEfficiencyPolicyDecision`（src/delivery-efficiency-guardrail.js）は
non-effective override に対して値の大小比較なしに `base` を返し、
`normalizeEfficiencyPolicy` も床を課さない。override で limit を**絞っていた**
消費者 repo は、upgrade で黙って緩い base に戻る＝その段落が対象とする読者に
とってまさに fail open になる。同じ主張がソースコメント（同ファイル
`resolveEfficiencyPolicyDecision` 直前）にもある。in-repo に tighten する
override は存在しない（sweep 実証済み）ため live defect ではなく文書精度の問題。

**Finding 2: design root の空登録。**
design-ssot.json は `vibepro-owner-gated-budget-override` を
`owned_surfaces: []`, `required_child_kinds: []`, `children: {}` の design_root
として登録している（112 root 中この形は2件のみ）。空の required set に対する
`missing_required_child: block` と owned surface ゼロでは、reconciliation は
`root_only_change: needs_review` しか返せず、この Story が統治する src 6ファイル
（agent-review.js / budget-override-authority.js / cli.js / decision-records.js /
delivery-efficiency-guardrail.js / pr-manager.js）の drift を検出できない。

## Acceptance Criteria

- BRF-S-1: CHANGELOG.md の当該段落が、fallback を「方向を問わず base policy に
  戻る」と正確に記述し、「tighter」「never fails open」という方向性の保証を
  無条件には主張しない。tighten 用途の override を書いていた消費者への影響
  （base の方が緩い場合は緩くなる）が明示される。
- BRF-S-2: src/delivery-efficiency-guardrail.js のソースコメントが同様に、
  base への fallback は方向を保証しないことを正確に述べる。
- BRF-S-3: design-ssot.json の `vibepro-owner-gated-budget-override` root が、
  (a) この Story の統治する src 6ファイルを `owned_surfaces` に宣言し、
  (b) `docs/architecture/vibepro-owner-gated-budget-override.md` を required な
  architecture child として `children` / `child_links` /
  `required_child_kinds` に持つ。reconciliation は child_links を通じて
  drift（missing_required_child / frontmatter_gap / stale_child_review）を
  検出するため、child link の追加によって root は
  `root_only_change: needs_review` しか返せない不活性状態から脱する
  （owned_surfaces は reconciliation には読まれない宣言的メタデータであり、
  統治対象の記録として登録する）。
- BRF-S-4: override の実挙動（authority 判定・digest・grandfather・merge 順）は
  一切変更しない。既存テストが全て green のまま。The existing fallback branch
  where authority.status !== 'authorized' && authority.status !== 'grandfathered'
  returns the base policy is unchanged/existing behavior, declared as
  inherited_behavior on spec clause INV-001.
