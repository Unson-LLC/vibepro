## 判断
- このPRで判断すること: budget grant を diff でレビュー可能にする: decision record --source budget:delivery_efficiency:* が tracked decision document を必ず書く を満たすための Runtime / Contract Docs / Tests 変更として、このPRを受け入れてよいか。
- Story: story-vibepro-budget-grant-tracked-decision-doc - budget grant を diff でレビュー可能にする: decision record --source budget:delivery_efficiency:* が tracked decision document を必ず書く
- 正本: [docs/management/stories/active/story-vibepro-budget-grant-tracked-decision-doc.md](docs/management/stories/active/story-vibepro-budget-grant-tracked-decision-doc.md)
- 変更範囲: 25 files / Runtime / Contract Docs / Tests
- 設計/Story: [docs/management/stories/active/story-vibepro-budget-grant-tracked-decision-doc.md](docs/management/stories/active/story-vibepro-budget-grant-tracked-decision-doc.md), [docs/management/stories/active/story-vibepro-budget-override-residual-findings.md](docs/management/stories/active/story-vibepro-budget-override-residual-findings.md), [docs/management/stories/active/story-vibepro-owner-gated-budget-override.md](docs/management/stories/active/story-vibepro-owner-gated-budget-override.md), ...and 2 more
- 実装: scripts/generate-cli-reference.mjs, [src/agent-review.js](src/agent-review.js), [src/budget-override-authority.js](src/budget-override-authority.js), ...and 4 more
- テスト: [test/budget-override-consuming-surfaces.test.js](test/budget-override-consuming-surfaces.test.js), [test/budget-override-residual-findings.test.js](test/budget-override-residual-findings.test.js), [test/decision-records.test.js](test/decision-records.test.js), ...and 5 more

## 経緯
- 要求: budget grant を diff でレビュー可能にする: decision record --source budget:delivery_efficiency:* が tracked decision document を必ず書く
- 発生経緯: Story文書から経緯を抽出できませんでした。


## 原因
- `vibepro decision record --source budget:delivery_efficiency:<story-id>` が mint する owner grant（grantor / grantor_kind / override_digest / recorded_by / recorded_at）は `.vibepro/pr/<story-id>/decision-records.json` にのみ書かれ、 `.gitignore` により repository に入らない。PR レビュアが diff で見えるのは `.vibepro/config.json` の数値と agent 記述の `amendment_reason` だけであり、 親 Story の residual 節が「偽造検出は人間が構造化された記録で行う」と 述べている当の構造化記録が、人間のレビュー面に届いていない。 repository には既に tracked channel が存在する: `docs/management/decisions/*.md`（frontmatter `type: budget_override_approval`、 例: `2026-07-27-runner-direct-evidence-budget-approval.md`）。親 Story の 3 grant はこの channel に document...

## 解決
- Story文書を更新: [docs/management/stories/active/story-vibepro-budget-grant-tracked-decision-doc.md](docs/management/stories/active/story-vibepro-budget-grant-tracked-decision-doc.md), [docs/management/stories/active/story-vibepro-budget-override-residual-findings.md](docs/management/stories/active/story-vibepro-budget-override-residual-findings.md), [docs/management/stories/active/story-vibepro-owner-gated-budget-override.md](docs/management/stories/active/story-vibepro-owner-gated-budget-override.md)

## Release Notes

### Change Summary
Story文書を更新: [docs/management/stories/active/story-vibepro-budget-grant-tracked-decision-doc.md](docs/management/stories/active/story-vibepro-budget-grant-tracked-decision-doc.md), [docs/management/stories/active/story-vibepro-budget-override-residual-findings.md](docs/management/stories/active/story-vibepro-budget-override-residual-findings.md), [docs/management/stories/active/story-vibepro-owner-gated-budget-override.md](docs/management/stories/active/story-vibepro-owner-gated-budget-override.md)

### Compatibility
なし

### User Action
なし

## レビュー観点
- Gate: 未解決Gateがあります（対象: Risk-adaptive Validation Sequencing Gate, Senior Gap Judgment Gate）。詳細はVibePro証跡の Gate DAG / Gate Enforcement を確認し、blocking か waiver 可能かを判断してください。 リリース判断Warning: Design Input Judgment Gate, Managed Worktree Gate。
- Scope: 差分範囲の説明または分割判断が必要。理由: baseからのcommitが 48 件あり、Story外の変更混入を確認する必要がある / split=split_by_lane_then_prepare
- 管理worktree: needs_review
- Storyの受け入れ基準と実装差分が対応しているか
- 主要ソース差分: scripts/generate-cli-reference.mjs, [src/agent-review.js](src/agent-review.js), [src/budget-override-authority.js](src/budget-override-authority.js), [src/cli.js](src/cli.js), ...
- テスト差分: [test/budget-override-consuming-surfaces.test.js](test/budget-override-consuming-surfaces.test.js), [test/budget-override-residual-findings.test.js](test/budget-override-residual-findings.test.js), [test/decision-records.test.js](test/decision-records.test.js), [test/delivery-efficiency-guardrail.test.js](test/delivery-efficiency-guardrail.test.js), ...

## 確認
- [x] verification:typecheck - [package.json](package.json) の typecheck scriptでTypeScript/型境界を確認する / gate: passed
- [x] Unit Gate - 636/636 unit regression pass on 1f6c38a9: the tracked-document contract and budget override authority surfaces this change touches, plus the suites owning every responsibility contract it matched -- VIBE-RAR-001 and VIBE-RAR-002 ([test/responsibility-authority.test.js](test/responsibility-authority.test.js), [test/vibepro-cli.test.js](test/vibepro-cli.test.js)), VIBE-CORE-EV-001 ([test/verification-runner.test.js](test/verification-runner.test.js), [test/ci-evidence-import.test.js](test/ci-evidence-import.test.js)) and VIBE-CORE-COST-001 ([test/session-efficiency-audit.test.js](test/session-efficiency-audit.test.js)); evidence: [.vibepro/evidence/unit-all-1f6c38a9.tap](.vibepro/evidence/unit-all-1f6c38a9.tap) / gate: passed / evidence: [.vibepro/evidence/unit-all-1f6c38a9.tap](.vibepro/evidence/unit-all-1f6c38a9.tap)
- [x] Integration Gate - Imported CI evidence for test (22) (SUCCESS) at HEAD 1f6c38a999f3; evidence: [.vibepro/pr/story-vibepro-budget-grant-tracked-decision-doc/ci-evidence/test_22_.json](.vibepro/pr/story-vibepro-budget-grant-tracked-decision-doc/ci-evidence/test_22_.json) / gate: passed / evidence: [.vibepro/pr/story-vibepro-budget-grant-tracked-decision-doc/ci-evidence/test_22_.json](.vibepro/pr/story-vibepro-budget-grant-tracked-decision-doc/ci-evidence/test_22_.json)
- [x] E2E Gate - 7/7 acceptance blocks pass on 1f6c38a9 (TAP), driving the real [bin/vibepro.js](bin/vibepro.js) CLI against a temporary git repository; evidence: [.vibepro/evidence/e2e-1f6c38a9.tap](.vibepro/evidence/e2e-1f6c38a9.tap) / gate: passed / evidence: [.vibepro/evidence/e2e-1f6c38a9.tap](.vibepro/evidence/e2e-1f6c38a9.tap)
- 最終E2E: pass: 7/7 acceptance blocks pass on 1f6c38a9 (TAP), driving the real [bin/vibepro.js](bin/vibepro.js) CLI against a temporary git repository（[.vibepro/evidence/e2e-1f6c38a9.tap](.vibepro/evidence/e2e-1f6c38a9.tap)）

## 詳細
- 証跡: [.vibepro/pr/story-vibepro-budget-grant-tracked-decision-doc/](.vibepro/pr/story-vibepro-budget-grant-tracked-decision-doc/)
- PR準備: [.vibepro/pr/story-vibepro-budget-grant-tracked-decision-doc/pr-prepare.json](.vibepro/pr/story-vibepro-budget-grant-tracked-decision-doc/pr-prepare.json)
- 判断索引: [.vibepro/pr/story-vibepro-budget-grant-tracked-decision-doc/decision-index.json](.vibepro/pr/story-vibepro-budget-grant-tracked-decision-doc/decision-index.json)
- Gate: needs_verification
- 実行状態: waiver_required
- Scope: needs_clean_branch / clean_branch_or_split_pr
- Runtime: vibepro@0.2.0-beta.1 2306cc5858d0 codex/autonomous-implementation-closure-roadmap dirty (story=story-vibepro-budget-grant-tracked-decision-doc)

## VibePro Gate Waiver

- waiver policy: cli_reason
- severity: warning
- reason: Owner sato_keigo waived gate:validation_sequencing on 2026-08-01 (session 70ea817c-ee56-48c0-ab7c-612da8629872) after being shown the cost of the proper path, recorded as decision-1785584051979-8ca08822. The two remaining non-critical gates both reduce to gate:validation_sequencing, which was already unresolved before this repair session began and was not broken by it. Walking it properly would require a canonical Agent Review covering all 27 changed paths for preflight_review (the review performed inspected 7), a second canonical review for final_review, and strict-head-bound re-recording for targeted_validation and expensive_verification. Passing preconditions measured at this head: CI 8 checks with 0 failing or pending (test (20) 6m28s, test (22) 10m47s, analyze, CodeQL all pass), critical unresolved gates 0, no blocking gates, gate:pr_freshness passed, and clean_worktree / base_freshness / remote_head_match / checks_ready / review_policy / open_pull_request all passed. Adjudication: 7/7 acceptance clauses demonstrated, 11/12 judgment items sound with scope_reviewability resolved by owner decision. HONEST LIMIT: the validation sequence was not executed; independent verification of this change is limited to the 8 CI checks plus the recorded adjudications and the single gate_evidence Agent Review.
- unresolved gates: Risk-adaptive Validation Sequencing Gate:needs_evidence, Senior Gap Judgment Gate:needs_review
- critical unresolved gates: none
