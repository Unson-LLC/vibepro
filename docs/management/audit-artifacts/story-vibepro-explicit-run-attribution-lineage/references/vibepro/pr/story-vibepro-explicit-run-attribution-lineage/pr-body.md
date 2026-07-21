## 判断
- このPRで判断すること: Codex DesktopのThreadと内部sessionの対応は公開契約ではなく、利用者によるThread分離を正確な価値監査の前提にできない を満たすための Runtime / Contract Docs / Tests 変更として、このPRを受け入れてよいか。
- Story: story-vibepro-explicit-run-attribution-lineage - Codex DesktopのThreadと内部sessionの対応は公開契約ではなく、利用者によるThread分離を正確な価値監査の前提にできない
- 正本: [docs/management/stories/active/story-vibepro-explicit-run-attribution-lineage.md](docs/management/stories/active/story-vibepro-explicit-run-attribution-lineage.md)
- 変更範囲: 7 files / Runtime / Contract Docs / Tests
- 設計/Story: [docs/architecture/story-vibepro-explicit-run-attribution-lineage.md](docs/architecture/story-vibepro-explicit-run-attribution-lineage.md), [docs/specs/story-vibepro-explicit-run-attribution-lineage.md](docs/specs/story-vibepro-explicit-run-attribution-lineage.md)
- 実装: [src/canonical-audit.js](src/canonical-audit.js), [src/run-lineage.js](src/run-lineage.js)
- テスト: [test/canonical-audit-self-contained.test.js](test/canonical-audit-self-contained.test.js), [test/run-lineage.test.js](test/run-lineage.test.js), [test/session-efficiency-run-lineage.test.js](test/session-efficiency-run-lineage.test.js)

## 経緯
- 要求: Codex DesktopのThreadと内部sessionの対応は公開契約ではなく、利用者によるThread分離を正確な価値監査の前提にできない
- 発生経緯: 現在の価値監査は、Codex session JSONL、cwd、branch、worktree、Story idの文字列、process managerを組み合わせてStory帰属を推定している。`session-attribution-boundary-guard` によりmixed parentの過大帰属は検知できるが、VibeProが実行した作業についても「どのStory/Runがどのagent実行・証跡・session eventを生んだか」という正のlineageは残らない。 Codex DesktopのThreadは利用者向けの会話単位であり、内部sessionとの1対1対応はVibeProが依存できる公開契約ではない。したがって「StoryごとにThreadを分ける」は任意の運用改善にはなっても、正確な監査の成立条件にはできない。 VibeProにはすでにGuarded Runの正本である`story_id`と`run_id`がある。このidentityをagent dispatch、provider observation、verification/review evidence、session-costへ伝播し、VibePro自身が開始・記録した作業だけを明示帰属する。親sessionに複数Storyが混在しても、Story固有event、共有parent overhead、未帰属、replayed contextを混ぜない。 **As...


## 原因
- 現在の価値監査は、Codex session JSONL、cwd、branch、worktree、Story idの文字列、process managerを組み合わせてStory帰属を推定している。`session-attribution-boundary-guard` によりmixed parentの過大帰属は検知できるが、VibeProが実行した作業についても「どのStory/Runがどのagent実行・証跡・session eventを生んだか」という正のlineageは残らない。 Codex DesktopのThreadは利用者向けの会話単位であり、内部sessionとの1対1対応はVibeProが依存できる公開契約ではない。したがって「StoryごとにThreadを分ける」は任意の運用改善にはなっても、正確な監査の成立条件にはできない。 VibeProにはすでにGuarded Runの正本である`story_id`と`run_id`がある。このidentityをagent dispatch、provider observation、verification/review evidence、session-costへ伝播し、VibePro自身が開始・記録した作業だけを明示帰属する。親sessionに複数Storyが混在しても、Story固有event、共有parent overhead、未帰属、replayed contextを混ぜない。

## 解決
- アーキテクチャ判断を追加: [docs/architecture/story-vibepro-explicit-run-attribution-lineage.md](docs/architecture/story-vibepro-explicit-run-attribution-lineage.md)

## Release Notes

### Change Summary
アーキテクチャ判断を追加: [docs/architecture/story-vibepro-explicit-run-attribution-lineage.md](docs/architecture/story-vibepro-explicit-run-attribution-lineage.md)

### Compatibility
なし

### User Action
なし

## レビュー観点
- Gate: 未解決の必須Gateはありません。ただしリリース判断Warning: Managed Worktree Gate。 詳細はVibePro証跡の Gate DAG / Gate Enforcement を確認してください。
- Scope: 差分範囲の説明または分割判断が必要。理由: baseからのcommitが 5 件あり、Story外の変更混入を確認する必要がある / split=split_by_lane_then_prepare
- 管理worktree: needs_review
- 主要ソース差分: [src/canonical-audit.js](src/canonical-audit.js), [src/run-lineage.js](src/run-lineage.js)
- テスト差分: [test/canonical-audit-self-contained.test.js](test/canonical-audit-self-contained.test.js), [test/run-lineage.test.js](test/run-lineage.test.js), [test/session-efficiency-run-lineage.test.js](test/session-efficiency-run-lineage.test.js)
- Risk: 最新診断gateが needs_review

## 確認
- [x] verification:typecheck - [package.json](package.json) の typecheck scriptでTypeScript/型境界を確認する / gate: passed
- [x] Unit Gate - Current-head focused lineage and authority suite passes 130/130; evidence: [.vibepro/evidence-artifacts/story-vibepro-explicit-run-attribution-lineage/unit-current-head.tap](.vibepro/evidence-artifacts/story-vibepro-explicit-run-attribution-lineage/unit-current-head.tap) / gate: passed / evidence: [.vibepro/evidence-artifacts/story-vibepro-explicit-run-attribution-lineage/unit-current-head.tap](.vibepro/evidence-artifacts/story-vibepro-explicit-run-attribution-lineage/unit-current-head.tap)
- [x] Integration Gate - Contract-bound responsibility, review-surface, lifecycle regression, and agent review at current HEAD; evidence: [.vibepro/evidence-artifacts/story-vibepro-explicit-run-attribution-lineage/integration-current-head.tap](.vibepro/evidence-artifacts/story-vibepro-explicit-run-attribution-lineage/integration-current-head.tap) / gate: passed / evidence: [.vibepro/evidence-artifacts/story-vibepro-explicit-run-attribution-lineage/integration-current-head.tap](.vibepro/evidence-artifacts/story-vibepro-explicit-run-attribution-lineage/integration-current-head.tap)
- 最終E2E: pass: Current-head flow and artifact replay with scenario clauses and authoritative signal monitoring（[.vibepro/evidence-artifacts/story-vibepro-explicit-run-attribution-lineage/e2e-current-head.tap](.vibepro/evidence-artifacts/story-vibepro-explicit-run-attribution-lineage/e2e-current-head.tap)）

## 詳細
- 証跡: [.vibepro/pr/story-vibepro-explicit-run-attribution-lineage/](.vibepro/pr/story-vibepro-explicit-run-attribution-lineage/)
- PR準備: [.vibepro/pr/story-vibepro-explicit-run-attribution-lineage/pr-prepare.json](.vibepro/pr/story-vibepro-explicit-run-attribution-lineage/pr-prepare.json)
- 判断索引: [.vibepro/pr/story-vibepro-explicit-run-attribution-lineage/decision-index.json](.vibepro/pr/story-vibepro-explicit-run-attribution-lineage/decision-index.json)
- Gate: ready_for_review
- 実行状態: ready
- Scope: needs_clean_branch / clean_branch_or_split_pr
- Runtime: vibepro@0.2.0-beta.1 3dd925c83a3c codex/story-vibepro-explicit-run-attribution-lineage clean (story=story-vibepro-explicit-run-attribution-lineage)
