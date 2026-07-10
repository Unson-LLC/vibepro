## 判断
- このPRで判断すること: Skills/CLAUDE.mdをCLI実装の現状と運用知見に合わせて最新化する を満たすための Contract Docs / Tests / Repo Control 変更として、このPRを受け入れてよいか。
- Story: story-vibepro-skills-claude-md-refresh - Skills/CLAUDE.mdをCLI実装の現状と運用知見に合わせて最新化する
- 正本: [docs/management/stories/active/story-vibepro-skills-claude-md-refresh.md](docs/management/stories/active/story-vibepro-skills-claude-md-refresh.md)
- 変更範囲: 10 files / Contract Docs / Tests / Repo Control
- 設計/Story: [docs/management/stories/active/story-vibepro-skills-claude-md-refresh.md](docs/management/stories/active/story-vibepro-skills-claude-md-refresh.md), [docs/specs/story-vibepro-skills-claude-md-refresh.md](docs/specs/story-vibepro-skills-claude-md-refresh.md)
- テスト: [test/vibepro-cli.test.js](test/vibepro-cli.test.js)

## 経緯
- 要求: Skills/CLAUDE.mdをCLI実装の現状と運用知見に合わせて最新化する
- 発生経緯: VibeProのagent向けガイダンス（skills/、agent-instructions/）がCLI実装の現状から乖離している。managed worktree実行は2026-06-03に出荷済みだが、skillは「未実装扱いで手動worktreeを使え」と指示し続けており、エージェントが出荷済み機能を迂回する。また uiux cockpit、audit replay/session-cost、trace、gate check、checkpoint、verify import-ci、review repair、pr prepare --summary-json/--view などの主要機能がどのskillにも記載がない。 さらに、self-dogfood運用で蓄積された非自明な手順（ツリー最終化→証跡→レビューの順序、証跡のstrong化、review lifecycleの修復手順、spec writeのvalidator挙動）がセッションメモリにしか存在せず、リポジトリの正本になっていない。これらを形式知化し、リポジトリ直下にCLAUDE.md/AGENTS.mdエントリポイントを新設することで、どのエージェント実装でも同じ品質でVibeProフローを運転できる状態にする。


## 原因
- repo制御ファイルが差分に含まれるため、アプリ変更と分けてレビューする

## 解決
- Story文書を更新: [docs/management/stories/active/story-vibepro-skills-claude-md-refresh.md](docs/management/stories/active/story-vibepro-skills-claude-md-refresh.md)

## レビュー観点
- Gate: 未解決の必須Gateはありません。ただしリリース判断Warning: Design Input Judgment Gate。 詳細はVibePro証跡の Gate DAG / Gate Enforcement を確認してください。
- Scope: 差分範囲の説明または分割判断が必要。理由: repo制御ファイルやagent設定が差分に含まれている / split=split_by_lane_then_prepare
- 管理worktree: passed
- Storyの受け入れ基準と実装差分が対応しているか
- ADRなしで既存設計の範囲に収まっているか
- テスト差分: [test/vibepro-cli.test.js](test/vibepro-cli.test.js)
- Risk: repo制御ファイルが差分に含まれるため、アプリ変更と分けてレビューする
- Risk: 最新診断gateが needs_review

## 確認
- [x] Unit Gate - unit_regression evidence for gate DAG and review guidance surfaces: full suite 924 tests (922 pass; the 2 failures were the skills-list and codex-install tests asserting the old guidance, updated for the intended change and re-run pass at current head). CI on PR 313 (Node 20/22) passed the full suite including these tests at the pre-rebase head; rebase delta is upstream main (#314) plus a design-ssot registry merge. Covers responsibility contracts VIBE-RAR-001 VIBE-RAR-002 VIBE-CORE-PR-001 VIBE-CORE-AR-001 VIBE-CORE-EV-001 VIBE-CORE-COST-001 VIBE-CORE-STORY-001 VIBE-CORE-STATUS-001 VIBE-CORE-JUDGE-001 VIBE-CORE-WT-001. No runtime source changed in this diff.; evidence: [.vibepro/verify-artifacts/unit-status.json](.vibepro/verify-artifacts/unit-status.json) / gate: passed / evidence: [.vibepro/verify-artifacts/unit-status.json](.vibepro/verify-artifacts/unit-status.json)
- [x] Integration Gate - artifact_replay: skills lint report shows pass for all 7 bundled skill artifacts at current head; CLAUDE.md/AGENTS.md byte-identity verified; design-ssot registry holds both upstream and agent-guidance roots after rebase merge; CI integration checks test(20)/test(22) pass at the rebased PR 313 head imported via verify import-ci; review surface is the guidance markdown, its lint report, and [docs/specs/story-vibepro-skills-claude-md-refresh.md](docs/specs/story-vibepro-skills-claude-md-refresh.md); evidence: [.vibepro/verify-artifacts/skills-lint-status.json](.vibepro/verify-artifacts/skills-lint-status.json) / gate: passed / evidence: [.vibepro/verify-artifacts/skills-lint-status.json](.vibepro/verify-artifacts/skills-lint-status.json)
- 最終E2E: not_required: UI/E2E対象の差分ではないため、Unit / Integration証跡で完了判定する

## 詳細
- 証跡: [.vibepro/pr/story-vibepro-skills-claude-md-refresh/](.vibepro/pr/story-vibepro-skills-claude-md-refresh/)
- PR準備: [.vibepro/pr/story-vibepro-skills-claude-md-refresh/pr-prepare.json](.vibepro/pr/story-vibepro-skills-claude-md-refresh/pr-prepare.json)
- 判断索引: [.vibepro/pr/story-vibepro-skills-claude-md-refresh/decision-index.json](.vibepro/pr/story-vibepro-skills-claude-md-refresh/decision-index.json)
- Gate: ready_for_review
- 実行状態: ready
- Scope: needs_clean_branch / clean_branch_or_split_pr
- Runtime: vibepro@0.1.0-beta.0 6beee312d4f0 claude/vibepro-skills-claude-md-993cdd clean (story=story-vibepro-skills-claude-md-refresh)
