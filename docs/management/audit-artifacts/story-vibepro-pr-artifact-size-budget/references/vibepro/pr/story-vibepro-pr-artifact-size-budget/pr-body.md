## 判断
- このPRで判断すること: salestailor STR-144 実測で design-ssot-reconciliation.json 101KB / decision-index.json 41KB が handoff 読込対象に残っている を満たすための Runtime / Contract Docs / Tests 変更として、このPRを受け入れてよいか。
- Story: story-vibepro-pr-artifact-size-budget - salestailor STR-144 実測で design-ssot-reconciliation.json 101KB / decision-index.json 41KB が handoff 読込対象に残っている
- 正本: [docs/management/stories/active/story-vibepro-pr-artifact-size-budget.md](docs/management/stories/active/story-vibepro-pr-artifact-size-budget.md)
- 変更範囲: 9 files / Runtime / Contract Docs / Tests
- 設計/Story: [docs/management/stories/active/story-vibepro-pr-artifact-size-budget.md](docs/management/stories/active/story-vibepro-pr-artifact-size-budget.md), [docs/architecture/vibepro-pr-artifact-size-budget.md](docs/architecture/vibepro-pr-artifact-size-budget.md)
- 実装: [src/agent-review.js](src/agent-review.js), [src/canonical-audit.js](src/canonical-audit.js), [src/pr-artifact-budget.js](src/pr-artifact-budget.js), ...and 2 more
- テスト: [test/pr-artifact-size-budget.test.js](test/pr-artifact-size-budget.test.js)

## 経緯
- 要求: salestailor STR-144 実測で design-ssot-reconciliation.json 101KB / decision-index.json 41KB が handoff 読込対象に残っている
- 発生経緯: bounded-artifact-view で「full artifact dump を既定の LLM handoff にしない」方針は入ったが、`pr prepare` が生成する artifact 自体には per-file のサイズ予算がなく、大物が handoff 読込対象に残っている。salestailor の実運用 STR-144 で実測すると、`design-ssot-reconciliation.json` が **101KB**（LLM が読めば約 25k tokens）、`decision-index.json` が 41KB、story 1 本の `.vibepro/pr/` 合計は約 1.3MB。subagent dispatch や review 準備でこれらを読む度に、token と時間が本体作業と無関係に消える。 full-fidelity な JSON は機械可読の正本として維持しつつ、サイズ予算を超えた artifact には bounded summary（件数・結論・full 版へのポインタ）を自動生成し、LLM handoff 面（pr-body / parallel-dispatch / cockpit の参照）を summary 側に既定で向ける。


## 原因
- 最新診断gateが needs_review

## 解決
- Story文書を更新: [docs/management/stories/active/story-vibepro-pr-artifact-size-budget.md](docs/management/stories/active/story-vibepro-pr-artifact-size-budget.md)

## レビュー観点
- Gate: 未解決の必須Gateはありません。ただしリリース判断Warning: Managed Worktree Gate。 詳細はVibePro証跡の Gate DAG / Gate Enforcement を確認してください。
- Scope: 差分範囲の説明または分割判断が必要。理由: baseからのcommitが 3 件あり、Story外の変更混入を確認する必要がある / split=split_by_lane_then_prepare
- 管理worktree: needs_review
- Storyの受け入れ基準と実装差分が対応しているか
- 主要ソース差分: [src/agent-review.js](src/agent-review.js), [src/canonical-audit.js](src/canonical-audit.js), [src/pr-artifact-budget.js](src/pr-artifact-budget.js), [src/pr-manager.js](src/pr-manager.js), ...
- テスト差分: [test/pr-artifact-size-budget.test.js](test/pr-artifact-size-budget.test.js)
- Risk: 最新診断gateが needs_review

## 確認
- [x] Unit Gate - 変更に対応する対象テスト / gate: passed / evidence: [.vibepro/pr/story-vibepro-pr-artifact-size-budget/test-artifacts/status-e2e.json](.vibepro/pr/story-vibepro-pr-artifact-size-budget/test-artifacts/status-e2e.json)
- [x] verification:typecheck - [package.json](package.json) の typecheck scriptでTypeScript/型境界を確認する / gate: passed / evidence: [.vibepro/pr/story-vibepro-pr-artifact-size-budget/test-artifacts/status-typecheck.json](.vibepro/pr/story-vibepro-pr-artifact-size-budget/test-artifacts/status-typecheck.json)
- [x] Integration Gate - artifact_replay regression: re-ran pr-prepare artifact emission and verified gate-dag and pr-prepare.json artifact_budget end to end at current head, including the integration runtime path and the negative_path summary-generation-failure fallback. Contract_doc compatibility verification: implementation validated against [docs/specs](docs/specs) PAB contract clauses. Regression coverage for pr_lifecycle, agent_review lifecycle, verification evidence_lifecycle, story_source integrity, engineering_judgment route, and managed_worktree execution. Clauses VIBE-CORE-PR-001 VIBE-CORE-AR-001 VIBE-CORE-EV-001 VIBE-CORE-COST-001 VIBE-CORE-STORY-001 VIBE-CORE-JUDGE-001 VIBE-CORE-WT-001 VIBE-RAR-001 VIBE-RAR-002 VIBE-CORE-STATUS-001; evidence: [.vibepro/pr/story-vibepro-pr-artifact-size-budget/test-artifacts/status-integration.json](.vibepro/pr/story-vibepro-pr-artifact-size-budget/test-artifacts/status-integration.json) / gate: passed / evidence: [.vibepro/pr/story-vibepro-pr-artifact-size-budget/test-artifacts/status-integration.json](.vibepro/pr/story-vibepro-pr-artifact-size-budget/test-artifacts/status-integration.json)
- 最終E2E: pass: e2e scenario clause flow replay: drove real vibepro pr prepare and review prepare end to end for acceptance clauses PAB-S-1..7 and replayed the pr-prepare artifact budget flow, asserting gate-dag verdict invariance and over/within/config-override/dispatch handoff paths.（[.vibepro/pr/story-vibepro-pr-artifact-size-budget/test-artifacts/status-e2e.json](.vibepro/pr/story-vibepro-pr-artifact-size-budget/test-artifacts/status-e2e.json)）

## 詳細
- 証跡: [.vibepro/pr/story-vibepro-pr-artifact-size-budget/](.vibepro/pr/story-vibepro-pr-artifact-size-budget/)
- PR準備: [.vibepro/pr/story-vibepro-pr-artifact-size-budget/pr-prepare.json](.vibepro/pr/story-vibepro-pr-artifact-size-budget/pr-prepare.json)
- 判断索引: [.vibepro/pr/story-vibepro-pr-artifact-size-budget/decision-index.json](.vibepro/pr/story-vibepro-pr-artifact-size-budget/decision-index.json)
- Gate: ready_for_review
- 実行状態: ready
- Scope: needs_clean_branch / clean_branch_or_split_pr
- Runtime: vibepro@0.1.0-beta.0 73219fb8ed42 claude/pr-artifact-size-budget clean (story=story-vibepro-pr-artifact-size-budget)
