---
story_id: story-vibepro-agent-harness-readiness
title: AI Agent Harness Readinessの診断と整備
view: dev
period: 2026-05
architecture_docs:
  reason: VibeProの診断パッケージ、Skills/Codex instructions、Story/PR Gate導線を横断する機能追加であり、実装前にCLI拡張方針を明文化する必要があるため
source:
  type: external_reference
  url: https://claude.com/blog/how-claude-code-works-in-large-codebases-best-practices-and-where-to-start
  title: How Claude Code works in large codebases: best practices and where to start
---

# AI Agent Harness Readinessの診断と整備

## 背景

VibeProの中核価値は、StoryからArchitecture/Spec/Gateを作り、確定した文脈をもとにAIへ安心して開発を任せられる状態を作ることにある。

一方で、大規模コードベースでAIエージェントが実際に高品質に動くには、PR Gateだけでは足りない。エージェントが読むべきrepo指示、探索入口、test/lint/typecheckコマンド、除外すべきgenerated/noisy files、サブディレクトリごとの責務、Claude Code / Codex向けのSkillsやinstructionsが整っていないと、AIは毎回探索で迷い、同じ失敗を繰り返しやすい。

Claude Codeの大規模コードベース運用ベストプラクティスでは、`CLAUDE.md`、hooks、skills、plugins、MCP、LSP、subagentsなどを含む開発ハーネスが重要であることが示されている。これはVibeProが目指す「AI駆動開発の標準化」と一致している。

そのためVibeProは、アプリのUI/API/Security/Performanceだけでなく、「このrepoはAIエージェントに任せられるハーネス状態か」を診断・生成・更新できるようにする。

## 方針

- VibeProを単なる診断ツールではなく、AI開発ハーネスの制御基盤として拡張する。
- 通常の「相手のリポジトリを診断して結果を渡すだけ」の利用では、ハーネス診断を必須にしない。
- ハーネス診断は明示ONにでき、チーム標準化やAIエージェント運用の整備が目的のときに使う。
- `check all` に常時critical gateとして混ぜるのではなく、デフォルトでは次アクションや任意パックとして案内し、`--include-harness` または `check agent-harness` で詳細診断する。
- `AGENTS.md`、`CLAUDE.md`、`.claude/skills`、Codex instructions、VibePro bundled skills の存在と鮮度を診断する。
- 大規模repoでAIが迷わないための `codebase-map.md`、`agent-entrypoints.md`、`test-command-map.json` を生成する。
- Skills / Codex / Claude Code instructions のinstalled statusとdriftを確認できるようにする。
- hooksは必須化しないが、存在する場合は参照先scriptが実在するか、失敗時に原因が見えるかを診断する。
- subagentはrunnerとして起動しない。VibeProは探索依頼、レビュー依頼、記録コマンド、Gate接続を生成する制御基盤に徹する。
- セッションログや過去のVibePro実行から繰り返しミスを見つけ、Skill更新候補として提示する。ただし自動反映せず、人間レビューを挟む。

## 想定ユーザー

- VibeProを初めて導入する社内エンジニア
- Codex / Claude Codeを使っているが、repoごとのAI開発ルール整備はまだ属人的なチーム
- シニアが作ったAI駆動開発ハーネスを、ジュニアや業務委託先にも同じ品質で使わせたい開発責任者

## 受け入れ基準

- [ ] `vibepro check agent-harness <repo>` が実行できる
- [ ] `vibepro check all` はデフォルトでAgent Harness Readinessをblocking対象にしない
- [ ] `vibepro check all --include-harness` でAgent Harness Readinessを同時実行できる
- [ ] `vibepro check all` の結果には、ハーネス診断を未実行の場合でも「AI開発標準化までやるなら `vibepro check agent-harness`」という任意の次アクションが出る
- [ ] `vibepro check agent-harness <repo>` 単体で詳細診断できる
- [ ] ハーネス診断のfindingsは、通常のUI/API/Security/Performance診断結果と混同されず、`harness_readiness` として別セクションに出る
- [ ] 相手repoを一回診断して結果を渡すだけのケースでは、harness未実行を `needs_review` や `fail` にしない
- [ ] 診断結果に Codex instructions、Claude Code skills、`AGENTS.md`、`CLAUDE.md`、repo-local VibePro skills の有無と状態が出る
- [ ] installed skills / instructions がVibePro同梱版とずれている場合、driftとして表示される
- [ ] 存在しないhook script、壊れたhook、ログを捨てて原因追跡できないhookを `needs_review` 以上で検出する
- [ ] generated files、build artifacts、third-party code、large lock/generated outputs がAI探索ノイズとして除外・説明されているか診断する
- [ ] repo map / codebase mapがない場合、生成コマンドを提示する
- [ ] `vibepro harness status <repo>` がAIハーネスの状態を一覧表示する
- [ ] `vibepro harness map <repo>` が `.vibepro/harness/codebase-map.md`、`.vibepro/harness/agent-entrypoints.md`、`.vibepro/harness/test-command-map.json` を生成する
- [ ] `test-command-map.json` には少なくとも package scripts、typecheck、unit test、e2e候補、主要subdirectoryごとの検証コマンド候補が入る
- [ ] `agent-entrypoints.md` には、AIが最初に読むべきファイル、避けるべきファイル、変更前に確認すべき境界が書かれる
- [ ] Agent Review Gateとは別に、read-only探索用の `vibepro explore prepare` / `vibepro explore record` の設計判断が明文化される
- [ ] Claude Code / Codexの両方で使えるsubagent探索依頼テンプレートが生成される
- [ ] セッション学習候補を `.vibepro/harness/session-learnings.json` に記録できる
- [ ] `vibepro harness review-learnings <repo>` がSkill更新候補を人間レビュー用に表示する
- [ ] 自動でSkillsやAGENTS/CLAUDEを上書きせず、更新候補と差分を提示する
- [ ] README / README.ja に、初回診断後の次ステップとして Agent Harness Readiness の位置づけが追加される
- [ ] 既存の `npm test` と `npm run typecheck` が通る

## 初期タスク

1. Harness診断パッケージ
   - `agent-harness` check packを追加する
   - `check all` ではデフォルト任意案内にし、`--include-harness` で同時実行できるようにする
   - 相手repoを一回診断して終わるケースでは、harness未整備を診断failにしない
   - Codex / Claude Code / repo指示 / hooks / skills / ignore-noise を診断する

2. Harness status
   - `vibepro harness status` を追加する
   - installed / missing / outdated / invalid / needs_review を一覧化する
   - 初回利用者に次コマンドを出す

3. Codebase map生成
   - `vibepro harness map` を追加する
   - `.vibepro/harness/codebase-map.md`
   - `.vibepro/harness/agent-entrypoints.md`
   - `.vibepro/harness/test-command-map.json`

4. Skills / instructions drift
   - bundled skillsとrepo側install済みskillsの差分を比較する
   - Codex instructionsとrepo側 `AGENTS.md` の導入・鮮度を確認する
   - Claude Code向け `CLAUDE.md` / `.claude/skills` の導入・鮮度を確認する

5. Explore evidence
   - `review prepare` とは別に、read-only探索の証跡を扱う必要があるかを設計する
   - 必要なら `explore prepare` / `explore record` を追加する
   - subagent探索結果をPR GateやStory planningへ渡せるようにする

6. Session learning
   - VibePro実行ログやCodex/Claude会話ログから、繰り返しミス候補を記録するschemaを作る
   - Skill更新候補を生成する
   - 人間レビュー後にskills / AGENTS / CLAUDEへ反映する導線を作る

## 非目標

- VibeProがCodex / Claude Codeのsubagentを直接起動するrunnerになること
- hooksやskillsを人間確認なしに自動上書きすること
- external portfolio dashboard固有の運用をVibePro本体に埋め込むこと
- Claude Codeだけ、またはCodexだけに依存した設計にすること
