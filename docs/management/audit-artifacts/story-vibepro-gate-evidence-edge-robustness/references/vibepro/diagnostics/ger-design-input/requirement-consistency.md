# Requirement Consistency

| 項目 | 内容 |
|------|------|
| Status | pass |
| Invariants | 10 |
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

- REQ-INV-001: buildEvidenceItem は extra が strength / binding_status / artifact_quality を持たない場合に既定値（declared / n/a / unknown）を返し、持つ場合はその値を保持する。 (story:docs/management/stories/active/story-vibepro-gate-evidence-edge-robustness.md)
- REQ-INV-002: buildEvidenceItem は extra の追加フィールド（例: matched_file_count・investigation_files）を結果に保持する。 (story:docs/management/stories/active/story-vibepro-gate-evidence-edge-robustness.md)
- REQ-INV-003: buildDocumentationEvidence 内 add は kind を extra に重複指定しなくても、正しい kind の evidence item を生成する。 (story:docs/management/stories/active/story-vibepro-gate-evidence-edge-robustness.md)
- REQ-INV-004: テストは「ENOTDIR/ENOENT/その他エラーの分岐」「明示 kind/ref が extra に勝つ」「既定値と追加フィールド保持」を含む。 (story:docs/management/stories/active/story-vibepro-gate-evidence-edge-robustness.md)
- REQ-INV-005: safeReaddir が ENOTDIR でも [] を返す（ENOENT と同じ非致命扱い）。 (story:docs/management/stories/active/story-vibepro-gate-evidence-edge-robustness.md)
- REQ-INV-006: salvageの他4編集（auth境界のパスゲート・add(item.kind)・explicit kindsへのnegative_path系追加・ (story:docs/management/stories/active/story-vibepro-gate-evidence-edge-robustness.md)
- REQ-SRC-001: GER-S-004 = INV-GER-4: 既定値の適用と値の保持 (spec:docs/specs/vibepro-gate-evidence-edge-robustness.md)
- REQ-SRC-002: GER-S-005 = SC-GER-5: 記述的extraフィールドの保持＋回避策不要の実証 (spec:docs/specs/vibepro-gate-evidence-edge-robustness.md)
- REQ-SRC-003: ENOTDIRもENOENTと同じ「継続空」状態へ遷移させ、pr-prepare/reconcile workflowをresilientに保つ (spec:docs/specs/vibepro-gate-evidence-edge-robustness.md)
- REQ-SRC-004: salvageの他4編集の取り込み（auth境界パスゲート・command.kind照合はセキュリティ/契約bindingを (spec:docs/specs/vibepro-gate-evidence-edge-robustness.md)

## Scenario Gaps

- なし

## Potential Contradictions

- なし

## Structured Inherited Behavior Declarations

- なし

## Legacy Keyword Resolution Deprecations

- なし

## Requirement Sources

- spec: docs/specs/vibepro-gate-evidence-edge-robustness.md: Gate Evidence Edge Robustness Spec

## Responsibility Authority

- status: not_generated
- matched responsibilities: 0
- matched contract clauses: 0
- missing evidence: 0
- stale evidence: 0
- unregistered candidates: 0
