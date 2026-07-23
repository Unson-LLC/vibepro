---
story_id: story-vibepro-surface-aware-agent-review-freshness
title: Surface-aware Agent Review Freshness Architecture
parent_design: vibepro-content-scoped-evidence-freshness
---

# Surface-aware Agent Review Freshness Architecture

## Decision

Agent Review freshnessの既定authorityをrole名やHEAD SHAではなく、review recordに保存した`content_binding.surface_files`と`surface_hash`に統一する。`gate_evidence`と`release_risk`も他roleと同じ`content_surface`既定を使う。

## Freshness State Machine

評価順序は次の通り。

1. content bindingのmodel、surface、missing file、hashを検証する。
2. surface hashが一致する場合はdirty fingerprintを照合してcurrentとする。
3. content bindingを持たないlegacy resultでHEADが変わった場合だけ、#381のmerge-delta判定を行う。

## Fail-closed Boundaries

4. changed filesを解決できない、inspection inputがない、reviewed pathと交差する場合はstaleにする。
5. role policyまたはCLIで理由付き`strict_head`が明示された場合は、HEAD不一致を即staleにする。

release-impactは抽象フラグではなく、`release_risk` reviewerがinspection inputとして列挙したrelease plan、migration、runtime contract、config、rollback/observability sourceをcontent bindingへ含める。これにより責務/契約/release-impactの変更は該当file hashの変更として検出される。

## Compatibility

- 既存content-surface artifactsは同じmodelで評価する。
- content bindingのないlegacy artifactsはmerge-delta判定を維持し、diff不明時はfail closed。
- strict role policyとCLI overrideは維持する。
- review provenance、lifecycle、dirty fingerprintの判定順序とpass条件は変更しない。

## Rollback

`gate_evidence`と`release_risk`のbuilt-in strict mapを復元する。保存済みsurface/hashは引き続き読めるためartifact migrationは不要。
