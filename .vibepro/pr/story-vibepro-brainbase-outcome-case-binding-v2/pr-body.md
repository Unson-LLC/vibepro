## Brainbase成果ケースへのv2紐付けを後方互換で保持する

Story: `story-vibepro-brainbase-outcome-case-binding-v2`
SSOT: local

### 成果ケース連携
- 状態: `none`
- 理由コード: `not_linked`

### VibePro runtime identity
- package: `vibepro@0.2.0-beta.21`
- source: `npm_package` at `/private/tmp/vibepro-pr-prepare.3ldnl7/package`
- entrypoint: `/private/tmp/vibepro-pr-prepare.3ldnl7/package/bin/vibepro.js`
- source SHA: `61dc388f4a3eee78f9ac6c4d760d60fdf251b70d`
- identity digest: `baf3659b1c5ecb48bf0aa5be45d6eb8e190ea2dc2f66483f17af2e577a06eb3e`

### Story document
- docs/management/stories/active/story-vibepro-brainbase-outcome-case-binding-v2.md — Brainbase成果ケースへのv2紐付けを後方互換で保持する

### Acceptance criteria
- accepted-spec lineage: resolved — `.vibepro/spec/story-vibepro-brainbase-outcome-case-binding-v2/spec.json` @ `77b1b00a466e8b1e2b418ef9f52f58ac7734c23a` (HEAD `61dc388f4a3eee78f9ac6c4d760d60fdf251b70d`)
  - story: `docs/management/stories/active/story-vibepro-brainbase-outcome-case-binding-v2.md` @ `e182ffac0b292070e5e120b464d3bbf8d71310f4` (HEAD `61dc388f4a3eee78f9ac6c4d760d60fdf251b70d`)
- [mapped] AC-1: AC-1: `brainbase-vibepro-context-handoff.v1` の入力と出力契約は従来どおり受理される。v1 Contextだけを持つStoryのPR準備は成果ケース未連携の `none` / `not_linked` として表示し、v2の再bind/復旧を案内しない。
  - spec clauses: C-001
  - test: `test/brainbase-integration.test.js` — `v1 context-only StoryのPR準備は未連携として扱い、v2復旧を案内しない` @ `9fbaff74a7a78a6adec82ad2b690fd78aabf3c91` (HEAD `61dc388f4a3eee78f9ac6c4d760d60fdf251b70d`)
- [mapped] AC-2: AC-2: `brainbase-vibepro-context-handoff.v2` 相当の成果ケースは、署名済み `brainbase-vibepro-managed-handoff.v2` でのみ受理する。署名対象の `outcome_case` は `case_id`、成果ケース参照、判断受領参照、判断ダイジェスト、利用者が観測できる成果、技術受入条件、運用確認を必須として検証する。
  - spec clauses: C-002
  - test: `test/brainbase-integration.test.js` — `署名済みmanaged v2成果ケース契約をcontextと既存Storyメタデータへ投影する` @ `9fbaff74a7a78a6adec82ad2b690fd78aabf3c91` (HEAD `61dc388f4a3eee78f9ac6c4d760d60fdf251b70d`)
- [mapped] AC-3: AC-3: 有効なmanaged v2入力は、既存Storyを事前検査するか、標準 `vibepro story add` の完全なStory追加契約だけが内部の非export宣言capabilityを使って同一ジャーナル取引へ含める。公開されたStory追加契約は正規化済みCLI項目だけを受け、traceabilityも作成する。一般のbind APIと任意の事前作成Story宣言はfail closedする。config、Context、bind receipt、消費ledger、commit markerを回復可能に公開してから、StoryとPR準備へ同じ成果ケース契約を保持する。非managed v2は権威あるStory/PRメタデータを投影できない。
  - spec clauses: C-003
  - test: `test/brainbase-integration.test.js` — `公開importは不完全Story宣言を渡せず、標準CLI Story addだけが署名済みmanaged v2を原子的に宣言・検証・投影する` @ `9fbaff74a7a78a6adec82ad2b690fd78aabf3c91` (HEAD `61dc388f4a3eee78f9ac6c4d760d60fdf251b70d`)
  - test: `test/brainbase-integration.test.js` — `managed v2 publish is journal-recoverable and never projects a partial transaction as trusted` @ `9fbaff74a7a78a6adec82ad2b690fd78aabf3c91` (HEAD `61dc388f4a3eee78f9ac6c4d760d60fdf251b70d`)
  - test: `test/brainbase-integration.test.js` — `managed v2はStory未作成時にcontextを書かず、v2からv1への再bindも拒否する` @ `9fbaff74a7a78a6adec82ad2b690fd78aabf3c91` (HEAD `61dc388f4a3eee78f9ac6c4d760d60fdf251b70d`)
- [mapped] AC-4: AC-4: PR準備は保存済みの署名付きmanaged v2 handoffを信頼鍵で再検証し、技術完了の判定と検証証跡だけを返す。未連携の `none` と、未信頼・改ざん・期限切れ・commit marker欠落・partialの `unknown` / `untrusted` / `partial` を安全なreason codeと再bind/復旧判断とともに可視化する。OutcomeCaseの完了・close・外部更新を呼び出しも要求もしない。
  - spec clauses: C-004
  - test: `test/pr-manager.test.js` — `pr prepareは未検証のStory成果ケースを権威あるメタデータとして投影しない` @ `d16113be3c3e6fec767da38a3cf0da0b659d353e` (HEAD `61dc388f4a3eee78f9ac6c4d760d60fdf251b70d`)
  - test: `test/brainbase-integration.test.js` — `PR準備は未連携・partial成果ケース・期限切れ署名を区別して安全な復旧判断を表示する` @ `9fbaff74a7a78a6adec82ad2b690fd78aabf3c91` (HEAD `61dc388f4a3eee78f9ac6c4d760d60fdf251b70d`)
  - test: `test/brainbase-integration.test.js` — `v1 context-only StoryのPR準備は未連携として扱い、v2復旧を案内しない` @ `9fbaff74a7a78a6adec82ad2b690fd78aabf3c91` (HEAD `61dc388f4a3eee78f9ac6c4d760d60fdf251b70d`)
- [mapped] AC-5: AC-5: 不足、空値、重複ID、caseと一致しない参照、未知issuer、未信頼の検証証跡は技術完了として扱わない。v2からv1への再bindは既存v2投影を残したまま成功してはならず、markerのない部分投影は権威メタデータとして利用しない。
  - spec clauses: INV-001
  - test: `test/brainbase-integration.test.js` — `managed v2はStory未作成時にcontextを書かず、v2からv1への再bindも拒否する` @ `9fbaff74a7a78a6adec82ad2b690fd78aabf3c91` (HEAD `61dc388f4a3eee78f9ac6c4d760d60fdf251b70d`)
  - test: `test/brainbase-integration.test.js` — `signed managed v2の成果ケース参照はcaseとissuerに一致しなければならない` @ `9fbaff74a7a78a6adec82ad2b690fd78aabf3c91` (HEAD `61dc388f4a3eee78f9ac6c4d760d60fdf251b70d`)

### Spec
- accepted spec present (`story-vibepro-brainbase-outcome-case-binding-v2`, 5 clause(s))

### Multi-tenant architecture
- status: needs_review
- activation: boundary_without_tenant_actor
- architecture views: none
- evidence coverage: inconclusive
- [review] applicability_ambiguous: story_context
- review/tenant_architecture [needs_review]: tenant identityは入口から全実行面と資源境界まで一意に伝播するか
  - findings: none
  - unconfirmed: applicability_ambiguous@story_context
- review/security_boundary [needs_review]: credential、secret、dataにcross-tenant fallbackまたは混線経路がないか
  - findings: none
  - unconfirmed: applicability_ambiguous@story_context
- review/operations_and_migration [needs_review]: 各配備形態で移行・rollback・削除・接続不能の意味が維持されるか
  - findings: none
  - unconfirmed: applicability_ambiguous@story_context

### Bug diagnosis DAG
- not applicable (Story contract type is not bug_fix/regression_fix)

### Verification evidence
- [integration] pass — computed: tests=1, pass=1, fail=0 — `node --test --test-name-pattern=公開import test/brainbase-integration.test.js` (runtime `6d28e993f41eabf4882734c473d5887ec9cfd81c4b3679752ecc6a9adcbb5a40`)
  - 自由記述summaryは参考情報であり、計算済み件数の権威ではありません
- [unit] pass — computed: tests=51, pass=51, fail=0 — `npm test -- test/brainbase-integration.test.js test/pr-manager.test.js` (runtime `32d53d49697bb247fb2d93f14f32c39d9b017b68eb881b049623ceaf091d16f8`)
  - 自由記述summaryは参考情報であり、計算済み件数の権威ではありません

### タスク権限
- 人間作成タスク: 未検出
- 受理済みauthority: 1件 (in_progress=1); input=docs/management/stories/active/story-vibepro-brainbase-outcome-case-binding-v2.tasks.json@6860550567702e1b289a68b9bf2a70dbaeb674552f133f485d8446089973ff2f — .vibepro/stories/story-vibepro-brainbase-outcome-case-binding-v2/tasks/tasks.json
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
- next: vibepro judgment applicability record . --id story-vibepro-brainbase-outcome-case-binding-v2 --applicable yes|no --reason <text>

### Review
- configured: true
- recorded: true
- complete: false
- status: needs_review (pass=0, needs_review=7, block=0)
- convergence: converged (wave=1, no_progress=0, head_churn=8, progress=false)
- convergence progress reasons: head_only_observation
- blocking reasons: agent_review:needs_review
- error: none
- agent review instruction: unavailable
- current review stage: none
- current review roles: none
- agent review instruction reason: unsafe_or_incomplete_review_status
  - planning_spec: needs_review (product_requirement, architecture_boundary, spec_consistency)
  - requirement: needs_review (product_requirement, scope_risk, acceptance_e2e)
  - architecture_spec: needs_review (architecture_boundary, spec_consistency, regression_risk)
  - test_plan: needs_review (unit_integration, e2e_ux, gate_coverage)
  - implementation: needs_review (code_spec_alignment, runtime_contract, ux_completion)
  - gate: needs_review (gate_evidence, pr_split_scope, release_risk)
  - preview: needs_review (preview_smoke, network_runtime, human_usability)

### Changed files
- M	.vibepro/config.json
- A	.vibepro/spec/story-vibepro-brainbase-outcome-case-binding-v2/spec.json
- A	.vibepro/stories/story-vibepro-brainbase-outcome-case-binding-v2/tasks/tasks.json
- A	.vibepro/stories/story-vibepro-brainbase-outcome-case-binding-v2/tasks/tasks.md
- A	docs/architecture/story-vibepro-brainbase-outcome-case-binding-v2.md
- A	docs/management/stories/active/story-vibepro-brainbase-outcome-case-binding-v2.md
- A	docs/management/stories/active/story-vibepro-brainbase-outcome-case-binding-v2.spec.json
- A	docs/management/stories/active/story-vibepro-brainbase-outcome-case-binding-v2.tasks.json
- M	src/brainbase-integration.js
- M	src/pr-manager.js
- M	src/story-manager.js
- M	test/brainbase-integration.test.js
- M	test/pr-manager.test.js
