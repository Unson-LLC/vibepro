## 受入条件見出しの括弧サフィックスを認識する

Story: `story-vibepro-ac-heading-paren-suffix`
SSOT: local

### 成果ケース連携
- 状態: `none`
- 理由コード: `not_linked`

### VibePro runtime identity
- package: `vibepro@0.2.0-beta.33`
- source: `npm_package` at `/workspace/opencode-trial/vp-596/node_modules/vibepro`
- entrypoint: `/workspace/opencode-trial/vp-596/node_modules/vibepro/bin/vibepro.js`
- source SHA: `80ad2845dd3904243e555985d538b2706f34dfca`
- identity digest: `2171a0255570fe0c7230b5ce63ec6bc2b08d719baa5d2e6222c43273242886f9`

### Story document
- docs/management/stories/active/story-vibepro-ac-heading-paren-suffix.md — 受入条件見出しの括弧サフィックスを認識する

### Acceptance criteria
- accepted-spec lineage: resolved — `.vibepro/spec/story-vibepro-ac-heading-paren-suffix/spec.json` @ `8d3f278dfc51cf0208c2f31727ccff35eee43dd4` (HEAD `80ad2845dd3904243e555985d538b2706f34dfca`)
  - story: `docs/management/stories/active/story-vibepro-ac-heading-paren-suffix.md` @ `546af317e58ca5776c3e775b9901a919318e1a59` (HEAD `80ad2845dd3904243e555985d538b2706f34dfca`)
- [mapped] AC-1: AC-1: 見出し語の直後に全角 `（…）` または ASCII `(…)` が一つ続く受入条件見出しを認識する。
  - spec clauses: INV-001, INV-002, S-001, S-002, S-003, S-004, S-005, S-006, S-007
  - test: `test/pr-artifact-consistency.test.js` — `shared Acceptance Criteria parser recognizes a full-width parenthetical suffix` @ `8a0e3543ca737a23fa19f049dd4b1d2b39f5bc3a` (HEAD `80ad2845dd3904243e555985d538b2706f34dfca`)
  - test: `test/pr-artifact-consistency.test.js` — `shared Acceptance Criteria parser recognizes an ASCII parenthetical suffix` @ `8a0e3543ca737a23fa19f049dd4b1d2b39f5bc3a` (HEAD `80ad2845dd3904243e555985d538b2706f34dfca`)
  - test: `test/pr-artifact-consistency.test.js` — `shared Acceptance Criteria parser recognizes 受入条件（Brainbase 完了契約 criteria 原文）` @ `8a0e3543ca737a23fa19f049dd4b1d2b39f5bc3a` (HEAD `80ad2845dd3904243e555985d538b2706f34dfca`)
  - test: `test/pr-artifact-consistency.test.js` — `shared Acceptance Criteria parser does not recognize 受入条件外（x）` @ `8a0e3543ca737a23fa19f049dd4b1d2b39f5bc3a` (HEAD `80ad2845dd3904243e555985d538b2706f34dfca`)
  - test: `test/pr-artifact-consistency.test.js` — `shared Acceptance Criteria parser rejects a nested parenthetical suffix` @ `8a0e3543ca737a23fa19f049dd4b1d2b39f5bc3a` (HEAD `80ad2845dd3904243e555985d538b2706f34dfca`)
  - test: `test/pr-artifact-consistency.test.js` — `shared Acceptance Criteria parser rejects two parenthetical groups` @ `8a0e3543ca737a23fa19f049dd4b1d2b39f5bc3a` (HEAD `80ad2845dd3904243e555985d538b2706f34dfca`)
  - test: `test/pr-artifact-consistency.test.js` — `shared Acceptance Criteria parser rejects mixed full-width and ASCII parentheses` @ `8a0e3543ca737a23fa19f049dd4b1d2b39f5bc3a` (HEAD `80ad2845dd3904243e555985d538b2706f34dfca`)
  - test: `test/pr-artifact-consistency.test.js` — `shared Acceptance Criteria parser recognizes a full-width parenthetical suffix` @ `8a0e3543ca737a23fa19f049dd4b1d2b39f5bc3a` (HEAD `80ad2845dd3904243e555985d538b2706f34dfca`)
  - test: `test/pr-artifact-consistency.test.js` — `shared Acceptance Criteria parser recognizes an ASCII parenthetical suffix` @ `8a0e3543ca737a23fa19f049dd4b1d2b39f5bc3a` (HEAD `80ad2845dd3904243e555985d538b2706f34dfca`)
  - test: `test/pr-artifact-consistency.test.js` — `shared Acceptance Criteria parser recognizes 受入条件（Brainbase 完了契約 criteria 原文）` @ `8a0e3543ca737a23fa19f049dd4b1d2b39f5bc3a` (HEAD `80ad2845dd3904243e555985d538b2706f34dfca`)
  - test: `test/pr-artifact-consistency.test.js` — `shared Acceptance Criteria parser does not recognize 受入条件外（x）` @ `8a0e3543ca737a23fa19f049dd4b1d2b39f5bc3a` (HEAD `80ad2845dd3904243e555985d538b2706f34dfca`)
  - test: `test/pr-artifact-consistency.test.js` — `shared Acceptance Criteria parser rejects a nested parenthetical suffix` @ `8a0e3543ca737a23fa19f049dd4b1d2b39f5bc3a` (HEAD `80ad2845dd3904243e555985d538b2706f34dfca`)
  - test: `test/pr-artifact-consistency.test.js` — `shared Acceptance Criteria parser rejects two parenthetical groups` @ `8a0e3543ca737a23fa19f049dd4b1d2b39f5bc3a` (HEAD `80ad2845dd3904243e555985d538b2706f34dfca`)
  - test: `test/pr-artifact-consistency.test.js` — `shared Acceptance Criteria parser rejects mixed full-width and ASCII parentheses` @ `8a0e3543ca737a23fa19f049dd4b1d2b39f5bc3a` (HEAD `80ad2845dd3904243e555985d538b2706f34dfca`)
- [mapped] AC-2: AC-2: 括弧の無い従来の受入条件見出しは、これまで通り認識する。
  - spec clauses: INV-003, S-008
  - test: `test/pr-artifact-consistency.test.js` — `shared Acceptance Criteria parser handles numbered/case/Japanese variants without background bullets` @ `8a0e3543ca737a23fa19f049dd4b1d2b39f5bc3a` (HEAD `80ad2845dd3904243e555985d538b2706f34dfca`)
  - test: `test/pr-artifact-consistency.test.js` — `shared Acceptance Criteria parser handles numbered/case/Japanese variants without background bullets` @ `8a0e3543ca737a23fa19f049dd4b1d2b39f5bc3a` (HEAD `80ad2845dd3904243e555985d538b2706f34dfca`)
- [mapped] AC-3: AC-3: 既存 Story markdown の受入条件件数は変わらない。件数が変わるのは T4 `story-vibepro-task-plan-decomposer` と T3 `story-vibepro-task-plan-overlap-refs` だけで、それぞれ 0 件から 4 件になる。
  - spec clauses: INV-004, S-009
  - test: `test/pr-artifact-consistency.test.js` — `acceptance-criteria counts change only for the T4 and T3 stories` @ `8a0e3543ca737a23fa19f049dd4b1d2b39f5bc3a` (HEAD `80ad2845dd3904243e555985d538b2706f34dfca`)
  - test: `test/pr-artifact-consistency.test.js` — `acceptance-criteria counts change only for the T4 and T3 stories` @ `8a0e3543ca737a23fa19f049dd4b1d2b39f5bc3a` (HEAD `80ad2845dd3904243e555985d538b2706f34dfca`)

### Spec
- accepted spec present (`story-vibepro-ac-heading-paren-suffix`, 13 clause(s))

### Semantic sufficiency
- answer resolution: `unavailable`
- automatic continuation: `false`
- counterexample status: `unavailable`
- warnings: semantic_contract_missing
- outcome coverage:
  - internal_output: `verified` (declared=13, answer_resolved=0, verification=verified)
  - downstream_outcome: `unknown` (declared=0, answer_resolved=0, verification=unknown)
  - canonical_readback: `unknown` (declared=0, answer_resolved=0, verification=unknown)

### Multi-tenant architecture
- status: not_applicable

### Verification evidence
- [unit] pass — computed: tests=20, pass=20, fail=0 — `node --test test/pr-artifact-consistency.test.js test/task-plan-decomposer.test.js` (runtime `2171a0255570fe0c7230b5ce63ec6bc2b08d719baa5d2e6222c43273242886f9`)
  - 自由記述summaryは参考情報であり、計算済み件数の権威ではありません
- [typecheck] pass — `npm run typecheck` (runtime `2171a0255570fe0c7230b5ce63ec6bc2b08d719baa5d2e6222c43273242886f9`)
  - 自由記述summaryは参考情報であり、計算済み件数の権威ではありません

### タスク権限
- 人間作成タスク: 未検出
- 受理済みauthority: 未検出
- 生成proposal: 未検出

### Development Judgment
- available: false
- status: not_recorded
- lifecycle: not_started
- applicable: not_recorded
- input adopted: false
- actionable: false
- advisory: true
- blocking: false
- plan binding: none
- plan effect: no_effect
- disposition: none
- disposition effect: none
- pending disposition: false
- pending outcome: false
- next: vibepro judgment applicability record . --id story-vibepro-ac-heading-paren-suffix --applicable yes|no --reason <text>

### Review
- recorded: false
- complete: false
- status: not_recorded
- blocking reasons: none

### Changed files
- M	.vibepro/config.json
- A	.vibepro/spec/story-vibepro-ac-heading-paren-suffix/pre-spec-readiness.json
- A	.vibepro/spec/story-vibepro-ac-heading-paren-suffix/spec.json
- A	docs/management/stories/active/story-vibepro-ac-heading-paren-suffix.md
- M	src/markdown-acceptance-criteria.js
- M	test/pr-artifact-consistency.test.js

