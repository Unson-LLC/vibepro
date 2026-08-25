---
story_id: story-vibepro-story-task-authority-binding
title: Story単位で受理したTaskだけを実装権限として固定する
status: active
architecture_docs:
  - docs/architecture/story-vibepro-story-task-authority-binding.md
spec_docs:
  - docs/specs/story-vibepro-story-task-authority-binding.md
reason: "診断proposalと実装権限を分離し、旧execution engineを復元せず明示bindだけをauthority境界にする。互換性はTask未指定のPR経路とagent review projectionを不変にし、rollbackはbind前のcanonical task planへ戻す。"
---

# Story: Story単位で受理したTaskだけを実装権限として固定する

## 利用者と課題

Program運用者は、Storyから生成された候補Taskと、実装を許可したTaskを区別したい。
現状は診断がcanonical task planを書ける一方、`pr prepare --task`は選択Taskが
明示的に受理されたかを検証しないため、proposalが実装権限として扱われ得る。

## 望む結果

追跡対象のJSONをStoryへ明示bindした時だけ、決定的な受理済みtask authorityが
canonical task planへ記録される。診断はそのauthorityを上書きせず、PR準備は
受理済みTaskだけを選択できる。

## Acceptance Criteria

- STA-AC-001: 同じtracked JSONをbindすると、時刻に依存しない同じauthority内容とinput digestを得る。
- STA-AC-002: repo外、未追跡、別Story、空または重複Task ID、空またはrepo外へ逃げるallowed path、diagnostic proposal形式を拒否する。
- STA-AC-003: diagnoseは受理済みcanonical task planを上書きせず、run別diagnostics proposalを出力する。
- STA-AC-004: `pr prepare --task`は受理済みauthorityに存在しないTaskをfail closedにし、受理済みauthorityと生成proposalを別々に公開する。
- STA-AC-005: Spec finalだけではTaskを作らず、bindはSpec・review状態を変更しない。
- STA-AC-006: Task未指定のPR準備とagent review instructionの挙動を変更しない。

## 対象外

- 旧execution engine、task manager、Task自動実行の復元。
- 診断scanner、finding、review orchestration、Spec final semanticsの変更。
- publish、release、既存インストールの更新。
