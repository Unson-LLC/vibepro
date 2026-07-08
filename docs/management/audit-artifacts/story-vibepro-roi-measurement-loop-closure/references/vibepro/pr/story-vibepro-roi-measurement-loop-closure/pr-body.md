## 判断
- このPRで判断すること: gate-outcomes ledger が gitignore + worktree ローカルのため、#287/#291 の計測ループが空回りしている を満たすための Runtime / Contract Docs / Tests 変更として、このPRを受け入れてよいか。
- Story: story-vibepro-roi-measurement-loop-closure - gate-outcomes ledger が gitignore + worktree ローカルのため、#287/#291 の計測ループが空回りしている
- 正本: [docs/management/stories/active/story-vibepro-roi-measurement-loop-closure.md](docs/management/stories/active/story-vibepro-roi-measurement-loop-closure.md)
- 変更範囲: 12 files / Runtime / Contract Docs / Tests
- 設計/Story: [docs/management/stories/active/story-vibepro-roi-measurement-loop-closure.md](docs/management/stories/active/story-vibepro-roi-measurement-loop-closure.md), [docs/architecture/vibepro-roi-measurement-loop-closure.md](docs/architecture/vibepro-roi-measurement-loop-closure.md), [docs/specs/story-vibepro-roi-measurement-loop-closure.md](docs/specs/story-vibepro-roi-measurement-loop-closure.md)
- 実装: [src/cli.js](src/cli.js), [src/gate-outcome-ledger.js](src/gate-outcome-ledger.js), [src/merge-manager.js](src/merge-manager.js), ...and 1 more
- テスト: [test/gate-outcome-ledger-central-promotion.test.js](test/gate-outcome-ledger-central-promotion.test.js), [test/gate-outcome-ledger-promotion-integration.test.js](test/gate-outcome-ledger-promotion-integration.test.js)

## 経緯
- 要求: gate-outcomes ledger が gitignore + worktree ローカルのため、#287/#291 の計測ループが空回りしている
- 発生経緯: `gate:*` の解消履歴を貯める ROI 台帳（`.vibepro/gate-outcomes/ledger.json`、#287）は、gitignore されたローカルファイルとして各 worktree に分断されている。実データは存在する（ci-gate-check worktree に senior_gap_judgment の needs_review→passed エントリ等）が、mainには台帳が存在せず、月次ゲートチューニング定例（#291、`docs/guide/gate-tuning-ritual.md`）が読むべきデータの蓄積先がない。エントリの outcome も `unclassified` のまま放置さ


## 原因
- 最新診断gateが needs_review

## 解決
- Story文書を更新: [docs/management/stories/active/story-vibepro-roi-measurement-loop-closure.md](docs/management/stories/active/story-vibepro-roi-measurement-loop-closure.md)

## レビュー観点
- Gate: 未解決の必須Gateはありません。ただしリリース判断Warning: Managed Worktree Gate。 詳細はVibePro証跡の Gate DAG / Gate Enforcement を確認してください。
- Scope: 差分範囲の説明または分割判断が必要。理由: baseからのcommitが 5 件あり、Story外の変更混入を確認する必要がある / split=split_by_lane_then_prepare
- 管理worktree: needs_review
- Storyの受け入れ基準と実装差分が対応しているか
- 主要ソース差分: [src/cli.js](src/cli.js), [src/gate-outcome-ledger.js](src/gate-outcome-ledger.js), [src/merge-manager.js](src/merge-manager.js), [src/usage-report.js](src/usage-report.js)
- テスト差分: [test/gate-outcome-ledger-central-promotion.test.js](test/gate-outcome-ledger-central-promotion.test.js), [test/gate-outcome-ledger-promotion-integration.test.js](test/gate-outcome-ledger-promotion-integration.test.js)
- Risk: 最新診断gateが needs_review

## 確認
- [x] Unit Gate - 変更に対応する対象テスト / gate: passed / evidence: ../claude-502/-Users-ksato-workspace-code-vibepro--claude-worktrees-charming-lamport-915b50/668c5454-826e-4d87-a655-08eb9663bc74/scratchpad/rml-evidence/ledger-tests-status.json
- [x] verification:typecheck - [package.json](package.json) の typecheck scriptでTypeScript/型境界を確認する / gate: passed / evidence: ../claude-502/-Users-ksato-workspace-code-vibepro--claude-worktrees-festive-proskuriakova-fbf353/668c5454-826e-4d87-a655-08eb9663bc74/scratchpad/rml-evidence/typecheck-status.json
- [x] Unit Gate - RML-CONTRACT-002/003/004/005 unit coverage: promotion, entry_key dedupe, no_entries on empty local ledger, deterministic serialization, corrupt-central failure, and usage report --gate-roi summary shape. 9/9 passed.; evidence: ../claude-502/-Users-ksato-workspace-code-vibepro--claude-worktrees-festive-proskuriakova-fbf353/668c5454-826e-4d87-a655-08eb9663bc74/scratchpad/rml-evidence/unit-status.json / gate: passed / evidence: ../claude-502/-Users-ksato-workspace-code-vibepro--claude-worktrees-festive-proskuriakova-fbf353/668c5454-826e-4d87-a655-08eb9663bc74/scratchpad/rml-evidence/unit-status.json
- [x] E2E Gate - RML-CONTRACT-005/RML-S-4 flow replay through the real CLI ([bin/vibepro.js](bin/vibepro.js)): usage report --gate-roi performs an artifact_replay of the persisted central ledger artifact ([docs/management/roi-ledger/ledger.json](docs/management/roi-ledger/ledger.json)), reporting per-gate counts, classification distribution, and explicit unclassified_count=1 (never coerced to zero); confirms --gate-roi absence keeps backward-compatible output.; evidence: ../claude-502/-Users-ksato-workspace-code-vibepro--claude-worktrees-festive-proskuriakova-fbf353/668c5454-826e-4d87-a655-08eb9663bc74/scratchpad/rml-evidence/e2e-status.json / gate: passed / evidence: ../claude-502/-Users-ksato-workspace-code-vibepro--claude-worktrees-festive-proskuriakova-fbf353/668c5454-826e-4d87-a655-08eb9663bc74/scratchpad/rml-evidence/e2e-status.json
- 最終E2E: pass: RML-CONTRACT-005/RML-S-4 flow replay through the real CLI ([bin/vibepro.js](bin/vibepro.js)): usage report --gate-roi performs an artifact_replay of the persisted central ledger artifact ([docs/management/roi-ledger/ledger.json](docs/management/roi-ledger/ledger.json)), reporting per-gate counts, classification distribution, and explicit unclassified_count=1 (never coerced to zero); confirms --gate-roi absence keeps backward-compatible output.（../claude-502/-Users-ksato-workspace-code-vibepro--claude-worktrees-festive-proskuriakova-fbf353/668c5454-826e-4d87-a655-08eb9663bc74/scratchpad/rml-evidence/e2e-status.json）

## 詳細
- 証跡: [.vibepro/pr/story-vibepro-roi-measurement-loop-closure/](.vibepro/pr/story-vibepro-roi-measurement-loop-closure/)
- PR準備: [.vibepro/pr/story-vibepro-roi-measurement-loop-closure/pr-prepare.json](.vibepro/pr/story-vibepro-roi-measurement-loop-closure/pr-prepare.json)
- 判断索引: [.vibepro/pr/story-vibepro-roi-measurement-loop-closure/decision-index.json](.vibepro/pr/story-vibepro-roi-measurement-loop-closure/decision-index.json)
- Gate: ready_for_review
- 実行状態: ready
- Scope: needs_clean_branch / clean_branch_or_split_pr
- Runtime: vibepro@0.1.0-beta.0 8b91e3fce07f detached/package clean (story=story-vibepro-roi-measurement-loop-closure)
