## 判断
- このPRで判断すること: Flow Design GateがUI走査0件のままpassを返し、UIの構造問題を一切見ないまま合格扱いになった を満たすための Runtime / Contract Docs / Tests 変更として、このPRを受け入れてよいか。
- Story: story-vibepro-scanner-inconclusive-coverage - Flow Design GateがUI走査0件のままpassを返し、UIの構造問題を一切見ないまま合格扱いになった
- 正本: [docs/management/stories/active/story-vibepro-scanner-inconclusive-coverage.md](docs/management/stories/active/story-vibepro-scanner-inconclusive-coverage.md)
- 変更範囲: 18 files / Runtime / Contract Docs / Tests
- 設計/Story: [docs/management/stories/active/story-vibepro-scanner-inconclusive-coverage.md](docs/management/stories/active/story-vibepro-scanner-inconclusive-coverage.md), [docs/architecture/story-vibepro-scanner-inconclusive-coverage.md](docs/architecture/story-vibepro-scanner-inconclusive-coverage.md), [docs/architecture/vibepro-scanner-inconclusive-coverage.md](docs/architecture/vibepro-scanner-inconclusive-coverage.md), ...and 2 more
- 実装: [src/check-packs.js](src/check-packs.js), [src/diagnostic-engine.js](src/diagnostic-engine.js), [src/flow-design-scanner.js](src/flow-design-scanner.js), ...and 6 more
- テスト: [test/e2e/story-vibepro-scanner-inconclusive-coverage-main.test.js](test/e2e/story-vibepro-scanner-inconclusive-coverage-main.test.js), [test/scan-status.test.js](test/scan-status.test.js)

## 経緯
- 要求: Flow Design GateがUI走査0件のままpassを返し、UIの構造問題を一切見ないまま合格扱いになった
- 要求ID: VP-INCIDENT-2026-07-13-SALESTAILOR-BLUEPRINT-VACUUM-PASS
- 発生経緯: 2026-07-13 SalesTailor Blueprintインシデントで、Flow Design Gateは「UI走査ファイル0件」のまま `pass` を返した。対象リポジトリは素のNode.jsでHTMLを生成する構成で、Next.js規約の ディレクトリ（`app/`, `pages/`, `components/`等）にUIファイルが存在せず、スキャナは 何も検査していなかった。この「検査対象なし=問題なし」はスキャナ全般に共通する `findings.length > 0 ? fail : pass` パターンの帰結であり、ゲートへの信頼を破壊する （合格表示が「検査した上で問題なし」なのか「何も見ていない」なのか区別できない）。 対策は状態語彙の分離: findingsベースの判定（block / fail / needs_review / pass）が常に優先され、 走査0件でfindingsが無く従来 `pass` になっていた場合のみ **`inconclusive` / `not_applicable`** へ 置換する。UI storyでの0件は既存critical finding（FLOW-NO-UI-CODE）による `block` を弱めない。 inconclusiveは今回の導入では非ブロッキング（表示・機械可読状態の正直化が目的）。


## 原因
- 最新診断gateが needs_review

## 解決
- Story文書を更新: [docs/management/stories/active/story-vibepro-scanner-inconclusive-coverage.md](docs/management/stories/active/story-vibepro-scanner-inconclusive-coverage.md)

## レビュー観点
- Gate: 未解決の必須Gateはありません。レビューでは差分の妥当性とスコープを確認してください。
- Scope: 差分範囲の説明または分割判断が必要。理由: baseからのcommitが 9 件あり、Story外の変更混入を確認する必要がある / split=split_by_lane_then_prepare
- 管理worktree: passed
- Storyの受け入れ基準と実装差分が対応しているか
- 主要ソース差分: [src/check-packs.js](src/check-packs.js), [src/diagnostic-engine.js](src/diagnostic-engine.js), [src/flow-design-scanner.js](src/flow-design-scanner.js), [src/gate-outcome-ledger.js](src/gate-outcome-ledger.js), ...
- テスト差分: [test/e2e/story-vibepro-scanner-inconclusive-coverage-main.test.js](test/e2e/story-vibepro-scanner-inconclusive-coverage-main.test.js), [test/scan-status.test.js](test/scan-status.test.js)
- Risk: 最新診断gateが needs_review

## 確認
- [x] verification:typecheck - [package.json](package.json) の typecheck scriptでTypeScript/型境界を確認する / gate: passed / evidence: [.vibepro/qa/story-vibepro-scanner-inconclusive-coverage/typecheck-e3dbfc7.log](.vibepro/qa/story-vibepro-scanner-inconclusive-coverage/typecheck-e3dbfc7.log)
- [x] Unit Gate - HEAD e3dbfc7で全1029テストpass。unit_regression（既存gate orchestration・responsibility authority・evidence lifecycle系を含む全suite回帰、既存テスト無修正でgreen）。negative_path: pre-fix実装で失敗する負例を含む; evidence: [.vibepro/qa/story-vibepro-scanner-inconclusive-coverage/npm-test-e3dbfc7.json](.vibepro/qa/story-vibepro-scanner-inconclusive-coverage/npm-test-e3dbfc7.json) / gate: passed / evidence: [.vibepro/qa/story-vibepro-scanner-inconclusive-coverage/npm-test-e3dbfc7.json](.vibepro/qa/story-vibepro-scanner-inconclusive-coverage/npm-test-e3dbfc7.json)
- [x] Integration Gate - integration_runtime_path: SIC-E2E群が実tmp-dir repoで実スキャナ+実runCheckPackを駆動し3状態遷移・gate成果物・check.json統合を検証。1029/1029 pass、current_head_verification; evidence: [.vibepro/qa/story-vibepro-scanner-inconclusive-coverage/npm-test-e3dbfc7.json](.vibepro/qa/story-vibepro-scanner-inconclusive-coverage/npm-test-e3dbfc7.json) / gate: passed / evidence: [.vibepro/qa/story-vibepro-scanner-inconclusive-coverage/npm-test-e3dbfc7.json](.vibepro/qa/story-vibepro-scanner-inconclusive-coverage/npm-test-e3dbfc7.json)
- [x] E2E Gate - 実tmp-dir repoに対する実スキャナ/実runCheckPackのend-to-end 11件全pass。findings-first block維持、gate-dag/pr-prepare成果物の正直化（needs_evidenceでない空虚passの排除）、artifact replayでの判定根拠再構成; evidence: [.vibepro/qa/story-vibepro-scanner-inconclusive-coverage/npm-test-e3dbfc7.json](.vibepro/qa/story-vibepro-scanner-inconclusive-coverage/npm-test-e3dbfc7.json) / gate: passed / evidence: [.vibepro/qa/story-vibepro-scanner-inconclusive-coverage/npm-test-e3dbfc7.json](.vibepro/qa/story-vibepro-scanner-inconclusive-coverage/npm-test-e3dbfc7.json)
- 最終E2E: pass: 実tmp-dir repoに対する実スキャナ/実runCheckPackのend-to-end 11件全pass。findings-first block維持、gate-dag/pr-prepare成果物の正直化（needs_evidenceでない空虚passの排除）、artifact replayでの判定根拠再構成（[.vibepro/qa/story-vibepro-scanner-inconclusive-coverage/npm-test-e3dbfc7.json](.vibepro/qa/story-vibepro-scanner-inconclusive-coverage/npm-test-e3dbfc7.json)）

## 詳細
- 証跡: [.vibepro/pr/story-vibepro-scanner-inconclusive-coverage/](.vibepro/pr/story-vibepro-scanner-inconclusive-coverage/)
- PR準備: [.vibepro/pr/story-vibepro-scanner-inconclusive-coverage/pr-prepare.json](.vibepro/pr/story-vibepro-scanner-inconclusive-coverage/pr-prepare.json)
- 判断索引: [.vibepro/pr/story-vibepro-scanner-inconclusive-coverage/decision-index.json](.vibepro/pr/story-vibepro-scanner-inconclusive-coverage/decision-index.json)
- Gate: ready_for_review
- 実行状態: ready
- Scope: needs_clean_branch / clean_branch_or_split_pr
- Runtime: vibepro@0.1.0-beta.0 e3dbfc7f15fc vibepro/story-vibepro-scanner-inconclusive-coverage-68xjdb clean (story=story-vibepro-scanner-inconclusive-coverage)
