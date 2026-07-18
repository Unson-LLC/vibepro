## 判断
- このPRで判断すること: judgment_dag_adjudication lacks an honest recovery path を満たすための Runtime / Contract Docs / Tests 変更として、このPRを受け入れてよいか。
- Story: story-vibepro-classifier-premise-recovery - judgment_dag_adjudication lacks an honest recovery path
- 正本: [docs/management/stories/active/story-vibepro-classifier-premise-recovery.md](docs/management/stories/active/story-vibepro-classifier-premise-recovery.md)
- 変更範囲: 16 files / Runtime / Contract Docs / Tests
- 設計/Story: [docs/management/stories/active/story-vibepro-classifier-premise-recovery.md](docs/management/stories/active/story-vibepro-classifier-premise-recovery.md), [docs/architecture/story-vibepro-classifier-premise-recovery.md](docs/architecture/story-vibepro-classifier-premise-recovery.md), [docs/specs/story-vibepro-classifier-premise-recovery.md](docs/specs/story-vibepro-classifier-premise-recovery.md), ...and 1 more
- 実装: [src/adjudication.js](src/adjudication.js), [src/cli.js](src/cli.js), [src/pr-manager.js](src/pr-manager.js)
- テスト: [test/e2e/story-vibepro-classifier-premise-recovery-main.spec.ts](test/e2e/story-vibepro-classifier-premise-recovery-main.spec.ts), [test/e2e/story-vibepro-judgment-dag-adjudication-main.test.js](test/e2e/story-vibepro-judgment-dag-adjudication-main.test.js), [test/judgment-adjudication.test.js](test/judgment-adjudication.test.js)

## 経緯
- 要求: judgment_dag_adjudication lacks an honest recovery path
- 要求ID: #340
- 発生経緯: 現状の `gate:judgment_dag_adjudication` は `judged_unsound` を常に実装不成立として扱う。 これは実装や証拠が不十分な場合には正しいが、上流classifierが「この変更には当該failure modeが 存在する」などの誤ったpremiseを作った場合、独立judgeが正しく否定しても回復経路がない。 さらに同一itemの裁定記録は置換されるため、元裁定と訂正・再裁定の系譜を監査できない。


## 原因
- 最新診断gateが needs_review

## 解決
- 最初に既存挙動を再現するRedテストを追加する。データフロー、artifact migration、 current-state resolver、CLI入力検証、Gate状態遷移を分離して検証し、最後にVibeProの current HEADへ証跡を記録する。

## レビュー観点
- Gate: 未解決の必須Gateはありません。レビューでは差分の妥当性とスコープを確認してください。
- Scope: 差分範囲の説明または分割判断が必要。理由: baseからのcommitが 6 件あり、Story外の変更混入を確認する必要がある / split=split_by_lane_then_prepare
- 管理worktree: passed
- Storyの受け入れ基準と実装差分が対応しているか
- 主要ソース差分: [src/adjudication.js](src/adjudication.js), [src/cli.js](src/cli.js), [src/pr-manager.js](src/pr-manager.js)
- テスト差分: [test/e2e/story-vibepro-classifier-premise-recovery-main.spec.ts](test/e2e/story-vibepro-classifier-premise-recovery-main.spec.ts), [test/e2e/story-vibepro-judgment-dag-adjudication-main.test.js](test/e2e/story-vibepro-judgment-dag-adjudication-main.test.js), [test/judgment-adjudication.test.js](test/judgment-adjudication.test.js)
- Risk: 最新診断gateが needs_review

## 確認
- [x] verification:typecheck - [package.json](package.json) の typecheck scriptでTypeScript/型境界を確認する / gate: passed
- [x] Unit Gate - unit_regression for VIBE-RAR-001 VIBE-RAR-002 VIBE-CORE-COST-001: 39/39 pass; evidence: [.vibepro/pr/story-vibepro-classifier-premise-recovery/preflight-artifacts/e2e-status.json](.vibepro/pr/story-vibepro-classifier-premise-recovery/preflight-artifacts/e2e-status.json) / gate: passed / evidence: [.vibepro/pr/story-vibepro-classifier-premise-recovery/preflight-artifacts/e2e-status.json](.vibepro/pr/story-vibepro-classifier-premise-recovery/preflight-artifacts/e2e-status.json)
- [x] Integration Gate - real CLI flow replay 12/12 pass after CI import; evidence: [.vibepro/pr/story-vibepro-classifier-premise-recovery/preflight-artifacts/e2e-status.json](.vibepro/pr/story-vibepro-classifier-premise-recovery/preflight-artifacts/e2e-status.json) / gate: passed / evidence: [.vibepro/pr/story-vibepro-classifier-premise-recovery/preflight-artifacts/e2e-status.json](.vibepro/pr/story-vibepro-classifier-premise-recovery/preflight-artifacts/e2e-status.json)
- [x] E2E Gate - real CLIで誤裁定の保存、根拠付き訂正、別judgeによる再裁定、judgment Gate回帰を12/12で検証; evidence: [.vibepro/pr/story-vibepro-classifier-premise-recovery/preflight-artifacts/e2e-status.json](.vibepro/pr/story-vibepro-classifier-premise-recovery/preflight-artifacts/e2e-status.json) / gate: passed / evidence: [.vibepro/pr/story-vibepro-classifier-premise-recovery/preflight-artifacts/e2e-status.json](.vibepro/pr/story-vibepro-classifier-premise-recovery/preflight-artifacts/e2e-status.json)
- 最終E2E: passed: real CLIで誤裁定の保存、根拠付き訂正、別judgeによる再裁定、judgment Gate回帰を12/12で検証（[.vibepro/pr/story-vibepro-classifier-premise-recovery/preflight-artifacts/e2e-status.json](.vibepro/pr/story-vibepro-classifier-premise-recovery/preflight-artifacts/e2e-status.json)）

## 詳細
- 証跡: [.vibepro/pr/story-vibepro-classifier-premise-recovery/](.vibepro/pr/story-vibepro-classifier-premise-recovery/)
- PR準備: [.vibepro/pr/story-vibepro-classifier-premise-recovery/pr-prepare.json](.vibepro/pr/story-vibepro-classifier-premise-recovery/pr-prepare.json)
- 判断索引: [.vibepro/pr/story-vibepro-classifier-premise-recovery/decision-index.json](.vibepro/pr/story-vibepro-classifier-premise-recovery/decision-index.json)
- Gate: ready_for_review
- 実行状態: ready
- Scope: needs_clean_branch / clean_branch_or_split_pr
- Runtime: vibepro@0.2.0-beta.0 6581d3301663 codex/story-vibepro-classifier-premise-recovery clean (story=story-vibepro-classifier-premise-recovery)
