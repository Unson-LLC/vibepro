# Requirement Consistency

| 項目 | 内容 |
|------|------|
| Status | pass |
| Invariants | 16 |
| Scenario Gaps | 0 |
| Contradictions | 0 |
| Scanned Code Files | 0 |
| Requirement Sources | 1 |
| Spec Refs | 1 |
| Architecture Refs | 0 |
| Policy Refs | 0 |
| Domain Contract Refs | 0 |
| Responsibility Authority Matches | 0 |
| Responsibility Authority Unknowns | 0 |
| Structured Inherited Behavior Declarations | 0 |
| Legacy Keyword Resolutions | 0 |

## Invariants

- REQ-INV-001: DRS-S-3: 外部マージcommitが確認できてもcurrent gate/HEAD/check/reviewが不整合ならdeliveryは保持し、reconciliationをreconciliation_requiredにしてCLIを非0終了する。 (story:docs/management/stories/active/story-vibepro-delivery-reconciliation-state.md)
- REQ-INV-002: DRS-S-5: traceabilityのdelivery lifecycleとexecution follow-upが分離され、再調整が必要な実配送を未配送へ巻き戻さない。 (story:docs/management/stories/active/story-vibepro-delivery-reconciliation-state.md)
- REQ-INV-003: current evidence が不足・不整合なら reconciliation は必ず fail closed する。 (story:docs/management/stories/active/story-vibepro-delivery-reconciliation-state.md)
- REQ-INV-004: 本 Story は merge delivery と current evidence reconciliation の境界、およびその境界を壊さず復旧するための atomic recovery substrate だけを所有する。 (story:docs/management/stories/active/story-vibepro-delivery-reconciliation-state.md)
- REQ-INV-005: decision outcome ledger の永続化・promotion は関連 Story の責務であり、ここでは実装しない。 (story:docs/management/stories/active/story-vibepro-delivery-reconciliation-state.md)
- REQ-INV-006: Rationale: 三つの lane は同じPR/base identityと同じdelivery/reconciliation invariantを共有する。 (story:docs/management/stories/active/story-vibepro-delivery-reconciliation-state.md)
- REQ-INV-007: configured PR route と local/linked execution-state authority を同じ identity-bound transaction で同期し、legacy route や unrelated artifact を消費しない。 (story:docs/management/stories/active/story-vibepro-delivery-reconciliation-state.md)
- REQ-INV-008: release_note: delivery と reconciliation を分離し、外部 merge 後に未解決理由と復旧 command を owner-visible JSON として公開する。 (story:docs/management/stories/active/story-vibepro-delivery-reconciliation-state.md)
- REQ-INV-009: 問題時はCLIのexit policyまたはprojection consumerだけを戻し、観測済みmerge commitと隔離済み破損byteを保持して再構成可能にする。 (story:docs/management/stories/active/story-vibepro-delivery-reconciliation-state.md)
- REQ-INV-010: 旧 consumer は additive field を無視でき、upgrade/downgrade 時も保存済み delivery 事実を保持したまま CLI exit policy と projection consumer だけを切り戻す。 (story:docs/management/stories/active/story-vibepro-delivery-reconciliation-state.md)
- REQ-INV-011: DRS-STORY-S-003: Given delivery は確認済みだが gate、HEAD、checks、review のいずれかが不整合のとき、delivery を保持したまま reconciliation を reconciliation_required にし、復旧 command と非0終了を返す。 (story:docs/management/stories/active/story-vibepro-delivery-reconciliation-state.md)
- REQ-INV-012: 同じ fail-closed boundary として、responsibility registry entry に primary_authority.ref がない場合は primary_authority is required を返し、別 authority を推測しない。 (story:docs/management/stories/active/story-vibepro-delivery-reconciliation-state.md)
- REQ-SRC-001: DRS-CONTRACT-001: merge results MUST expose independent delivery and reconciliation (spec:docs/specs/vibepro-delivery-reconciliation-state.md)
- REQ-SRC-002: DRS-CONTRACT-002: an external merge MUST NOT be accepted as delivered unless the GitHub merge (spec:docs/specs/vibepro-delivery-reconciliation-state.md)
- REQ-SRC-003: DRS-CONTRACT-005: state-changing execute merge and execute reconcile commands MUST (spec:docs/specs/vibepro-delivery-reconciliation-state.md)
- REQ-SRC-004: Responsibility authority validation MUST reject a registry entry whose primary_authority.ref is (spec:docs/specs/vibepro-delivery-reconciliation-state.md)

## Scenario Gaps

- なし

## Potential Contradictions

- なし

## Structured Inherited Behavior Declarations

- なし

## Legacy Keyword Resolution Deprecations

- なし

## Requirement Sources

- spec: docs/specs/vibepro-delivery-reconciliation-state.md: Spec

## Responsibility Authority

- status: not_generated
- matched responsibilities: 0
- matched contract clauses: 0
- missing evidence: 0
- stale evidence: 0
- unregistered candidates: 0
