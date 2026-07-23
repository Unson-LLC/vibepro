---
story_id: story-vibepro-surface-aware-agent-review-freshness
title: "Agent Review freshnessを検査surfaceとrelease-impactに束縛する"
status: active
view: dev
period: 2026-07
category: quality
parent_design: vibepro-content-scoped-evidence-freshness
related_stories:
  - story-vibepro-content-scoped-evidence-freshness
  - story-vibepro-merge-delta-review-reuse
  - story-vibepro-codex-detached-completion-inbox
spec_docs:
  - docs/specs/vibepro-surface-aware-agent-review-freshness.md
reason:
  decision: "gate_evidenceとrelease_riskの無条件built-in strict_headを廃止し、記録済みinspection surfaceのcontent hashを既定freshness authorityにする"
  alternatives: "built-in strictを維持してrebase後に全roleを再実行する案は、#381のmerge-delta再利用契約へ到達できず、surface不変時にも判断コストだけを増やすため採用しない"
  compatibility: "content_surface review、content_bindingを持たないlegacy reviewのfail-closed merge-delta判定、理由付きrole policy、理由付きCLI strict overrideを維持する"
  rollback: "built-in strict role mapを復元すれば保存済みcontent bindingを破壊せず従来のHEAD全面束縛へ戻せる"
  boundary: "surfaceの自動推測やdiff解決失敗時の楽観再利用は行わず、reviewerが記録したinspection inputと生成projection lineageをauthorityにする"
created_at: 2026-07-24
updated_at: 2026-07-24
---

# Agent Review freshnessを検査surfaceとrelease-impactに束縛する

## User Story

**As a** 複数セッションでmain更新とrebaseを挟みながらVibePro Storyを進める開発者
**I want** 必須Agent ReviewがHEAD SHAではなく実際に検査したsurfaceとrelease-impactの変化で失効すること
**So that** 無関係なmain advance、rebase、証跡timestamp、予算設定だけで全レビューをやり直さず、安全にPRを完遂できる

## Context and Gap

- PR #285/#338は通常reviewをcontent-surface freshnessへ移したが、`gate_evidence`と`release_risk`を無条件built-in `strict_head`として残した。
- PR #381はHEAD変更後にinspection inputとmerge deltaが非交差ならreviewを再利用する契約を導入した。
- 現在はbuilt-in strict判定がmerge-delta判定より先にHEAD不一致をstaleへするため、両roleだけ#381の契約へ到達しない。
- 本Storyは既存Storyを再利用せず、この残存gapを独立して閉じる。

## Acceptance Criteria

- [ ] SARF-S-1: 他セッションがmainへmergeしてもPR branch HEADが不変なら`gate_evidence`/`release_risk` reviewはcurrentのまま。
- [ ] SARF-S-2: rebase、merge、無関係commitでHEADが変わっても、記録済みinspection surfaceとrelease-impact inputのhashが不変ならreviewを再利用する。
- [ ] SARF-S-3: inspection対象、生成projection lineage、責務/契約、release-impact inputが変わったroleだけstaleになる。
- [ ] SARF-S-4: surface未記録、hash不一致、missing file、changed-files解決不能はfail-closedでstaleになる。
- [ ] SARF-S-5: `gate_evidence`/`release_risk`は既定`content_surface`になり、理由付きrole policyと`--strict-head-binding --strict-head-reason`はHEAD変更でstaleを維持する。
- [ ] SARF-S-6: dirty fingerprint、inspection input、agent provenance、review lifecycleのpass要件は再利用時も維持する。
- [ ] SARF-S-7: content-surface review、legacy/merge-delta review、明示strict overrideの互換性を維持する。
- [ ] SARF-S-8: contract/integration/E2Eでunrelated main advance→rebase/merge→surface不変再利用、surface変更stale、差分不明stale、strict override staleを証明する。

## Inherited Behavior

- PR #381の「HEAD/surfaceが不変なら結果を再利用し、rebaseだけで全面失効させない」契約を拡張し、置き換えない。
- passing reviewに必要なinspection summary/input、judgment delta、agent provenance、closed lifecycleは変更しない。
- generated projectionはcanonical source、renderer、profile、lineage、hashの整合性が崩れた場合にfail closedとする。

## Non Goals

- adjudication verdictのHEAD binding変更。
- verification evidence freshnessの再設計。
- inspection surfaceをreviewer入力なしに推測すること。

## 初期タスク

1. Surface-aware freshness policy
   - `gate_evidence`と`release_risk`のbuilt-in strict例外を削除する
   - 理由付きrole policyとCLI strict overrideを維持する
2. Rebase and fail-closed regression coverage
   - unrelated main advance後のrebase/mergeでsurface不変reviewがcurrentであることを証明する
   - surface変更、差分解決不能、明示strict overrideのstaleを証明する
3. Contract and operator guidance
   - Architecture、Spec、英日guideを新しい既定freshness契約へ同期する
   - #381との差分とrollback boundaryを記録する
