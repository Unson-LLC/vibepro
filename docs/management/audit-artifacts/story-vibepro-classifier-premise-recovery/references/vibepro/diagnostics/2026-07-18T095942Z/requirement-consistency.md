# Requirement Consistency

| 項目 | 内容 |
|------|------|
| Status | pass |
| Invariants | 13 |
| Scenario Gaps | 0 |
| Contradictions | 0 |
| Scanned Code Files | 0 |
| Requirement Sources | 2 |
| Spec Refs | 1 |
| Architecture Refs | 1 |
| Policy Refs | 0 |
| Domain Contract Refs | 0 |
| Responsibility Authority Matches | 0 |
| Responsibility Authority Unknowns | 0 |
| Structured Inherited Behavior Declarations | 0 |
| Legacy Keyword Resolutions | 0 |

## Invariants

- REQ-INV-001: correctionは同じstory・item・HEADの元裁定を参照し、誤premise・訂正premise・理由・replacement evidenceを必須にする (story:docs/management/stories/active/story-vibepro-classifier-premise-recovery.md)
- REQ-INV-002: 既存の裁定artifactを読み込め、cause未指定の既存 judged_unsound は安全側の implementation_unsound として扱う (story:docs/management/stories/active/story-vibepro-classifier-premise-recovery.md)
- REQ-INV-003: unit/E2Eテストが成功し、README（日英）に運用例と禁止事項が記載される (story:docs/management/stories/active/story-vibepro-classifier-premise-recovery.md)
- REQ-SRC-001: legacyの原因なしunsoundは implementation_unsound へ正規化する。 (spec:docs/specs/story-vibepro-classifier-premise-recovery.md)
- REQ-SRC-002: 元裁定、premise correction、再裁定を同じstory・item・HEADに紐づくappend-only eventとして残す。 (spec:docs/specs/story-vibepro-classifier-premise-recovery.md)
- REQ-SRC-003: correctionは誤前提、訂正後前提、理由、workspace相対の代替証拠とSHA-256を保持する。 (spec:docs/specs/story-vibepro-classifier-premise-recovery.md)
- REQ-SRC-004: implementation_unsound、既存のhuman judgment経路、critical gate性は従来どおり維持する。 (spec:docs/specs/story-vibepro-classifier-premise-recovery.md)
- REQ-SRC-005: story、item、current HEADが一致しないeventはcurrent stateに使わない。 (architecture:docs/architecture/story-vibepro-classifier-premise-recovery.md)
- REQ-SRC-006: duplicate ID、dangling/cross-item/cross-head参照、unknown cause、分岐した重複correction、invalid evidenceは (architecture:docs/architecture/story-vibepro-classifier-premise-recovery.md)
- REQ-SRC-007: 通常の judged_sound はresolved、通常の needs_human_judgment は既存accepted decision record経路を維持する。 (architecture:docs/architecture/story-vibepro-classifier-premise-recovery.md)
- REQ-SRC-008: classifier_premise_unsound は同じstory/item/HEADの当該verdictを直接参照するvalid correctionが無ければfailed。 (architecture:docs/architecture/story-vibepro-classifier-premise-recovery.md)
- REQ-SRC-009: correctionはwrong/corrected premise、reason、1件以上のworkspace-relative replacement artifactと記録時SHA-256を必須にする。 (architecture:docs/architecture/story-vibepro-classifier-premise-recovery.md)
- REQ-SRC-010: event配列の正順・逆順をresolverへ渡しても、明示参照が同じならcurrent stateは同一でなければならない。 (architecture:docs/architecture/story-vibepro-classifier-premise-recovery.md)

## Scenario Gaps

- なし

## Potential Contradictions

- なし

## Structured Inherited Behavior Declarations

- なし

## Legacy Keyword Resolution Deprecations

- なし

## Requirement Sources

- spec: docs/specs/story-vibepro-classifier-premise-recovery.md: Classifier Premise Recovery Spec
- architecture: docs/architecture/story-vibepro-classifier-premise-recovery.md: アーキテクチャ

## Responsibility Authority

- status: not_generated
- matched responsibilities: 0
- matched contract clauses: 0
- missing evidence: 0
- stale evidence: 0
- unregistered candidates: 0
