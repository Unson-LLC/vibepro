---
story_id: story-vibepro-meeting-minutes-editor-prompt
title: 見本準拠の議事録編集プロンプトを同梱skillとして提供する
status: active
parent_design: vibepro-meeting-minutes-editor-prompt
source:
  type: user_feedback
  id: meeting-minutes-quality
architecture_docs:
  - docs/architecture/vibepro-meeting-minutes-editor-prompt.md
spec_docs:
  - docs/specs/vibepro-meeting-minutes-editor-prompt.md
---

# 見本準拠の議事録編集プロンプトを同梱skillとして提供する

Meeting Packで生成された議事録が、Slack添付やトランスクリプトを取得できていない状態のまま、Task候補やDecision候補だけを作るような出力になっていた。ユーザーが共有した見本は、固定テンプレートではなく、会議の種類を読み取り、戦略背景、論点、意思決定の理由、未解決リスク、次の打ち手を編集済みの日本語文書としてまとめる品質を示している。

VibeProは、Meeting Packや他repoのagentが参照できる同梱skillとして、この議事録編集基準を提供する。目的は「既存パッケージに必ず当てはめる」ことではなく、見本から逆算したプロンプト運用を再利用できる形にすることである。

## Acceptance Criteria

- `vibepro skills list` に `vibepro-meeting-minutes-editor` が表示される。
- `vibepro skills install <repo>` は `.claude/skills/vibepro-meeting-minutes-editor/SKILL.md` を導入できる。
- `vibepro skills lint <repo>` は新skillをVibePro Agent Skill Contractに照らしてpassする。
- 新skillは、議事録をTask/Decision候補の前段にある編集済み文書として扱う。
- 新skillは、Slack添付・トランスクリプト・録音由来テキストの欠落を隠さず、部分入力であることを明示する。
- 新skillは、会議タイプを推定して構造を選ぶ一方、固定テンプレートへの強制を避ける。
- READMEは同梱skillとしての存在と用途を説明する。
