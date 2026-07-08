## 判断
- このPRで判断すること: PR #292（初見・レビュー4R・約40コマンド）と #293（レシピ学習済み・1R一発）の差はレシピ知識であり、それが人とメモに依存している を満たすための Runtime / Contract Docs / Tests 変更として、このPRを受け入れてよいか。
- Story: story-vibepro-recipe-preflight-autopilot - PR #292（初見・レビュー4R・約40コマンド）と #293（レシピ学習済み・1R一発）の差はレシピ知識であり、それが人とメモに依存している
- 正本: [docs/management/stories/active/story-vibepro-recipe-preflight-autopilot.md](docs/management/stories/active/story-vibepro-recipe-preflight-autopilot.md)
- 変更範囲: 11 files / Runtime / Contract Docs / Tests
- 設計/Story: [docs/management/stories/active/story-vibepro-recipe-preflight-autopilot.md](docs/management/stories/active/story-vibepro-recipe-preflight-autopilot.md), [docs/architecture/vibepro-recipe-preflight-autopilot.md](docs/architecture/vibepro-recipe-preflight-autopilot.md), [docs/specs/story-vibepro-recipe-preflight-autopilot.md](docs/specs/story-vibepro-recipe-preflight-autopilot.md)
- 実装: [src/pr-manager.js](src/pr-manager.js), [src/recipe-preflight.js](src/recipe-preflight.js)
- テスト: [test/e2e/story-vibepro-recipe-preflight-autopilot-main.spec.js](test/e2e/story-vibepro-recipe-preflight-autopilot-main.spec.js), [test/recipe-preflight.test.js](test/recipe-preflight.test.js), [test/vibepro-cli.test.js](test/vibepro-cli.test.js)

## 経緯
- 要求: PR #292（初見・レビュー4R・約40コマンド）と #293（レシピ学習済み・1R一発）の差はレシピ知識であり、それが人とメモに依存している
- 発生経緯: VibePro フローを一度通した agent は速い。#292 は初見でレビュー 4 ラウンド・フルスイート 2 回・約 40 コマンドを要したが、直後の #293 はレシピ学習済みで 1 ラウンド一発 pass だった。差を生んだのは dogfood メモに蓄積された非自明レシピ — 例: 実 exit code から生成した status JSON を `--artifact` 添付しないと judgment spine が strong にならない、generic 語のみの record は contract clause ID を本文に含めないとマッチしない、architecture gate の ADR 不要宣言は story frontmatter の `reason:` キー、followup decision は `--reason` と `--artifact` の両方が必要、design_diagrams は final spec の `diagrams[]` のみ、手書き Story は `.vibepro/config.json` の `brainbase.stories[]` へ登録、`review record` には `--inspection-input` が必要、等。 これらが人（agent の都度学習）とメモに依存している限り、初見 story は毎回 #292 のコストを払う。レシピを決定的な preflight...


## 原因
- 最新診断gateが needs_review

## 解決
- Story文書を更新: [docs/management/stories/active/story-vibepro-recipe-preflight-autopilot.md](docs/management/stories/active/story-vibepro-recipe-preflight-autopilot.md)

## レビュー観点
- Gate: 未解決の必須Gateはありません。ただしリリース判断Warning: Managed Worktree Gate。 詳細はVibePro証跡の Gate DAG / Gate Enforcement を確認してください。
- Scope: 差分範囲の説明または分割判断が必要。理由: baseからのcommitが 7 件あり、Story外の変更混入を確認する必要がある / split=split_by_lane_then_prepare
- 管理worktree: needs_review
- Storyの受け入れ基準と実装差分が対応しているか
- 主要ソース差分: [src/pr-manager.js](src/pr-manager.js), [src/recipe-preflight.js](src/recipe-preflight.js)
- テスト差分: [test/e2e/story-vibepro-recipe-preflight-autopilot-main.spec.js](test/e2e/story-vibepro-recipe-preflight-autopilot-main.spec.js), [test/recipe-preflight.test.js](test/recipe-preflight.test.js), [test/vibepro-cli.test.js](test/vibepro-cli.test.js)
- Risk: 最新診断gateが needs_review

## 確認
- [x] verification:typecheck - [package.json](package.json) の typecheck scriptでTypeScript/型境界を確認する / gate: passed / evidence: ../claude-502/-Users-ksato-workspace-code-vibepro--claude-worktrees-charming-lamport-915b50/668c5454-826e-4d87-a655-08eb9663bc74/scratchpad/rpa-evidence/typecheck-status.json
- [x] Unit Gate - Focused unit regression 19/19 pass at head 1b962501 with durable status artifact from the actual exit code. Covers RPA-CONTRACT-001 byte-identity mutation guard, RPA-CONTRACT-002 auto_fix schema compatibility, RPA-CONTRACT-003 deterministic detection, RPA-CONTRACT-004 clean-story no-op, RPA-CONTRACT-005 failure isolation, RPA-CONTRACT-006 open registry.; evidence: ../claude-502/-Users-ksato-workspace-code-vibepro--claude-worktrees-charming-lamport-915b50/668c5454-826e-4d87-a655-08eb9663bc74/scratchpad/rpa-evidence/unit-status.json / gate: passed / evidence: ../claude-502/-Users-ksato-workspace-code-vibepro--claude-worktrees-charming-lamport-915b50/668c5454-826e-4d87-a655-08eb9663bc74/scratchpad/rpa-evidence/unit-status.json
- [x] Integration Gate - artifact_replay: vibepro pr prepare replays the full Gate DAG at head 1b962501 with durable status artifact from the actual exit code; gate-dag.json, pr-prepare.json and evidence plans regenerated headlessly. Current reality: preflight remains a synchronous first phase with pure on-disk detections. Failure modes stay loud (RPA-CONTRACT-005).; evidence: ../claude-502/-Users-ksato-workspace-code-vibepro--claude-worktrees-charming-lamport-915b50/668c5454-826e-4d87-a655-08eb9663bc74/scratchpad/rpa-evidence/build-status.json / gate: passed / evidence: ../claude-502/-Users-ksato-workspace-code-vibepro--claude-worktrees-charming-lamport-915b50/668c5454-826e-4d87-a655-08eb9663bc74/scratchpad/rpa-evidence/build-status.json
- [x] E2E Gate - Story e2e 8/8 pass at head 1b962501 with durable status artifact from the actual exit code, re-run after the second rebase. scenario_clause_e2e: spec clauses S-001, S-002, S-003 driven through the real pr autopilot path plus the CLI text surface via runCli. flow_replay: autopilot preflight -> existing phases replays headlessly on the rebased composition.; evidence: ../claude-502/-Users-ksato-workspace-code-vibepro--claude-worktrees-charming-lamport-915b50/668c5454-826e-4d87-a655-08eb9663bc74/scratchpad/rpa-evidence/e2e-status.json / gate: passed / evidence: ../claude-502/-Users-ksato-workspace-code-vibepro--claude-worktrees-charming-lamport-915b50/668c5454-826e-4d87-a655-08eb9663bc74/scratchpad/rpa-evidence/e2e-status.json
- 最終E2E: pass: Story e2e 8/8 pass at head 1b962501 with durable status artifact from the actual exit code, re-run after the second rebase. scenario_clause_e2e: spec clauses S-001, S-002, S-003 driven through the real pr autopilot path plus the CLI text surface via runCli. flow_replay: autopilot preflight -> existing phases replays headlessly on the rebased composition.（../claude-502/-Users-ksato-workspace-code-vibepro--claude-worktrees-charming-lamport-915b50/668c5454-826e-4d87-a655-08eb9663bc74/scratchpad/rpa-evidence/e2e-status.json）

## 詳細
- 証跡: [.vibepro/pr/story-vibepro-recipe-preflight-autopilot/](.vibepro/pr/story-vibepro-recipe-preflight-autopilot/)
- PR準備: [.vibepro/pr/story-vibepro-recipe-preflight-autopilot/pr-prepare.json](.vibepro/pr/story-vibepro-recipe-preflight-autopilot/pr-prepare.json)
- 判断索引: [.vibepro/pr/story-vibepro-recipe-preflight-autopilot/decision-index.json](.vibepro/pr/story-vibepro-recipe-preflight-autopilot/decision-index.json)
- Gate: ready_for_review
- 実行状態: ready
- Scope: needs_clean_branch / clean_branch_or_split_pr
- Runtime: vibepro@0.1.0-beta.0 5ca5b016fe91 detached/package clean (story=story-vibepro-recipe-preflight-autopilot)
