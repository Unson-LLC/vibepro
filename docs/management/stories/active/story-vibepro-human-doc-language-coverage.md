---
story_id: story-vibepro-human-doc-language-coverage
title: "VibeProが生成する人間向けドキュメントを言語設定に揃える"
architecture_docs:
  - docs/architecture/vibepro-output-language-architecture.md
spec_docs:
  - docs/specs/vibepro-output-language-spec.md
status: active
created_at: 2026-06-02
updated_at: 2026-06-02
---

# Story: VibeProが生成する人間向けドキュメントを言語設定に揃える

## 背景

VibeProには `.vibepro/config.json` の `output.language` と `--language ja|en` があり、既定値も `ja` になっている。しかし、現状の適用範囲は主に `pr prepare` / `pr create` のPR成果物と一部HTML/CLI summaryに偏っている。

調査したところ、次の構造的な原因で、人間が読むMarkdownやdispatch文書が英語で生成される。

- `src/language.js` は `localizedText` と `resolveOutputLanguage` を提供しているが、利用している主要経路は `src/pr-manager.js` と `src/html-report.js` に偏っている
- `docs/specs/vibepro-output-language-spec.md` の対象成果物は `pr-prepare.html`, `review-cockpit.html`, `gate-dag.html`, `split-plan.html`, `pr-create.html`, `pr-body.md`, CLI summary に限定されている
- `src/agent-review.js` の `review-request-*.md` / `parallel-dispatch.md` は英語固定テンプレートで、言語設定を受け取らない
- `src/task-manager.js`, `src/story-manager.js`, `src/story-task-generator.js`, `src/design-system.js`, `src/design-modernize.js`, `src/diagnostic-engine.js`, `src/check-packs.js`, `src/journey-map.js`, `src/explore-evidence.js`, `src/doctor.js` などのMarkdown rendererは、言語設定を引数に取らず固定文字列を直接返しているものが多い
- CLI層も多くのcommandで `--language` を受け取らず、workspace configから解決した言語を各rendererへ渡していない
- VibePro workflow / Codex instructions / skillsにも「人間向けVibePro docsを書く前に言語設定を確認し、その言語で書く」という運用ルールが明示されていない

その結果、日本語workspaceでも、Story/Task/Review/Design/Diagnosis/Check/Explore系の人間向け成果物に英語見出しや英語の指示文が混ざる。

## 日本語で書かれる根拠

このStoryで「日本語で書かれる」と判断する根拠は、AIや実装者の気分ではなく、次の契約に固定する。

- 言語の正本は `.vibepro/config.json` の `output.language` とし、CLIの `--language` はそのcommand実行時だけの明示overrideとして扱う
- `output.language` が `ja` の場合、VibeProが生成する人間向け成果物の固定文は日本語でなければならない
- `output.language` が `en` の場合、VibeProが生成する人間向け成果物の固定文は英語でなければならない
- 各生成commandは、Markdown/HTML/CLI summaryを書く前に `resolveOutputLanguage` 相当の共通helperで言語を解決し、rendererへ渡す
- 各rendererは `language` を受け取り、固定見出し、説明文、指示文、次アクション、表ヘッダを `localizedText` または同等の辞書から出す
- rendererが `language` を受け取らない、または固定英語文字列を直接返す場合は、このStoryの未完了・回帰として扱う
- self-dogfoodまたは専用checkは、`output.language=ja` のfixtureで生成した代表成果物に英語固定見出し・英語固定指示文が残っていないことを検査する
- VibePro workflow / Codex instructions / skillsも、手書きで追加するStory/Architecture/Specなどの人間向けdocsについて `output.language` を確認して同じ言語で書くよう指示する

つまり、日本語化の根拠は「workspace language config -> commandで解決 -> rendererへ伝搬 -> localized固定文で出力 -> fixture/checkで検証」という経路に置く。

## 調査時点の人間向け成果物一覧

現時点でソース上の `writeFile` / artifact参照から確認できた、言語設定の対象にすべき人間向け成果物は次の通り。

| 領域 | 成果物 | 主な生成元 |
|------|--------|------------|
| PR準備 | `.vibepro/pr/<story-id>/pr-body.md` | `src/pr-manager.js` |
| PR準備 | `.vibepro/pr/<story-id>/pr-prepare.html` | `src/pr-manager.js`, `src/html-report.js` |
| PR準備 | `.vibepro/pr/<story-id>/review-cockpit.html` | `src/pr-manager.js`, `src/html-report.js` |
| PR準備 | `.vibepro/pr/<story-id>/gate-dag.html` | `src/pr-manager.js` |
| PR準備 | `.vibepro/pr/<story-id>/split-plan.html` | `src/pr-manager.js` |
| PR作成 | `.vibepro/pr/<story-id>/pr-create.html` | `src/pr-manager.js`, `src/html-report.js` |
| PR補助 | `.vibepro/stories/<story-id>/tasks/<task-id>/briefing.md` | `src/pr-manager.js`, `src/task-manager.js` |
| PR補助 | `.vibepro/stories/<story-id>/tasks/<task-id>/plan.md` | `src/pr-manager.js`, `src/task-manager.js` |
| PR補助 | `.vibepro/stories/<story-id>/tasks/<task-id>/handoff.md` | `src/pr-manager.js`, `src/task-manager.js` |
| Task | `.vibepro/stories/<story-id>/tasks/tasks.md` | `src/task-manager.js`, `src/story-task-generator.js` |
| Task | `.vibepro/stories/<story-id>/tasks/<task-id>/execution.md` | `src/task-manager.js` |
| Story | `.vibepro/stories/<story-id>/story-report.md` | `src/story-manager.js` |
| Story | `.vibepro/stories/<story-id>/index.html` | `src/story-manager.js`, `src/story-html.js` |
| Story | `.vibepro/stories/<story-id>/story-map.md` | `src/story-manager.js` |
| Story | `.vibepro/stories/<story-id>/story-plan.md` | `src/story-manager.js` |
| Story | `.vibepro/stories/<story-id>/runs/<run-id>/failure.md` | `src/story-manager.js` |
| Agent Review | `.vibepro/reviews/<story-id>/<stage>/review-request-<role>.md` | `src/agent-review.js` |
| Agent Review | `.vibepro/reviews/<story-id>/<stage>/parallel-dispatch.md` | `src/agent-review.js` |
| Agent Review | `.vibepro/reviews/<story-id>/<stage>/review-summary.md` | `src/agent-review.js` |
| Explore | `.vibepro/explore/<story-id>/parallel-dispatch.md` | `src/explore-evidence.js` |
| Explore | `.vibepro/explore/<story-id>/explore-summary.md` | `src/explore-evidence.js` |
| Explore | `.vibepro/explore/<story-id>/requests/<role>.md` | `src/explore-evidence.js` |
| Design Modernize | `.vibepro/design-modernize/<story-id>/design-modernize.md` | `src/design-modernize.js` |
| Design Modernize | `.vibepro/design-modernize/<story-id>/design-briefs.md` | `src/design-modernize.js` |
| Design Modernize | `.vibepro/design-modernize/<story-id>/implementation-spec.md` | `src/design-modernize.js` |
| Design Modernize | `.vibepro/design-modernize/<story-id>/visual-hypothesis-prompts.md` | `src/design-modernize.js` |
| Design Modernize | `.vibepro/design-modernize/<story-id>/design-system-derivation.md` | `src/design-modernize.js` |
| Design Modernize | `.vibepro/design-modernize/<story-id>/composition-guidelines.md` | `src/design-modernize.js` |
| Design Modernize | `.vibepro/design-modernize/<story-id>/screen-capture.md` | `src/design-modernize.js` |
| Design System | `.vibepro/design-system/<ds-id>/design-system.md` | `src/design-system.js` |
| Design System | `.vibepro/design-system/<ds-id>/visual-foundations.md` | `src/design-system.js` |
| Design System | `.vibepro/design-system/<ds-id>/validation/<story-id>.md` | `src/design-system.js` |
| Diagnosis | `.vibepro/diagnostics/<run-id>/summary.md` | `src/diagnostic-engine.js` |
| Diagnosis | `.vibepro/diagnostics/<run-id>/risk-register.md` | `src/diagnostic-engine.js` |
| Diagnosis | `.vibepro/diagnostics/<run-id>/static-site-check-result.md` | `src/diagnostic-engine.js` |
| Diagnosis | `.vibepro/diagnostics/<run-id>/component-style-check-result.md` | `src/diagnostic-engine.js` |
| Diagnosis | `.vibepro/diagnostics/<run-id>/flow-design-check-result.md` | `src/diagnostic-engine.js` |
| Diagnosis | `.vibepro/diagnostics/<run-id>/gesture-interaction-check-result.md` | `src/diagnostic-engine.js` |
| Diagnosis | `.vibepro/diagnostics/<run-id>/terminal-link-check-result.md` | `src/diagnostic-engine.js` |
| Diagnosis | `.vibepro/diagnostics/<run-id>/architecture-profile.md` | `src/diagnostic-engine.js` |
| Diagnosis | `.vibepro/diagnostics/<run-id>/finding-review.md` | `src/diagnostic-engine.js` |
| Diagnosis | `.vibepro/diagnostics/<run-id>/refactoring-delta.md` | `src/diagnostic-engine.js` |
| Diagnosis | `.vibepro/diagnostics/<run-id>/requirement-consistency.md` | `src/diagnostic-engine.js` |
| Diagnosis | `.vibepro/diagnostics/<run-id>/spec-drift.md` | `src/diagnostic-engine.js`, `src/spec-drift.js` |
| Check Pack | `.vibepro/checks/<pack>/<run-id>/check.md` | `src/check-packs.js` |
| Journey | `.vibepro/journey/latest-journey.md` | `src/journey-map.js` |
| Flow Verification | `.vibepro/verification/<run-id>/flow-verification.md` | `src/flow-verifier.js` |
| Performance | `.vibepro/performance/<run-id>/performance.md` | `src/performance-measurer.js` |
| Doctor | `.vibepro/doctor/<run-id>/doctor-result.md` | `src/doctor.js` |
| Harness | `.vibepro/harness/codebase-map.md` | `src/agent-harness-map.js` |
| Harness | `.vibepro/harness/agent-entrypoints.md` | `src/agent-harness-map.js` |
| Harness | `.vibepro/harness/session-learnings-review.md` | `src/session-learning.js` |
| Brainbase連携 | `.vibepro/brainbase/import-summary.md` | `src/brainbase-importer.js` |
| Brainbase連携 | `.vibepro/brainbase/publish-preview.md` | `src/nocodb-story-sync.js` |
| Graphify連携 | `.vibepro/graphify/GRAPH_REPORT.md`, `.vibepro/graphify/graph.html` | `src/graphify-adapter.js` |
| Agent instructions | `AGENTS.md`, `.claude/skills/**/SKILL.md` | `src/codex-manager.js`, `src/skills-manager.js` |

上記は初期inventoryであり、実装時には「VibeProが生成または配布するMarkdown/HTML/CLI text」を追加検索して漏れを確認する。

## ユーザーストーリー

- ユーザー: VibeProが生成した成果物を読む開発者・レビュアー
- したいこと: workspaceの言語設定が `ja` の場合、人間が読む成果物は原則として日本語で生成されてほしい
- 目的: 英語と日本語の混在で読み手の注意が割れず、Story / Spec / Gate / Review / Executionの判断に集中できる

## 受け入れ基準

- [ ] 上記inventoryにある人間向け成果物について、言語設定の対象/対象外を明示し、実装時に漏れがあれば追記する
- [ ] `.vibepro/config.json` の `output.language` と `--language` overrideを、人間向け成果物の固定文言語を決める唯一の根拠として扱う
- [ ] human output生成commandは、成果物を書き出す前に共通helperで言語を解決し、その値をartifact metadataまたは生成結果へ記録する
- [ ] 各human rendererは `language` を引数に取り、未指定時はworkspace configの `output.language` を使う
- [ ] CLI層はhuman outputを生成するcommandで `--language` overrideとworkspace config解決を共通化する
- [ ] `output.language=ja` のとき、固定見出し、説明文、指示文、次アクション、表ヘッダは日本語になる
- [ ] `output.language=en` のとき、固定見出し、説明文、指示文、次アクション、表ヘッダは英語になる
- [ ] JSON key、schema、enum、Story ID、Gate ID、command、file path、role ID、DAG node ID、外部tool名は翻訳しない
- [ ] 入力由来の本文、Storyタイトル、ユーザーが渡したbrief、外部bundleの文言は勝手に翻訳しない
- [ ] Agent Review request / parallel dispatchは、coordination指示、result shape説明、evidence handling、mandatory lensesの固定文を設定言語に揃える
- [ ] Diagnosisの既存リスク検出分岐は維持し、`authorizationOrderRisks.length > 0` のような認可順序リスク候補は翻訳対象ではなく、検出された場合だけ既存どおり診断findingとして出す
- [ ] VibePro workflow / Codex instructions / skillsは、AIエージェントがStory/Architecture/Specなどの人間向けVibePro docsを手で追加・更新する時も `output.language` を確認して同じ言語で書くよう明示する
- [ ] `vibepro check self-dogfood` または専用checkで、`output.language=ja` のfixture成果物に英語固定見出しが残っていないことを検出できる
- [ ] 既存のPR成果物言語テストに加えて、Task、Agent Review、Design System、Diagnosis/Check Packの代表Markdownで回帰テストを追加する

## 対象外

- 機械可読JSONのkeyやenumの翻訳
- コマンド名、設定key、ID、ファイルパスの翻訳
- ユーザー入力や外部資料本文の自動翻訳
- READMEや手書きdocs全体の翻訳。ただしVibeProが生成するStory/Architecture/Specテンプレートは対象に含める

## 実装メモ

- まず `resolveHumanOutputLanguage(repoRoot, options)` のような共通helperを作り、CLI commandごとのばらつきを減らす
- rendererへ `language` を渡す変更は広範囲になるため、PR成果物、Agent Review、Task、Diagnosis/Check Pack、Design系の順に分割する
- `localizedText` の呼び出しを各rendererへ散らしすぎる場合は、artifact種別ごとのlabel dictionaryを作る
- 日本語fixtureは完全翻訳を要求しすぎず、まず「英語固定見出し・英語固定指示文が残らない」ことをGateにする
