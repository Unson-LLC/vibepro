# 縮小リファクタ実装計画（REBUILD.md の実行計画）

**作成**: 2026-08-06 ／ **前提**: `REBUILD.md` のスコープ（残す4本柱 / 捨てる機構）
**実測**: src/ 150ファイル・111,341行。分類は KILL 90ファイル/62,524行（56%）、ENTANGLED 33ファイル/39,715行（36%）、KEEP 27ファイル/9,102行（8%）。

## 進め方

- 普通のgitフローで、1スライス = 1 PR。ブランチは `rebuild/minimal-core` から派生させず、各スライスをmain直系で刻む。
- 各スライスで「src削除 → cli.jsの該当コマンドブロック削除 → 対応テスト削除 → `node --test --test-concurrency=2` フルスイート緑」を完了条件とする。
- 依存の葉から削る。Slice 6（pr-manager.js の Gate DAG 本体）は前5スライス完了後のみ着手可。

## スライス分割

| # | 内容 | 主対象 |
|---|---|---|
| 1 | 診断/UIUX/architecture/performanceスキャナ群 | `uiux-*` `flow-*` `visual-verifier` `architecture-*` `performance-*` `*-scanner` `html-report` `usage-report` `requirement-consistency` `presets` `recipe-preflight` `playbook-exporter` `journey-map` `design-*` ほか約30ファイル + cli.js該当コマンド |
| 2 | 実行エンジン本体（execute/gate/adjudicate/outcome/checkpoint） | `guarded-run-session` `execution-state` `task-manager` `outcome-manager` `merge-manager` `adjudication` `decision-*` `gate-outcome-ledger` `responsibility-authority` `senior-gap-judgment` `check-packs` ほか約23ファイル |
| 3 | delivery-efficiency予算全系 | `evidence-cost-budget` `evidence-depth-planner` `evidence-reuse` `delivery-efficiency-guardrail` `budget-override-authority` `pr-artifact-budget` + pr-manager.js内の`buildDeliveryEfficiencyContext`等 |
| 4 | head束縛stale化・audit自動生成 | `content-binding` `run-context-capsule` `run-lineage` `session-efficiency-audit` `process-record-store` `canonical-audit` `canonical-persistence` `merge-public-projection` + pr-manager.js内`buildPrFreshnessGate` |
| 5 | review lifecycle会計・authorize/close儀式 | agent-review.jsから`startAgentReviewLifecycle`/`authorizeAgentReviewDispatch`/`closeAgentReviewLifecycle`等を削除、`review`コマンドをprepare/record/summaryへ縮小、`independent-review-orchestrator` `review-surface-violations` |
| 6 | Gate DAG本体とcli/pr-managerの最終縮小 | pr-manager.jsから`evaluateGateReadiness` `buildGateOverride` `shipPullRequest` `autopilotPullRequest` 等を削除し、`preparePullRequest`（証跡要約）と`createPullRequest`のみへ |

## 残す最終形（v-next コマンド面）

`init` / `config` / `skills` / `codex` / `doctor` / `status` / `workspace` / `store` / `story`（list/add/select/archive/report） / `spec`（fingerprint/readiness/write/show/drift） / `review`（prepare/record + PR向けsummary） / `pr`（prepare=証跡要約, create） / `verify`（run/record/import-ci: テスト実行と結果記録のみ、Gate契約なし）

## テスト側

- KILL対象モジュールの単体テスト約45件、旧機構前提のe2e約42件（`test/e2e/story-vibepro-*`）を各スライスで同時削除。
- 受け入れ基準（REBUILD.md）: コミットごとの検証コストは対象テストのみで済む構成にする。フルスイートはCIのみとし、28分級のローカル必須実行を要求しない。

## 注意（調査で判明したリスク）

- `createPullRequest` が内部で `evaluateGateReadiness` を呼んでいる可能性が高い。Slice 6 の前に呼び出しグラフを実測すること。
- `story derive`（story-catalog-generator）と `artifact-routing` に route分類が混入している疑い。Slice 2 で `story diagnose`/`derive` を落とすか縮小するか判断する。
- dispatch基盤（codex-subagent系, agent-runtime-adapter系）は「軽量レビュー1周の並列dispatch」に必要なため残す。ただし lineage 記録部分は Slice 4 で剥がす。
