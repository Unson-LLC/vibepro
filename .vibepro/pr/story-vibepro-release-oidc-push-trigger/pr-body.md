## post-merge release を push トリガーへ移し npm Trusted Publishing を通す

Story: `story-vibepro-release-oidc-push-trigger`
SSOT: local

### 成果ケース連携
- 状態: `none`
- 理由コード: `not_linked`

### VibePro runtime identity
- package: `vibepro@0.2.0-beta.33`
- source: `npm_package` at `/workspace/opencode-trial/vp-oidc2/node_modules/vibepro`
- entrypoint: `/workspace/opencode-trial/vp-oidc2/node_modules/vibepro/bin/vibepro.js`
- source SHA: `4ec3e4033ad537eca5862a5e824ae94812d5f78f`
- identity digest: `ff24df81d22ff00d66129cc1d99b7d80c434978d80f7b229aa82bbe13de67f65`

### Story document
- docs/management/stories/active/story-vibepro-release-oidc-push-trigger.md — post-merge release を push トリガーへ移し npm Trusted Publishing を通す

### Acceptance criteria
- accepted-spec lineage: resolved — `.vibepro/spec/story-vibepro-release-oidc-push-trigger/spec.json` @ `d2761f86e6894f62e6602a303c2c5179e50efc7a` (HEAD `4ec3e4033ad537eca5862a5e824ae94812d5f78f`)
  - story: `docs/management/stories/active/story-vibepro-release-oidc-push-trigger.md` @ `fedaa630d492aa9d6c9fc51086cbe1baa927c096` (HEAD `4ec3e4033ad537eca5862a5e824ae94812d5f78f`)
- [mapped] AC-1: AC-1: `.github/workflows/post-merge-release.yml` は `pull_request_target` ではなく `main` への `push` と `workflow_dispatch` で起動する。merge 判定・merge SHA・PR 番号は pull_request イベントの値ではなく、push された commit（`github.sha`）に紐づく merge 済み PR から解決し、それ以外の挙動は変えない。
  - spec clauses: INV-001, INV-002, INV-008, INV-009, S-001
  - test: `test/post-merge-release.test.js` — `PCR-CON-001B post-merge release starts on push to main and workflow_dispatch instead of pull_request_target` @ `c857e22a137cd5f78c9c9811f00161d29bd8579c` (HEAD `4ec3e4033ad537eca5862a5e824ae94812d5f78f`)
  - test: `test/post-merge-release.test.js` — `PCR-CON-008 workflow binds merged main PRs to docs deploy and conditional release` @ `c857e22a137cd5f78c9c9811f00161d29bd8579c` (HEAD `4ec3e4033ad537eca5862a5e824ae94812d5f78f`)
  - test: `test/post-merge-release.test.js` — `PCR-CON-001B post-merge release resolves the merged pull request from the pushed commit` @ `c857e22a137cd5f78c9c9811f00161d29bd8579c` (HEAD `4ec3e4033ad537eca5862a5e824ae94812d5f78f`)
  - test: `test/post-merge-release.test.js` — `post-merge release uses immutable pre-merge base code for fork validation` @ `c857e22a137cd5f78c9c9811f00161d29bd8579c` (HEAD `4ec3e4033ad537eca5862a5e824ae94812d5f78f`)
  - test: `test/post-merge-release.test.js` — `post-merge first deployment executes the missing-selector fallback as full validation` @ `c857e22a137cd5f78c9c9811f00161d29bd8579c` (HEAD `4ec3e4033ad537eca5862a5e824ae94812d5f78f`)
  - test: `test/post-merge-release.test.js` — `post-merge release installs dependencies before unconditional docs projection` @ `c857e22a137cd5f78c9c9811f00161d29bd8579c` (HEAD `4ec3e4033ad537eca5862a5e824ae94812d5f78f`)
  - test: `test/post-merge-release.test.js` — `post-merge release push path takes release_required only from the plan --event output` @ `c857e22a137cd5f78c9c9811f00161d29bd8579c` (HEAD `4ec3e4033ad537eca5862a5e824ae94812d5f78f`)
  - test: `test/post-merge-release.test.js` — `post-merge release push retries the merged PR lookup and warns when none is found` @ `c857e22a137cd5f78c9c9811f00161d29bd8579c` (HEAD `4ec3e4033ad537eca5862a5e824ae94812d5f78f`)
  - test: `test/post-merge-release.test.js` — `PCR-CON-001B post-merge release resolves the merged pull request from the pushed commit` @ `c857e22a137cd5f78c9c9811f00161d29bd8579c` (HEAD `4ec3e4033ad537eca5862a5e824ae94812d5f78f`)
- [mapped] AC-2: AC-2: release ジョブは validation と release-candidate の成功を必要とし、docs ジョブは npm 公開成功後（または version 不変時）だけ動く。release ジョブの `if:` に `always()` が入るとテストが失敗する。
  - spec clauses: INV-003
  - test: `test/post-merge-release.test.js` — `post-merge release publishes only after validation and release-candidate succeed` @ `c857e22a137cd5f78c9c9811f00161d29bd8579c` (HEAD `4ec3e4033ad537eca5862a5e824ae94812d5f78f`)
  - test: `test/post-merge-release.test.js` — `post-merge release candidate runs only after validation planned a release` @ `c857e22a137cd5f78c9c9811f00161d29bd8579c` (HEAD `4ec3e4033ad537eca5862a5e824ae94812d5f78f`)
  - test: `test/post-merge-release.test.js` — `PCR-CON-014 post-merge release validates on the self-hosted runner and publishes through npm Trusted Publishing` @ `c857e22a137cd5f78c9c9811f00161d29bd8579c` (HEAD `4ec3e4033ad537eca5862a5e824ae94812d5f78f`)
- [mapped] AC-3: AC-3: `PCR-CON-013` のテスト ID は重複しない。#592 が追加した Trusted Publishing のテストは別の ID を持つ。
  - spec clauses: INV-004
  - test: `test/post-merge-release.test.js` — `post-merge release tests do not reuse PCR-CON-013 for the Trusted Publishing workflow test` @ `c857e22a137cd5f78c9c9811f00161d29bd8579c` (HEAD `4ec3e4033ad537eca5862a5e824ae94812d5f78f`)
  - test: `test/post-merge-release.test.js` — `PCR-CON-014 post-merge release validates on the self-hosted runner and publishes through npm Trusted Publishing` @ `c857e22a137cd5f78c9c9811f00161d29bd8579c` (HEAD `4ec3e4033ad537eca5862a5e824ae94812d5f78f`)
  - test: `test/post-merge-release.test.js` — `PCR-CON-013 advances a stale documented channel without reading npm dist-tags` @ `c857e22a137cd5f78c9c9811f00161d29bd8579c` (HEAD `4ec3e4033ad537eca5862a5e824ae94812d5f78f`)
  - test: `test/post-merge-release.test.js` — `PCR-CON-013 does not treat a prerelease prefix as the documented channel version` @ `c857e22a137cd5f78c9c9811f00161d29bd8579c` (HEAD `4ec3e4033ad537eca5862a5e824ae94812d5f78f`)
- [mapped] AC-4: AC-4: Story、Spec（全 clause に ac_id と具体的な test_refs、invariant に test_pattern）、`.vibepro/pr` の記録があり、pr-prepare.json の lineage は全 AC で `resolved` になる。
  - spec clauses: INV-005
  - test: `test/story-vibepro-release-oidc-push-trigger.test.js` — `story-vibepro-release-oidc-push-trigger spec maps every clause to an acceptance criterion and a concrete test` @ `939556dbf527ba38875a5a11554b4251b2313f62` (HEAD `4ec3e4033ad537eca5862a5e824ae94812d5f78f`)
- [mapped] AC-5: AC-5: PR 本文に「佐藤さんが確認すること」節があり、npm Trusted Publisher 登録（workflow filename、environment、Allow npm dist-tag）の確認を依頼する。Trusted Publisher 設定の 2 日失効と OIDC の対応イベントは npm 公式ドキュメントで確認した内容だけを書く。
  - spec clauses: INV-006
  - test: `test/story-vibepro-release-oidc-push-trigger.test.js` — `npm Trusted Publisher registration values are pinned by the publishing workflows` @ `939556dbf527ba38875a5a11554b4251b2313f62` (HEAD `4ec3e4033ad537eca5862a5e824ae94812d5f78f`)
- [mapped] AC-6: AC-6: `workflow_dispatch` で起動した run の RELEASE_SHA（release-candidate と release が checkout・照合・公開する SHA）は、実行時点の main の先端（ref main での dispatch の `github.sha`）である。PR の merge SHA や入力で渡された古い SHA は使わない。古い SHA を公開しようとすると VibePro の runtime manifest が `behind` で止まり、merge 後の beta.33 は dispatch run で初めて公開されるため。
  - spec clauses: INV-007, S-002, S-003
  - test: `test/post-merge-release.test.js` — `post-merge release dispatch binds RELEASE_SHA to the current main tip` @ `c857e22a137cd5f78c9c9811f00161d29bd8579c` (HEAD `4ec3e4033ad537eca5862a5e824ae94812d5f78f`)
  - test: `test/post-merge-release.test.js` — `post-merge release dispatch resolves notes from the latest merged PR but releases the main tip` @ `c857e22a137cd5f78c9c9811f00161d29bd8579c` (HEAD `4ec3e4033ad537eca5862a5e824ae94812d5f78f`)
  - test: `test/post-merge-release.test.js` — `post-merge release dispatch resolves notes from the latest merged PR but releases the main tip` @ `c857e22a137cd5f78c9c9811f00161d29bd8579c` (HEAD `4ec3e4033ad537eca5862a5e824ae94812d5f78f`)
  - test: `test/post-merge-release.test.js` — `post-merge release dispatch binds RELEASE_SHA to the current main tip` @ `c857e22a137cd5f78c9c9811f00161d29bd8579c` (HEAD `4ec3e4033ad537eca5862a5e824ae94812d5f78f`)
  - test: `test/post-merge-release.test.js` — `post-merge release dispatch resolves notes from the latest merged PR but releases the main tip` @ `c857e22a137cd5f78c9c9811f00161d29bd8579c` (HEAD `4ec3e4033ad537eca5862a5e824ae94812d5f78f`)

### Spec
- accepted spec present (`story-vibepro-release-oidc-push-trigger`, 12 clause(s))

### Semantic sufficiency
- answer resolution: `unavailable`
- automatic continuation: `false`
- counterexample status: `unavailable`
- warnings: semantic_contract_missing
- outcome coverage:
  - internal_output: `verified` (declared=12, answer_resolved=0, verification=verified)
  - downstream_outcome: `unknown` (declared=0, answer_resolved=0, verification=unknown)
  - canonical_readback: `unknown` (declared=0, answer_resolved=0, verification=unknown)

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

### Verification evidence
- [e2e] pass — computed: tests=2, pass=2, fail=0 — `node --test test/e2e/story-vibepro-pr-driven-continuous-release-main.test.js test/e2e/story-vibepro-release-exact-sha-fast-path.test.js` (runtime `ff24df81d22ff00d66129cc1d99b7d80c434978d80f7b229aa82bbe13de67f65`)
  - 自由記述summaryは参考情報であり、計算済み件数の権威ではありません
- [unit] pass — computed: tests=76, pass=76, fail=0 — `node --test test/post-merge-release.test.js test/story-vibepro-release-oidc-push-trigger.test.js` (runtime `ff24df81d22ff00d66129cc1d99b7d80c434978d80f7b229aa82bbe13de67f65`)
  - 自由記述summaryは参考情報であり、計算済み件数の権威ではありません
- [typecheck] pass — `npm run typecheck` (runtime `ff24df81d22ff00d66129cc1d99b7d80c434978d80f7b229aa82bbe13de67f65`)
  - 自由記述summaryは参考情報であり、計算済み件数の権威ではありません

### タスク権限
- 人間作成タスク: 未検出
- 受理済みauthority: 未検出
- 生成proposal: 1件 (todo=1); execution_policy=未指定; mutates_repository=未指定 — .vibepro/stories/story-vibepro-release-oidc-push-trigger/tasks/tasks.md

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
- next: vibepro judgment applicability record . --id story-vibepro-release-oidc-push-trigger --applicable yes|no --reason <text>

### Review
- recorded: false
- complete: false
- status: not_recorded
- blocking reasons: none

### Changed files
- M	.github/workflows/post-merge-release.yml
- M	.vibepro/config.json
- A	.vibepro/pr/story-vibepro-release-oidc-push-trigger/pr-body.md
- A	.vibepro/pr/story-vibepro-release-oidc-push-trigger/pr-prepare.json
- A	.vibepro/pr/story-vibepro-release-oidc-push-trigger/traceability.json
- A	.vibepro/pr/story-vibepro-release-oidc-push-trigger/verification-evidence.json
- A	.vibepro/pr/story-vibepro-release-oidc-push-trigger/verification-runs/e2e.json
- A	.vibepro/pr/story-vibepro-release-oidc-push-trigger/verification-runs/e2e.log
- A	.vibepro/pr/story-vibepro-release-oidc-push-trigger/verification-runs/typecheck.json
- A	.vibepro/pr/story-vibepro-release-oidc-push-trigger/verification-runs/typecheck.log
- A	.vibepro/pr/story-vibepro-release-oidc-push-trigger/verification-runs/unit.json
- A	.vibepro/pr/story-vibepro-release-oidc-push-trigger/verification-runs/unit.log
- A	.vibepro/spec/story-vibepro-release-oidc-push-trigger/pre-spec-readiness.json
- A	.vibepro/spec/story-vibepro-release-oidc-push-trigger/spec.json
- M	docs/architecture/vibepro-pr-driven-continuous-release.md
- A	docs/management/stories/active/story-vibepro-release-oidc-push-trigger.md
- M	docs/specs/vibepro-pr-driven-continuous-release.md
- M	test/e2e/story-vibepro-pr-driven-continuous-release-main.test.js
- M	test/e2e/story-vibepro-release-exact-sha-fast-path.test.js
- M	test/post-merge-release.test.js
- A	test/story-vibepro-release-oidc-push-trigger.test.js

