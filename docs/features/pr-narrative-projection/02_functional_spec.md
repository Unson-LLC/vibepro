<!-- vibepro-projection story_id=story-vibepro-pr-narrative-projection feature_slug=pr-narrative-projection ownership=generated profile=feature_packet source=.vibepro/spec/story-vibepro-pr-narrative-projection/spec.json source_sha256=418a2e1266c2e0e384a48970401cb45aeeb6cf704364c7f477dc746f824a4565 renderer=functional_spec_markdown@1 direct_edit=false -->
- Canonical ownership: generated

# Functional Spec

- Story: story-vibepro-pr-narrative-projection
- Status: -
- Clauses: 5

## C-001

PR本文の保存済み判断説明は要約、レビュー焦点、リスク、未確定事項の固定見出しを使用し、各説明には保存時に安定化されたTalking Point IDを表示する。

### Origin refs

- {"ac_id":"AC-002","kind":"acceptance_criteria"}
- {"ac_id":"AC-004","kind":"acceptance_criteria"}
- {"anchor":"#### レビュー焦点","file":"src/pr-manager.js"}
- {"anchor":"#### 未確定事項","file":"src/pr-manager.js"}
- {"case":"valid narrative is stored with stable TP ids and rendered into pr-body.md","file":"test/report-pipeline.test.js"}
- {"file":"docs/architecture/story-vibepro-pr-narrative-projection.md","section":"表示契約"}

## C-002

説明スロット本文は単一行かつ280文字以内の平文に限定し、Markdown構造を含む入力と呼び出し側が指定した未検証のinputs_digestを採用しない。

### Origin refs

- {"ac_id":"AC-006","kind":"acceptance_criteria"}
- {"anchor":"inputs_digest: fingerprint.inputs_digest","file":"src/cli.js"}
- {"anchor":"slot_text_structure","file":"src/report-validator.js"}
- {"case":"report write ignores a caller-supplied inputs digest and stores the verified fingerprint","file":"test/report-pipeline.test.js"}
- {"case":"report write rejects prose that can inject markdown structure","file":"test/report-pipeline.test.js"}
- {"file":"docs/architecture/story-vibepro-pr-narrative-projection.md","section":"表示契約"}

## INV-001

pr-body 説明が保存されていないStoryでは、pr prepare は空の説明欄を生成せず既存のPR本文骨格を維持する。

### Origin refs

- {"ac_id":"AC-003","kind":"acceptance_criteria"}
- {"anchor":"if (!Array.isArray(narrative?.narrative_slots)","file":"src/pr-manager.js"}
- {"case":"pr prepare keeps the fixed body unchanged when no narrative is stored","file":"test/report-pipeline.test.js"}
- {"file":"docs/architecture/story-vibepro-pr-narrative-projection.md","section":"互換性・ロールバック"}

## INV-002

保存済み説明の入力指紋が現在のStory、HEAD、トレーサビリティ、Spec、ドリフト、検証、レビュー状態と一致しない場合、pr prepare は古い説明本文を表示せず再生成が必要だと明示する。

### Origin refs

- {"ac_id":"AC-005","kind":"acceptance_criteria"}
- {"anchor":"assessNarrativeProjection","file":"src/pr-manager.js"}
- {"anchor":"buildInputsDigest","file":"src/report-fingerprint.js"}
- {"case":"pr prepare suppresses stale narrative and shows an explicit refresh warning","file":"test/report-pipeline.test.js"}
- {"file":"docs/architecture/story-vibepro-pr-narrative-projection.md","section":"表示契約"}

## S-001

検証済みの pr-body 説明が保存されているStoryで pr prepare を実行すると、生成された pr-body.md は専用欄へ summary、review_focus、risks_synthesis、open_questions をTalking Point ID付きで表示する。

### Origin refs

- {"ac_id":"AC-001","kind":"acceptance_criteria"}
- {"ac_id":"AC-002","kind":"acceptance_criteria"}
- {"anchor":"readNarrative","file":"src/pr-manager.js"}
- {"anchor":"renderPrNarrative","file":"src/pr-manager.js"}
- {"case":"valid narrative is stored with stable TP ids and rendered into pr-body.md","file":"test/report-pipeline.test.js"}
- {"file":"docs/architecture/story-vibepro-pr-narrative-projection.md","section":"境界"}

## Diagrams

- none
