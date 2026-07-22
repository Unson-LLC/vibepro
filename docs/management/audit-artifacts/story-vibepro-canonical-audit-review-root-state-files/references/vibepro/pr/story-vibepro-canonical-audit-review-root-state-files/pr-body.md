## 判断
- このPRで判断すること: Canonical auditがreview root直下のstory-level state fileでmergeを失敗させないようにする を満たすための Runtime / Contract Docs / Tests 変更として、このPRを受け入れてよいか。
- Story: story-vibepro-canonical-audit-review-root-state-files - Canonical auditがreview root直下のstory-level state fileでmergeを失敗させないようにする
- 正本: [docs/management/stories/active/story-vibepro-canonical-audit-review-root-state-files.md](docs/management/stories/active/story-vibepro-canonical-audit-review-root-state-files.md)
- 変更範囲: 5 files / Runtime / Contract Docs / Tests
- 設計/Story: [docs/management/stories/active/story-vibepro-canonical-audit-review-root-state-files.md](docs/management/stories/active/story-vibepro-canonical-audit-review-root-state-files.md), [docs/specs/vibepro-canonical-audit-review-root-state-files.md](docs/specs/vibepro-canonical-audit-review-root-state-files.md)
- 実装: [src/canonical-audit.js](src/canonical-audit.js)
- テスト: [test/canonical-audit-self-contained.test.js](test/canonical-audit-self-contained.test.js)

## 経緯
- 要求: Canonical auditがreview root直下のstory-level state fileでmergeを失敗させないようにする
- 発生経緯: review authorizeフローを使ったstoryでも `vibepro execute merge` がcanonical audit promotionで失敗せず、authorize（モデル承認・予算予約）とmerge監査を両立できる。


## 原因
- 最新診断gateが needs_review

## 解決
- Story文書を更新: [docs/management/stories/active/story-vibepro-canonical-audit-review-root-state-files.md](docs/management/stories/active/story-vibepro-canonical-audit-review-root-state-files.md)

## Release Notes

### Change Summary
Story文書を更新: [docs/management/stories/active/story-vibepro-canonical-audit-review-root-state-files.md](docs/management/stories/active/story-vibepro-canonical-audit-review-root-state-files.md)

### Compatibility
なし

### User Action
なし

## レビュー観点
- Gate: 未解決の必須Gateはありません。ただしリリース判断Warning: Design Input Judgment Gate, Managed Worktree Gate。 詳細はVibePro証跡の Gate DAG / Gate Enforcement を確認してください。
- Scope: 差分範囲の説明または分割判断が必要。理由: baseからのcommitが 3 件あり、Story外の変更混入を確認する必要がある / split=split_by_lane_then_prepare
- 管理worktree: needs_review
- Storyの受け入れ基準と実装差分が対応しているか
- ADRなしで既存設計の範囲に収まっているか
- 主要ソース差分: [src/canonical-audit.js](src/canonical-audit.js)
- ...and 1 more
- Risk: 最新診断gateが needs_review

## 確認
- [x] Unit Gate - 変更に対応する対象テスト / gate: passed / evidence: [.vibepro/evidence/story-vibepro-canonical-audit-review-root-state-files/unit-test-status.json](.vibepro/evidence/story-vibepro-canonical-audit-review-root-state-files/unit-test-status.json)
- [x] Integration Gate - Integration check across the final output path and type boundary: node --check over [bin/vibepro.js](bin/vibepro.js) and all [src/*.js](src/*.js) including the modified [src/canonical-audit.js](src/canonical-audit.js) passed with exit 0, and the full CI suite (test 20/22) passed on PR #380 head 44ebe877, so the canonical audit promotion module loads and behaves cleanly inside the CLI integration surface used by vibepro execute merge, pr prepare, and gate-dag generation.; evidence: [.vibepro/evidence/story-vibepro-canonical-audit-review-root-state-files/integration-typecheck-status.json](.vibepro/evidence/story-vibepro-canonical-audit-review-root-state-files/integration-typecheck-status.json) / gate: passed / evidence: [.vibepro/evidence/story-vibepro-canonical-audit-review-root-state-files/integration-typecheck-status.json](.vibepro/evidence/story-vibepro-canonical-audit-review-root-state-files/integration-typecheck-status.json)
- [x] E2E Gate - Replayed the vibepro execute merge canonical audit promotion flow (promoteCanonicalAuditArtifacts) end-to-end against a fixture mirroring the real story-vibepro-target-architecture-conformance failure: dispatch-authorizations.json and a stale .dispatch.lock under the review root. Promotion succeeded, stage review artifacts were promoted into the audit-bundle, and the ENOTDIR fail-loud path for a stage replaced by a file was re-verified. gate-dag and pr-prepare consumers of the promoted bundle are unaffected.; evidence: [.vibepro/evidence/story-vibepro-canonical-audit-review-root-state-files/e2e-replay-status.json](.vibepro/evidence/story-vibepro-canonical-audit-review-root-state-files/e2e-replay-status.json) / gate: passed / evidence: [.vibepro/evidence/story-vibepro-canonical-audit-review-root-state-files/e2e-replay-status.json](.vibepro/evidence/story-vibepro-canonical-audit-review-root-state-files/e2e-replay-status.json)
- 最終E2E: pass: Replayed the vibepro execute merge canonical audit promotion flow (promoteCanonicalAuditArtifacts) end-to-end against a fixture mirroring the real story-vibepro-target-architecture-conformance failure: dispatch-authorizations.json and a stale .dispatch.lock under the review root. Promotion succeeded, stage review artifacts were promoted into the audit-bundle, and the ENOTDIR fail-loud path for a stage replaced by a file was re-verified. gate-dag and pr-prepare consumers of the promoted bundle are unaffected.（[.vibepro/evidence/story-vibepro-canonical-audit-review-root-state-files/e2e-replay-status.json](.vibepro/evidence/story-vibepro-canonical-audit-review-root-state-files/e2e-replay-status.json)）

## 詳細
- 証跡: [.vibepro/pr/story-vibepro-canonical-audit-review-root-state-files/](.vibepro/pr/story-vibepro-canonical-audit-review-root-state-files/)
- PR準備: [.vibepro/pr/story-vibepro-canonical-audit-review-root-state-files/pr-prepare.json](.vibepro/pr/story-vibepro-canonical-audit-review-root-state-files/pr-prepare.json)
- 判断索引: [.vibepro/pr/story-vibepro-canonical-audit-review-root-state-files/decision-index.json](.vibepro/pr/story-vibepro-canonical-audit-review-root-state-files/decision-index.json)
- Gate: ready_for_review
- 実行状態: ready
- Scope: needs_clean_branch / clean_branch_or_split_pr
- Runtime: vibepro@0.2.0-beta.1 44ebe87760f0 claude/affectionate-heisenberg-36d68d clean (story=story-vibepro-canonical-audit-review-root-state-files)
