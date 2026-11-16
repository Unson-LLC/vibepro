<!-- vibepro-projection story_id=story-vibepro-pr-artifact-consistency feature_slug=pr-artifact-consistency ownership=generated profile=feature_packet source=.vibepro/spec/story-vibepro-pr-artifact-consistency/spec.json source_sha256=eda8c2e330672e11b9413d0ea9df25e718a476990c53ad7d06da156d24440d20 renderer=functional_spec_markdown@1 direct_edit=false -->
- Canonical ownership: generated

# Functional Spec

- Story: story-vibepro-pr-artifact-consistency
- Status: -
- Clauses: 5

## INV-001

PR準備とcanonical traceabilityは同一のAcceptance Criteria条項、map状態、summaryを保持する。

### Origin refs

- {"anchor":"acceptanceCriteria","file":"src/traceability.js"}
- {"anchor":"summarizeClauseMapForPrepare","file":"src/pr-manager.js"}
- {"case":"pr prepare projects one exact clause map","file":"test/pr-artifact-consistency.test.js"}
- {"index":0,"kind":"acceptance_criteria"}

## INV-002

番号付きまたは大文字小文字が異なるAcceptance Criteria見出しは共通parserで解釈し、節外の箇条書きを含めない。

### Origin refs

- {"anchor":"extractMarkdownAcceptanceCriteria","file":"src/markdown-acceptance-criteria.js"}
- {"case":"shared Acceptance Criteria parser handles numbered/case variants","file":"test/pr-artifact-consistency.test.js"}
- {"index":1,"kind":"acceptance_criteria"}

## INV-003

PR本文のtests、pass、fail件数はcomputed_observationから算出し、自由記述summaryを件数の権威にしない。

### Origin refs

- {"anchor":"extractComputedVerificationCounts","file":"src/pr-manager.js"}
- {"case":"computed counts","file":"test/pr-artifact-consistency.test.js"}
- {"index":3,"kind":"acceptance_criteria"}

## INV-004

人間作成task ledgerとgenerated proposalは別authorityとして件数、状態、実行方針を投影する。

### Origin refs

- {"anchor":"readTaskAuthorities","file":"src/task-authority.js"}
- {"case":"distinct task authorities","file":"test/pr-artifact-consistency.test.js"}
- {"index":5,"kind":"acceptance_criteria"}

## INV-005

generated task planはartifact routingのcanonical pathから読み、JSONとMarkdownの既存形式を受け入れる。

### Origin refs

- {"anchor":"resolveArtifactRoute","file":"src/task-authority.js"}
- {"case":"metadata-not-a-task","file":"test/pr-artifact-consistency.test.js"}
- {"file":"docs/architecture/story-vibepro-pr-artifact-consistency.md","section":"タスク権限"}

## Diagrams

- none
