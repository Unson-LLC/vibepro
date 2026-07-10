---
story_id: story-vibepro-skills-claude-md-refresh
title: Skills/CLAUDE.mdをCLI実装の現状と運用知見に合わせて最新化する
status: active
view: dev
period: 2026-07
spec_docs:
  - docs/specs/story-vibepro-skills-claude-md-refresh.md
parent_design:
  - vibepro-agent-guidance-ssot
reason:
  alternatives: "src/cli.jsのhelp文面修正やREADME拡充も検討したが、エージェント挙動を直接規定するのはskills/とCLAUDE.mdであり、docs-onlyで完結する本経路を選択。CLI help同期は別Storyに分離。"
  compatibility: "既存skillのfrontmatter形式・skills install/lint/verifyの走査規約に準拠。skills/配下への新規ディレクトリ追加はpackage.json filesの既存エントリ(skills)に内包される。"
  rollback: "全変更はMarkdownと.vibepro/config.jsonのstories追記のみ。revert一発で復元可能で、ランタイム挙動への影響はない。"
  boundary: "変更はskills/、agent-instructions/、リポジトリ直下CLAUDE.md/AGENTS.md、Story/Spec doc、design-ssot登録、およびガイダンス内容を固定するtest/vibepro-cli.test.jsのアサーション更新に限定。src/のランタイムコードは変更しない。"
---

# Story

VibeProのagent向けガイダンス（skills/、agent-instructions/）がCLI実装の現状から乖離している。managed worktree実行は2026-06-03に出荷済みだが、skillは「未実装扱いで手動worktreeを使え」と指示し続けており、エージェントが出荷済み機能を迂回する。また uiux cockpit、audit replay/session-cost、trace、gate check、checkpoint、verify import-ci、review repair、pr prepare --summary-json/--view などの主要機能がどのskillにも記載がない。

さらに、self-dogfood運用で蓄積された非自明な手順（ツリー最終化→証跡→レビューの順序、証跡のstrong化、review lifecycleの修復手順、spec writeのvalidator挙動）がセッションメモリにしか存在せず、リポジトリの正本になっていない。これらを形式知化し、リポジトリ直下にCLAUDE.md/AGENTS.mdエントリポイントを新設することで、どのエージェント実装でも同じ品質でVibeProフローを運転できる状態にする。

## Acceptance Criteria

- skills/vibepro-workflow と skills/vibepro-story-refactor から「managed worktreeは未実装」という趣旨の記述が消え、`vibepro execute start` を正規の分離実行経路として案内する。
- skills/vibepro-workflow が uiux intake→map→evidence→prepare、verify import-ci、gate check、checkpoint、audit replay/session-cost、trace、usage report --subagent-roi --gate-roi、pr prepare --summary-json/--view に言及する。
- 新規skill vibepro-gate-evidence が、コミット順序の原則、verify recordのkind上書きと構造化observation、証跡strength、review lifecycle（prepare→start→close→record --agent-closed --inspection-input）、review repair、spec/architecture writeのvalidator挙動、fast lane条件を記載する。
- リポジトリ直下に CLAUDE.md が存在し、AGENTS.md とbyte一致する（cmp -s CLAUDE.md AGENTS.md）。
- agent-instructions/codex/AGENTS.vibepro.md が現行のcheck pack registry（12パック）と execute start / uiux / audit / gate-evidence skill への導線を含む。
- `vibepro skills lint .` がpassする。

## Non Goals

- src/cli.js のhelp Usage文面の同期（story map / task brief|plan|handoff / check list の追記は別Story）。
- skills/vibepro-meeting-minutes-editor の再配置や再分類。
- 診断パックの凍結・削除・統合の提案。
- CLIランタイムコード（src/）の変更。既存のskills install/lint/verifyの走査仕様は unchanged/existing のまま利用する（existing skills directory scanning behavior is unchanged）。ガイダンス内容を固定する既存テストアサーションの追随更新のみ行う。
