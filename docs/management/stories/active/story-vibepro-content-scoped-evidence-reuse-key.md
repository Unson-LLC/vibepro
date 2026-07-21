---
story_id: story-vibepro-content-scoped-evidence-reuse-key
title: Evidence reuse keyをhead束縛からcontent surface束縛へ移す
status: active
view: dev
period: 2026-07
category: quality
related_stories:
  - story-vibepro-content-scoped-evidence-freshness
  - story-vibepro-trusted-delivery-efficiency-guardrail
  - story-vibepro-review-finding-repair-loop
  - story-vibepro-automation-evidence-reuse-signal
reason: "review freshness判定は#285でcontent-scoped化済みだが、evidence reuse keyがhead_shaと検証timestampを含むため修正コミットごとに全ロールのreuseがmissし、全パネル再レビューが発火する。key構成の変更に限定し、strict HEAD role（gate_evidence / release_risk）の保守的な再レビュー方針は変えない。rollback: key構成をrevertすれば従来のhead束縛reuseへ戻る。"
created_at: 2026-07-21
updated_at: 2026-07-21
---

# Evidence reuse keyをhead束縛からcontent surface束縛へ移す

## User Value

修正コミットがreview対象surfaceに触れていない場合、既存のpass済みreview・verification証跡を安全に再利用でき、Storyあたりのsubagent再スポーンとfresh input tokenを減らせる。

## Background（計測事実）

- 2026-07-07〜07-21のcodexセッションログ全件集計（7,690セッション）で、非キャッシュ入力13.9B tokens・出力1.0B tokensのうち96%がVibePro駆動のsubagentレビュー波だった。
- 同一Storyでレビューパネルが `story9_ux` → `story9_ux_final` → `story9_ux_postfix` → `story9_ux_c142` → `story9_ux_head0cd` とコミットごとに全ロール再実行されている。
- 根本原因は `src/evidence-reuse.js` の `buildEvidenceKeyInputs` が `head_sha` / `head_ref` / `verification_command_timestamps` / `verification_evidence_updated_at` をkeyに含むこと。修正コミットや検証再実行のたびにkeyが変わり、内容が不変のsurfaceに対するreuseもmissする。
- `story-vibepro-content-scoped-evidence-freshness`（#285）はreview statusのfreshness判定をcontent-scoped化したが、reuse keyは未対応のまま残った。

## Acceptance Criteria

- [ ] CRK-S-1: evidence reuse keyから `head_sha` / `head_ref` と壁時計timestamp（`verification_command_timestamps` / `verification_evidence_updated_at`）を除外し、ロールごとのinspected content surface digest（content-binding由来）で構成する。
- [ ] CRK-S-2: 修正コミットがsurface Xだけに触れた場合、inspected surfaceがXと交差するロールのみreuseがmissし、交差しないロールのpass済みreviewはhitとして再利用される。
- [ ] CRK-S-3: built-in strict HEAD role（`gate_evidence` / `release_risk`）は従来どおりhead変更で再レビューされ、本Storyの対象外として挙動が変わらない。
- [ ] CRK-S-4: `spec_fingerprint` / `risk_surface_fingerprint` / `planner_version` の変更は従来どおり全ロールのreuseを無効化する（安全側の既存挙動を維持）。
- [ ] CRK-S-5: evidence-reuse.jsonにロール別のhit/miss理由（どのsurface digestが変わったか）が記録され、監査から再構成できる。
- [ ] CRK-S-6: contract testで「同一content・異なるhead_sha → hit」「inspected surface変更 → 該当ロールのみmiss」「spec drift → 全miss」を固定する。

## Non Goals

- レビューロール構成・stage構成の変更。
- strict HEAD role方針やadjudication挙動の変更。
- delivery efficiency guardrail（PR #370）のbudget・dispatch authorization仕様の変更。
