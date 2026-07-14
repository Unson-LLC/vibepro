# Requirement Consistency

| 項目 | 内容 |
|------|------|
| Status | pass |
| Invariants | 2 |
| Scenario Gaps | 0 |
| Contradictions | 0 |
| Scanned Code Files | 0 |
| Requirement Sources | 0 |
| Spec Refs | 0 |
| Architecture Refs | 0 |
| Policy Refs | 0 |
| Domain Contract Refs | 0 |
| Responsibility Authority Matches | 0 |
| Responsibility Authority Unknowns | 0 |
| Structured Inherited Behavior Declarations | 0 |
| Legacy Keyword Resolutions | 0 |

## Invariants

- REQ-INV-001: adjudicate prepare --judgment は最新pr-prepare.jsonからspine subcheck・judgment axis・failure modeのアクティブ項目を収集し、各項目の問い原文・現在の機械的消化状態・一致した証拠・変更ファイル一覧を含む依頼書を生成する (story:docs/management/stories/active/story-vibepro-judgment-dag-adjudication.md)
- REQ-INV-002: 依頼書には独立fresh contextでの実行・反証を試みる立場・裁定語彙3値（judged_sound / judged_unsound / needs_human_judgment）の定義と、トークン一致だけでは判断成立と見なさない旨の指示が含まれる (story:docs/management/stories/active/story-vibepro-judgment-dag-adjudication.md)

## Scenario Gaps

- なし

## Potential Contradictions

- なし

## Structured Inherited Behavior Declarations

- なし

## Legacy Keyword Resolution Deprecations

- なし

## Requirement Sources

- なし

## Responsibility Authority

- status: not_generated
- matched responsibilities: 0
- matched contract clauses: 0
- missing evidence: 0
- stale evidence: 0
- unregistered candidates: 0
