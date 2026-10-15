---
story_id: story-codex-parallel-task-execution
title: Codex親がTask計画を並列実行し、継続統合・再開する
status: draft
view: dev
document_kind: canonical_pointer
created_at: 2026-10-09
updated_at: 2026-10-09
owner_repository: agent-skills
canonical_repository: agent-skills
canonical_path: docs/stories/story-codex-parallel-task-execution.md
canonical_story_id: story-codex-parallel-task-execution
---

# Codex親がTask計画を並列実行し、継続統合・再開する

このファイルはVibePro側の参照ポインタです。Story 2の正本、受入条件、実行記録の契約は
`agent-skills` リポジトリの
`docs/stories/story-codex-parallel-task-execution.md` に置きます。同じStoryの本文や受入条件を
VibeProへ複製しません。

正本の責務は、VibeProのTask計画をCodex親・子などの外部hostへ配布し、セッション、worktree、
占有、試行、成果回収、検証、継続統合、再開を記録することです。実行管理をVibePro本体へ戻す
ことや、Brainbase連携をStory 2の必須条件にすることはありません。技術計画の変更は
[Story 1](./story-vibepro-tl-parallel-task-plan.md)へ返します。

正本側の受入条件は現在も未完了です。このポインタの存在は、並列実装や中断復旧の試行完了を
意味しません。正本の更新後に、ownerが本ポインタの `canonical_path` と関連リンクを照合します。

[全体方針](./story-vibepro-tl-task-orchestration-codex-pilot.md)
