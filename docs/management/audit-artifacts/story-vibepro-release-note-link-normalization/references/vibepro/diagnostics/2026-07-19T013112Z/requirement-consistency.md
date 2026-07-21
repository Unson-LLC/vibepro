# Requirement Consistency

| 項目 | 内容 |
|------|------|
| Status | pass |
| Invariants | 11 |
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

- REQ-INV-001: 正規化対象はMarkdownのリンク先がdocs/で始まるrepo-root docs参照だけとする。 (story:docs/management/stories/active/story-vibepro-release-note-link-normalization.md)
- REQ-INV-002: raw HTMLとVue interpolationを無害化する既存契約を維持する。 (story:docs/management/stories/active/story-vibepro-release-note-link-normalization.md)
- REQ-INV-003: 日英release historyとCHANGELOGは同じ決定的なnote本文を保持する。 (story:docs/management/stories/active/story-vibepro-release-note-link-normalization.md)
- REQ-INV-004: ](docs/<path>)は投影時に](/<path>)へ正規化される。 (story:docs/management/stories/active/story-vibepro-release-note-link-normalization.md)
- REQ-INV-005: code span/fence内の同じ文字列と、外部・anchor・既にroot-relativeなリンクは保持される。 (story:docs/management/stories/active/story-vibepro-release-note-link-normalization.md)
- REQ-INV-006: 生成済みPR #350のrelease noteが正規化済みになり、npm run docs:buildが成功する。 (story:docs/management/stories/active/story-vibepro-release-note-link-normalization.md)
- REQ-INV-007: Markdown destinationが正規化対象外の形なら変更せず、VitePress buildが最終検査として止める。 (story:docs/management/stories/active/story-vibepro-release-note-link-normalization.md)
- REQ-INV-008: 正規化が誤った場合は関数と生成済みリンクをrevertし、PR本文を絶対URLへ修正して再投影できる。 (story:docs/management/stories/active/story-vibepro-release-note-link-normalization.md)
- REQ-INV-009: 独立reviewが対象境界と既存sanitizationの維持を確認する。 (story:docs/management/stories/active/story-vibepro-release-note-link-normalization.md)
- REQ-SRC-001: RNLN-004: HTML/Vue sanitizationとPR番号単位のidempotent upsertを維持する。 (spec:docs/specs/vibepro-release-note-link-normalization.md)
- REQ-SRC-002: RNLN-005: 日英release historyとCHANGELOGは同じ正規化済みnoteを受け取る。 (spec:docs/specs/vibepro-release-note-link-normalization.md)

## Scenario Gaps

- なし

## Potential Contradictions

- なし

## Structured Inherited Behavior Declarations

- なし

## Legacy Keyword Resolution Deprecations

- なし

## Requirement Sources

- spec: docs/specs/vibepro-release-note-link-normalization.md: Spec
- architecture: docs/architecture/story-vibepro-release-note-link-normalization.md: Release note link normalization architecture

## Responsibility Authority

- status: not_generated
- matched responsibilities: 0
- matched contract clauses: 0
- missing evidence: 0
- stale evidence: 0
- unregistered candidates: 0
