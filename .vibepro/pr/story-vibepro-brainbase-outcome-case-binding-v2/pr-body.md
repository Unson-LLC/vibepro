## Brainbase成果ケースへのv2紐付けを後方互換で保持する

Story: `story-vibepro-brainbase-outcome-case-binding-v2`
SSOT: local

### 成果ケース連携
- 状態: `none`
- 理由コード: `not_linked`

### VibePro runtime identity
- package: `vibepro@0.2.0-beta.21`
- source: `npm_package` at `/private/tmp/vibepro-head-runtime.Vv9f5K/package`
- entrypoint: `/private/tmp/vibepro-head-runtime.Vv9f5K/package/bin/vibepro.js`
- source SHA: `818824a0cd53aca915ffad5fad7873300f38932d`
- identity digest: `22e7962d51117a1751a1ab067d75a919c537becaf2d8d12a8cc41c1116372b4e`

### Story document
- docs/management/stories/active/story-vibepro-brainbase-outcome-case-binding-v2.md — Brainbase成果ケースへのv2紐付けを後方互換で保持する

### Acceptance criteria
- accepted-spec lineage: resolved — `.vibepro/spec/story-vibepro-brainbase-outcome-case-binding-v2/spec.json` @ `c6ee5228f40983b43a9841d0bf2703d0758753d4` (HEAD `818824a0cd53aca915ffad5fad7873300f38932d`)
  - story: `docs/management/stories/active/story-vibepro-brainbase-outcome-case-binding-v2.md` @ `7429e49d98635554c7efd5f44a7342543bc274f5` (HEAD `818824a0cd53aca915ffad5fad7873300f38932d`)
- [mapped] AC-1: AC-1: `brainbase-vibepro-context-handoff.v1` の入力と出力契約は従来どおり受理される。v1 Contextだけを持つStoryのPR準備は成果ケース未連携の `none` / `not_linked` として表示し、v2の再bind/復旧を案内しない。
  - spec clauses: C-001
  - test: `test/brainbase-integration.test.js` — `v1 context-only StoryのPR準備は未連携として扱い、v2復旧を案内しない` @ `6e07314c84bf65fdf676bc72c95fe54505fa84af` (HEAD `818824a0cd53aca915ffad5fad7873300f38932d`)
- [mapped] AC-2: AC-2: `brainbase-vibepro-context-handoff.v2` 相当の成果ケースは、署名済み `brainbase-vibepro-managed-handoff.v2` でのみ受理する。署名対象の `outcome_case` は `case_id`、成果ケース参照、判断受領参照、判断ダイジェスト、利用者が観測できる成果、技術受入条件、運用確認を必須として検証する。
  - spec clauses: C-002
  - test: `test/brainbase-integration.test.js` — `署名済みmanaged v2成果ケース契約をcontextと既存Storyメタデータへ投影する` @ `6e07314c84bf65fdf676bc72c95fe54505fa84af` (HEAD `818824a0cd53aca915ffad5fad7873300f38932d`)
- [mapped] AC-3: AC-3: 有効なmanaged v2入力は、既存Storyを事前検査するか、標準 `vibepro story add` の完全なStory追加契約だけが内部の非export宣言capabilityを使って同一ジャーナル取引へ含める。公開されたStory追加契約は正規化済みCLI項目だけを受け、traceabilityも作成する。公開済みmanaged v2取引のtraceability書込みだけが失敗した場合は、commit済みStory・信頼済み投影・完全一致する正規化済み宣言・traceability欠落をすべて確認できる同じ標準Story追加だけが、公開を重複せずtraceabilityを冪等に再開する。不一致・未信頼v2・v1はfail closedする。一般のbind APIと任意の事前作成Story宣言はfail closedする。handoff sourceと消費ledgerの `source_artifact` は、正規のrepo相対パスであり、シンボリックリンク解決後もrepo root内に留まる場合だけ受理する。外部・traversal・encoded traversal・symlink escapeは、bindまたは回復による書込み前に拒否する。config、Context、bind receipt、消費ledger、commit markerを回復可能に公開してから、StoryとPR準備へ同じ成果ケース契約を保持する。非managed v2は権威あるStory/PRメタデータを投影できない。
  - spec clauses: C-003
  - test: `test/brainbase-integration.test.js` — `trusted v2 bindはContext・Story・PR準備へ同じ7項目を投影し、技術完了を推測しない` @ `6e07314c84bf65fdf676bc72c95fe54505fa84af` (HEAD `818824a0cd53aca915ffad5fad7873300f38932d`)
  - test: `test/brainbase-integration.test.js` — `公開importは不完全Story宣言を渡せず、標準CLI Story addだけが署名済みmanaged v2を原子的に宣言・検証・投影する` @ `6e07314c84bf65fdf676bc72c95fe54505fa84af` (HEAD `818824a0cd53aca915ffad5fad7873300f38932d`)
  - test: `test/brainbase-integration.test.js` — `managed v2 Story addはtraceability失敗後に同一の完全宣言だけを冪等に再開する` @ `6e07314c84bf65fdf676bc72c95fe54505fa84af` (HEAD `818824a0cd53aca915ffad5fad7873300f38932d`)
  - test: `test/brainbase-integration.test.js` — `Story add traceability再開は宣言不一致・未信頼v2・v1を拒否する` @ `6e07314c84bf65fdf676bc72c95fe54505fa84af` (HEAD `818824a0cd53aca915ffad5fad7873300f38932d`)
  - test: `test/brainbase-integration.test.js` — `managed v2 publish is journal-recoverable and never projects a partial transaction as trusted` @ `6e07314c84bf65fdf676bc72c95fe54505fa84af` (HEAD `818824a0cd53aca915ffad5fad7873300f38932d`)
  - test: `test/brainbase-integration.test.js` — `managed v2 process recovery can fail closed and resume idempotently` @ `6e07314c84bf65fdf676bc72c95fe54505fa84af` (HEAD `818824a0cd53aca915ffad5fad7873300f38932d`)
  - test: `test/brainbase-integration.test.js` — `managed handoff sourceは外部・traversal・encoded・symlinkを一切のbinding write前に拒否する` @ `6e07314c84bf65fdf676bc72c95fe54505fa84af` (HEAD `818824a0cd53aca915ffad5fad7873300f38932d`)
  - test: `test/brainbase-integration.test.js` — `tampered recovery journal ledger is rejected before replay mutates any publication document` @ `6e07314c84bf65fdf676bc72c95fe54505fa84af` (HEAD `818824a0cd53aca915ffad5fad7873300f38932d`)
  - test: `test/brainbase-integration.test.js` — `managed v2はStory未作成時にcontextを書かず、v2からv1への再bindも拒否する` @ `6e07314c84bf65fdf676bc72c95fe54505fa84af` (HEAD `818824a0cd53aca915ffad5fad7873300f38932d`)
- [mapped] AC-4: AC-4: PR準備は保存済みの署名付きmanaged v2 handoffを信頼鍵で再検証し、消費ledgerが指すrepo内のcanonical source receiptを再読込してダイジェストを照合し、技術完了の判定と検証証跡だけを返す。外部・非正規・欠落・改ざん済みsourceはtrustedへ昇格させない。未連携の `none` と、未信頼・改ざん・期限切れ・commit marker欠落・partialの `unknown` / `untrusted` / `partial` を安全なreason codeと再bind/復旧判断とともに可視化する。`integration status`、`doctor`、Story診断レポートはこの信頼検証を実行しないため、`not_evaluated` と `pr prepare` の検証導線を表示する。OutcomeCaseの完了・close・外部更新を呼び出しも要求もしない。
  - spec clauses: C-004
  - test: `test/pr-manager.test.js` — `pr prepareは未検証のStory成果ケースを権威あるメタデータとして投影しない` @ `d16113be3c3e6fec767da38a3cf0da0b659d353e` (HEAD `818824a0cd53aca915ffad5fad7873300f38932d`)
  - test: `test/brainbase-integration.test.js` — `PR準備は共謀して書換えたContext・receipt・Story・commit markerを署名なしでは投影しない` @ `6e07314c84bf65fdf676bc72c95fe54505fa84af` (HEAD `818824a0cd53aca915ffad5fad7873300f38932d`)
  - test: `test/brainbase-integration.test.js` — `PR準備は未連携・partial成果ケース・期限切れ署名を区別して安全な復旧判断を表示する` @ `6e07314c84bf65fdf676bc72c95fe54505fa84af` (HEAD `818824a0cd53aca915ffad5fad7873300f38932d`)
  - test: `test/brainbase-integration.test.js` — `v1 context-only StoryのPR準備は未連携として扱い、v2復旧を案内しない` @ `6e07314c84bf65fdf676bc72c95fe54505fa84af` (HEAD `818824a0cd53aca915ffad5fad7873300f38932d`)
  - test: `test/brainbase-integration.test.js` — `署名済みmanaged v1の完全publishを通したStoryのPR準備は未連携として扱い、v2復旧を案内しない` @ `6e07314c84bf65fdf676bc72c95fe54505fa84af` (HEAD `818824a0cd53aca915ffad5fad7873300f38932d`)
  - test: `test/brainbase-integration.test.js` — `tampered consumption ledger source_artifactは読戻しでtrustedへ昇格しない` @ `6e07314c84bf65fdf676bc72c95fe54505fa84af` (HEAD `818824a0cd53aca915ffad5fad7873300f38932d`)
  - test: `test/brainbase-integration.test.js` — `PR準備はcanonical source receipt欠損をuntrustedとして投影せずtrust sourceを変更しない` @ `6e07314c84bf65fdf676bc72c95fe54505fa84af` (HEAD `818824a0cd53aca915ffad5fad7873300f38932d`)
  - test: `test/brainbase-integration.test.js` — `PR準備はcanonical source receipt改ざんをuntrustedとして投影せずtrust sourceを変更しない` @ `6e07314c84bf65fdf676bc72c95fe54505fa84af` (HEAD `818824a0cd53aca915ffad5fad7873300f38932d`)
  - test: `test/brainbase-integration.test.js` — `PR準備はcanonical source receipt署名改ざんをuntrustedとして投影せずtrust sourceを変更しない` @ `6e07314c84bf65fdf676bc72c95fe54505fa84af` (HEAD `818824a0cd53aca915ffad5fad7873300f38932d`)
  - test: `test/brainbase-integration.test.js` — `status・doctor・Story reportは成果ケース信頼性を未評価と明示し、PR準備へ誘導する` @ `6e07314c84bf65fdf676bc72c95fe54505fa84af` (HEAD `818824a0cd53aca915ffad5fad7873300f38932d`)
- [mapped] AC-5: AC-5: 不足、空値、重複ID、caseと一致しない参照、未知issuer、未信頼の検証証跡は技術完了として扱わない。v2からv1への再bindは既存v2投影を残したまま成功してはならず、markerのない部分投影は権威メタデータとして利用しない。
  - spec clauses: INV-001
  - test: `test/brainbase-integration.test.js` — `managed v2はStory未作成時にcontextを書かず、v2からv1への再bindも拒否する` @ `6e07314c84bf65fdf676bc72c95fe54505fa84af` (HEAD `818824a0cd53aca915ffad5fad7873300f38932d`)
  - test: `test/brainbase-integration.test.js` — `signed managed v2の成果ケース参照はcaseとissuerに一致しなければならない` @ `6e07314c84bf65fdf676bc72c95fe54505fa84af` (HEAD `818824a0cd53aca915ffad5fad7873300f38932d`)

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
- [typecheck] pass — `npm run typecheck` (runtime `916181643f416472a53b9b919e1d3badedc508ee84a98de4e5cf23a380ea3eb7`)
  - 自由記述summaryは参考情報であり、計算済み件数の権威ではありません
- [integration] pass — computed: tests=39, pass=39, fail=0 — `node --test --test-concurrency=2 test/brainbase-integration.test.js` (runtime `916181643f416472a53b9b919e1d3badedc508ee84a98de4e5cf23a380ea3eb7`)
  - 自由記述summaryは参考情報であり、計算済み件数の権威ではありません
- [unit] pass — computed: tests=14, pass=14, fail=0 — `node --test test/accepted-spec-traceability.test.js test/task-authority.test.js` (runtime `916181643f416472a53b9b919e1d3badedc508ee84a98de4e5cf23a380ea3eb7`)
  - 自由記述summaryは参考情報であり、計算済み件数の権威ではありません

### タスク権限
- 人間作成タスク: 未検出
- 受理済みauthority: 1件 (in_progress=1); input=docs/management/stories/active/story-vibepro-brainbase-outcome-case-binding-v2.tasks.json@17be32ebd0a60bc02e41c02ac1e798cabd6c2f48513b21a2475c1ece4bcf5048 — .vibepro/stories/story-vibepro-brainbase-outcome-case-binding-v2/tasks/tasks.json
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
- complete: true
- status: pass (pass=7, needs_review=0, block=0)
- convergence: converged (wave=36, no_progress=0, head_churn=26, progress=true)
- convergence progress reasons: all_required_roles_resolved
- blocking reasons: none
- error: none
  - planning_spec: pass (product_requirement, architecture_boundary, spec_consistency)
    - product_requirement: effective=pass, binding=causal_reuse, delta=full_review, runtime_failure=none
    - architecture_boundary: effective=pass, binding=causal_reuse, delta=full_review, runtime_failure=none
    - spec_consistency: effective=pass, binding=causal_reuse, delta=full_review, runtime_failure=none
  - requirement: pass (acceptance_e2e, product_requirement, scope_risk)
  - architecture_spec: pass (spec_consistency, regression_risk, architecture_boundary)
  - test_plan: pass (unit_integration, e2e_ux, gate_coverage)
  - implementation: pass (code_spec_alignment, runtime_contract, ux_completion)
  - gate: pass (gate_evidence, pr_split_scope, release_risk)
  - preview: pass (preview_smoke, network_runtime, human_usability)

### Changed files
- M	.vibepro/config.json
- A	.vibepro/pr/story-vibepro-brainbase-outcome-case-binding-v2/pr-body.md
- A	.vibepro/pr/story-vibepro-brainbase-outcome-case-binding-v2/pr-prepare.json
- A	.vibepro/pr/story-vibepro-brainbase-outcome-case-binding-v2/traceability.json
- A	.vibepro/pr/story-vibepro-brainbase-outcome-case-binding-v2/verification-evidence.json
- A	.vibepro/pr/story-vibepro-brainbase-outcome-case-binding-v2/verification-runs/integration.json
- A	.vibepro/pr/story-vibepro-brainbase-outcome-case-binding-v2/verification-runs/integration.log
- A	.vibepro/pr/story-vibepro-brainbase-outcome-case-binding-v2/verification-runs/unit.json
- A	.vibepro/pr/story-vibepro-brainbase-outcome-case-binding-v2/verification-runs/unit.log
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
