## 判断
- このPRで判断すること: 見本準拠の議事録編集プロンプトを同梱skillとして提供する を満たすための Contract Docs / Tests 変更として、このPRを受け入れてよいか。
- Story: story-vibepro-meeting-minutes-editor-prompt - 見本準拠の議事録編集プロンプトを同梱skillとして提供する
- 正本: docs/management/stories/active/story-vibepro-meeting-minutes-editor-prompt.md
- 変更範囲: 8 files / Contract Docs / Tests
- 設計/Story: docs/management/stories/active/story-vibepro-meeting-minutes-editor-prompt.md, docs/architecture/vibepro-meeting-minutes-editor-prompt.md, docs/specs/vibepro-meeting-minutes-editor-prompt.md
- テスト: test/vibepro-cli.test.js

## 経緯
- 要求: 見本準拠の議事録編集プロンプトを同梱skillとして提供する
- 要求ID: meeting-minutes-quality
- 発生経緯: Meeting Packで生成された議事録が、Slack添付やトランスクリプトを取得できていない状態のまま、Task候補やDecision候補だけを作るような出力になっていた。ユーザーが共有した見本は、固定テンプレートではなく、会議の種類を読み取り、戦略背景、論点、意思決定の理由、未解決リスク、次の打ち手を編集済みの日本語文書としてまとめる品質を示している。 VibeProは、Meeting Packや他repoのagentが参照できる同梱skillとして、この議事録編集基準を提供する。目的は「既存パッケージに必ず当てはめる」ことではなく、見本から逆算したプロンプト運用を再利用できる形にすることである。


## 原因
- 最新診断gateが needs_review

## 解決
- Story文書を更新: docs/management/stories/active/story-vibepro-meeting-minutes-editor-prompt.md

## レビュー観点
- Gate: 未解決の必須Gateはありません。ただしリリース判断Warning: Managed Worktree Gate。 詳細はVibePro証跡の Gate DAG / Gate Enforcement を確認してください。
- Scope: 同一PRでレビュー可能。分割案はVibePro証跡に残す（split=split_by_lane_then_prepare）
- 管理worktree: needs_review
- Storyの受け入れ基準と実装差分が対応しているか
- テスト差分: test/vibepro-cli.test.js
- Risk: 最新診断gateが needs_review

## 確認
- [x] Unit Gate - Current HEAD b7e685c full VibePro responsibility regression suite remained green for bundled meeting-minutes skill addition: 756 tests, 0 failures.; evidence: ../../../../../../tmp/vibepro-meeting-minutes-npm-test.log / gate: passed / evidence: ../../../../../../tmp/vibepro-meeting-minutes-npm-test.log
- [x] Integration Gate - Imported CI evidence for test (22) (SUCCESS) at HEAD b7e685c79632; evidence: .vibepro/pr/story-vibepro-meeting-minutes-editor-prompt/ci-evidence/test_22_.json / gate: passed / evidence: .vibepro/pr/story-vibepro-meeting-minutes-editor-prompt/ci-evidence/test_22_.json
- 最終E2E: not_required: UI/E2E対象の差分ではないため、Unit / Integration証跡で完了判定する

## 詳細
- 証跡: .vibepro/pr/story-vibepro-meeting-minutes-editor-prompt/
- PR準備: .vibepro/pr/story-vibepro-meeting-minutes-editor-prompt/pr-prepare.json
- 判断索引: .vibepro/pr/story-vibepro-meeting-minutes-editor-prompt/decision-index.json
- Gate: ready_for_review
- 実行状態: ready
- Scope: reviewable / current_branch_pr
- Runtime: vibepro@0.1.0-beta.0 b7e685c79632 codex/vibepro-meeting-minutes-editor-prompt clean (story=story-vibepro-meeting-minutes-editor-prompt)
