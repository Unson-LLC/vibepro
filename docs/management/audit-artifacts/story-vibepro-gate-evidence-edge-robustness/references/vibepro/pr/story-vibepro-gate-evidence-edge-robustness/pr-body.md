## 判断
- このPRで判断すること: canonical checkout上の未コミット実験編集のうち、健全なrobustness/correctness改善のみを正式化する を満たすための Runtime / Contract Docs / Tests 変更として、このPRを受け入れてよいか。
- Story: story-vibepro-gate-evidence-edge-robustness - canonical checkout上の未コミット実験編集のうち、健全なrobustness/correctness改善のみを正式化する
- 正本: [docs/management/stories/active/story-vibepro-gate-evidence-edge-robustness.md](docs/management/stories/active/story-vibepro-gate-evidence-edge-robustness.md)
- 変更範囲: 9 files / Runtime / Contract Docs / Tests
- 設計/Story: [docs/management/stories/active/story-vibepro-gate-evidence-edge-robustness.md](docs/management/stories/active/story-vibepro-gate-evidence-edge-robustness.md), [docs/architecture/vibepro-gate-evidence-edge-robustness.md](docs/architecture/vibepro-gate-evidence-edge-robustness.md), [docs/specs/story-vibepro-gate-evidence-edge-robustness.vibepro.json](docs/specs/story-vibepro-gate-evidence-edge-robustness.vibepro.json), ...and 1 more
- 実装: [src/execution-state.js](src/execution-state.js), [src/pr-manager.js](src/pr-manager.js)
- テスト: [test/e2e/story-vibepro-gate-evidence-edge-robustness-main.test.js](test/e2e/story-vibepro-gate-evidence-edge-robustness-main.test.js), [test/gate-evidence-edge-robustness.test.js](test/gate-evidence-edge-robustness.test.js)

## 経緯
- 要求: canonical checkout上の未コミット実験編集のうち、健全なrobustness/correctness改善のみを正式化する
- 要求ID: VP-SALVAGE-2026-07-14-GATE-EVIDENCE-ROBUSTNESS
- 発生経緯: canonical checkout（`~/workspace/code/vibepro`）に、172コミット前の実験的な未コミット編集が salvageブランチ（`salvage/pre-reevolve-main-2026-07-14`）として残っていた。6編集を現行mainに対して シニア判断で精査した結果、以下2件のみが「上流に存在せず・安全・実利のあるrobustness/correctness改善」 と確認できた（残り4件は上流で解決済み・消費者なし・あるいはセキュリティ/契約bindingを弱める退行のため除外）。 1. `safeReaddir`（execution-state.js）が `ENOENT` のみをハンドルし、`ENOTDIR` を投げてしまう。 本来ディレクトリであるべきパスがファイルだった場合（壊れたworkspace）、走査系が例外で停止する。 `ENOTDIR` も「エントリなし（`[]`）」として扱うのが正しい（`safeReaddir` の設計意図＝走査対象が 無ければ空を返す、に合致）。 2. `buildEvidenceItem`（pr-manager.js）が `...extra` を最後に展開しているため、`extra` に `kind` や `ref` が含まれると明示引数を黙って上書きできてしまう。実際、呼び出しの1つ（`classifySeniorAxisEvidence` 内の `add`）は `{...


## 原因
- 最新診断gateが needs_review

## 解決
- Story文書を更新: [docs/management/stories/active/story-vibepro-gate-evidence-edge-robustness.md](docs/management/stories/active/story-vibepro-gate-evidence-edge-robustness.md)

## レビュー観点
- Gate: 未解決の必須Gateはありません。ただしリリース判断Warning: Managed Worktree Gate。 詳細はVibePro証跡の Gate DAG / Gate Enforcement を確認してください。
- Scope: 差分範囲の説明または分割判断が必要。理由: baseからのcommitが 6 件あり、Story外の変更混入を確認する必要がある / split=split_by_lane_then_prepare
- 管理worktree: needs_review
- Storyの受け入れ基準と実装差分が対応しているか
- 主要ソース差分: [src/execution-state.js](src/execution-state.js), [src/pr-manager.js](src/pr-manager.js)
- テスト差分: [test/e2e/story-vibepro-gate-evidence-edge-robustness-main.test.js](test/e2e/story-vibepro-gate-evidence-edge-robustness-main.test.js), [test/gate-evidence-edge-robustness.test.js](test/gate-evidence-edge-robustness.test.js)
- Risk: 最新診断gateが needs_review

## 確認
- [x] Unit Gate - unit_regression: GER-S-001〜005+gate check 8件pass。VIBE-RAR-001/002退行なし; evidence: [.vibepro/qa/story-vibepro-gate-evidence-edge-robustness/bundle-fd9745a.json](.vibepro/qa/story-vibepro-gate-evidence-edge-robustness/bundle-fd9745a.json) / gate: passed / evidence: [.vibepro/qa/story-vibepro-gate-evidence-edge-robustness/bundle-fd9745a.json](.vibepro/qa/story-vibepro-gate-evidence-edge-robustness/bundle-fd9745a.json)
- [x] Integration Gate - integration_runtime_path: preparePullRequest実駆動でbuildEvidenceItem・safeReaddirを実経路で行使する統合40件pass。退行なし; evidence: [.vibepro/qa/story-vibepro-gate-evidence-edge-robustness/bundle-fd9745a.json](.vibepro/qa/story-vibepro-gate-evidence-edge-robustness/bundle-fd9745a.json) / gate: passed / evidence: [.vibepro/qa/story-vibepro-gate-evidence-edge-robustness/bundle-fd9745a.json](.vibepro/qa/story-vibepro-gate-evidence-edge-robustness/bundle-fd9745a.json)
- [x] E2E Gate - flow_replay/scenario_clause_e2e: 実tmp git repoでpr-prepare flowをend-to-end再生、ac:1..ac:7+scenario S-001..S-003を検証(6件pass); evidence: [.vibepro/qa/story-vibepro-gate-evidence-edge-robustness/bundle-fd9745a.json](.vibepro/qa/story-vibepro-gate-evidence-edge-robustness/bundle-fd9745a.json) / gate: passed / evidence: [.vibepro/qa/story-vibepro-gate-evidence-edge-robustness/bundle-fd9745a.json](.vibepro/qa/story-vibepro-gate-evidence-edge-robustness/bundle-fd9745a.json)
- 最終E2E: pass: flow_replay/scenario_clause_e2e: 実tmp git repoでpr-prepare flowをend-to-end再生、ac:1..ac:7+scenario S-001..S-003を検証(6件pass)（[.vibepro/qa/story-vibepro-gate-evidence-edge-robustness/bundle-fd9745a.json](.vibepro/qa/story-vibepro-gate-evidence-edge-robustness/bundle-fd9745a.json)）

## 詳細
- 証跡: [.vibepro/pr/story-vibepro-gate-evidence-edge-robustness/](.vibepro/pr/story-vibepro-gate-evidence-edge-robustness/)
- PR準備: [.vibepro/pr/story-vibepro-gate-evidence-edge-robustness/pr-prepare.json](.vibepro/pr/story-vibepro-gate-evidence-edge-robustness/pr-prepare.json)
- 判断索引: [.vibepro/pr/story-vibepro-gate-evidence-edge-robustness/decision-index.json](.vibepro/pr/story-vibepro-gate-evidence-edge-robustness/decision-index.json)
- Gate: ready_for_review
- 実行状態: ready
- Scope: needs_clean_branch / clean_branch_or_split_pr
- Runtime: vibepro@0.1.0-beta.0 fd9745a3777a vibepro/story-vibepro-gate-evidence-edge-robustness clean (story=story-vibepro-gate-evidence-edge-robustness)
