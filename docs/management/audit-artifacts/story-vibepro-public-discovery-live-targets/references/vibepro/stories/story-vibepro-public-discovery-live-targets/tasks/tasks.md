# VibePro 生成タスク

| 項目 | 内容 |
|------|------|
| Story | Public Discoveryをビルド成果物・公開URLで検証し、0対象を判定不能にする |
| Story ID | story-vibepro-public-discovery-live-targets |
| Run ID | 2026-07-15T131208Z |
| Gate | pass |
| タスク数 | 4 |

| ID | Finding | 優先度 | 対象 | 方針 | 状態 |
|----|---------|--------|------|------|------|
| story-vibepro-public-discovery-live-targets-review | - | low | 8件 | review | todo |
| story-vibepro-public-discovery-live-targets-01-public-discovery-coverage | - | medium | 0件 | story-explicit-task | todo |
| story-vibepro-public-discovery-live-targets-02-cli-check-pack | - | medium | 0件 | story-explicit-task | todo |
| story-vibepro-public-discovery-live-targets-03-public-discovery-live-built-source | - | medium | 0件 | story-explicit-task | todo |

## story-vibepro-public-discovery-live-targets-review: Story仮説をレビューする

- Source: story_plan_candidate / story-vibepro-public-discovery-live-targets-review
- Execution: proposal_only / mutates_repository=false
- Target files: src/public-discovery-scanner.js, src/code-quality-scanner.js, src/nocodb-story-sync.js, src/story-candidate-generator.js, src/story-catalog-generator.js, src/story-html.js, src/story-manager.js, src/story-task-generator.js
- Target groups: -
- Read first: src/code-quality-scanner.js, src/nocodb-story-sync.js, src/public-discovery-scanner.js, src/story-candidate-generator.js, src/story-catalog-generator.js, src/story-html.js, src/cli.js, src/workspace.js, src/diagnostic-engine.js, test/e2e/story-vibepro-managed-worktree-execution-dag-main.test.js
- Recommended strategy: review

完了条件:
- meaning confidenceを確認する
- 次に診断するか、仕様を補うか、実装するか決める

## story-vibepro-public-discovery-live-targets-01-public-discovery-coverage: Public Discoveryの対象解決とcoverage契約

- Source: story_explicit_task / story-vibepro-public-discovery-live-targets-01-public-discovery-coverage
- Execution: proposal_only / mutates_repository=false
- Target files: -
- Target groups: -
- Read first: docs/management/stories/active/story-vibepro-public-discovery-live-targets.md
- Recommended strategy: story-explicit-task

完了条件:
- base-url > public-dir > repository source の優先順位で検査対象を解決する
- live/built/sourceの制限、失敗理由、検査件数を scan_coverage に記録する
- 0対象を inconclusive とし、既存findingのfail/needs_reviewを優先する

## story-vibepro-public-discovery-live-targets-02-cli-check-pack: CLIとcheck pack成果物の公開入力対応

- Source: story_explicit_task / story-vibepro-public-discovery-live-targets-02-cli-check-pack
- Execution: proposal_only / mutates_repository=false
- Target files: -
- Target groups: -
- Read first: docs/management/stories/active/story-vibepro-public-discovery-live-targets.md
- Recommended strategy: story-explicit-task

完了条件:
- check public-discovery|all へ --base-url と --public-dir を伝播する
- JSON/Markdown summaryへPublic Discovery coverageを独立表示する
- CLI helpと診断Skillに入力mode・上限・0対象の意味を記載する

## story-vibepro-public-discovery-live-targets-03-public-discovery-live-built-source: Public Discoveryのlive/built/source回帰検証

- Source: story_explicit_task / story-vibepro-public-discovery-live-targets-03-public-discovery-live-built-source
- Execution: proposal_only / mutates_repository=false
- Target files: -
- Target groups: -
- Read first: docs/management/stories/active/story-vibepro-public-discovery-live-targets.md
- Recommended strategy: story-explicit-task

完了条件:
- 再帰ビルド走査、同一origin sitemap、到達不能、過大応答をtargeted testで検証する
- 従来source走査、CLI引数、check pack成果物の互換性を検証する
- targeted test、full suite、Skill lint、AGENTS同期を完了する