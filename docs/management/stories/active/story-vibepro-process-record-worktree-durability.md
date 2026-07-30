---
story_id: story-vibepro-process-record-worktree-durability
title: プロセス記録をworktreeライフサイクルから切り離して永続化する
status: active
reason: >
  2026-07-30に同型事故が2回発生した。(1) story-vibepro-finding-class-recurrence-breaker の
  worktree再生成で trip ledger・レビュー7ラウンド・裁定・owner block decision record が全消滅し、
  停止済みの遮断器が clear 表示へ戻った（fail-open）。(2) story-vibepro-vacuous-e2e-test-elimination の
  worktree消滅で検証証跡4種・spec.json・decision record 8件・レビュー3件・裁定20 verdicts・
  dispatch予算カウンターが全滅した。根本原因は .vibepro/* が gitignore かつ per-worktree であり、
  プロセス記録の寿命が worktree の寿命に従属していること。
  代替案比較: (a) 全記録をgitコミット対象化は、レビュー中間生成物や実行runがコミット粒度を汚染し
  self-dogfood の「1 intent = 1 commit」と衝突するため不採用。(b) 定期スナップショット(cron)は
  書き込み直後〜スナップショット間の窓で同じ消失が起きるため不採用。(c) 採用案は「書き込み境界での
  同期snapshot + worktree外の安定ストア + 保守的hydrate」。mutating CLIコマンド完了時に
  main repo 側 .vibepro-store/<story-id>/ へ story スコープの耐久記録クラス
  （reviews / adjudications / decisions / verification / spec / gate-outcomes / executions decisions）を
  ミラーし、新worktreeでは hydrate で復元する。
  互換性: 既存の .vibepro/ 読み書きパスは変更しない（ミラー方式のため38モジュールの
  パス解決を触らない）。store が無い環境では従来動作に完全フォールバックする。
  安全性境界: hydrate は削除を行わず、遮断器の trip 等の block 系記録は union
  （どちらかに存在すれば停止扱い）で fail-closed に倒す。ローカルの新しい記録を古い
  スナップショットで上書きしない（mtime/内容比較で新しい側を保持）。
  ロールバック: store ディレクトリを無視すれば従来動作に戻る。CLI hook は
  config の durability.enabled=false で無効化できる。
  境界: owner承認grantのPR diff可視化問題は既起票の別Storyの責務とし、本Storyでは扱わない。
---

# Story: プロセス記録をworktreeライフサイクルから切り離して永続化する

## 背景

`.vibepro/` 配下のプロセス記録（レビュー・裁定・decision record・検証証跡・spec・trip ledger・dispatch予算）は gitignore かつ per-worktree に保存されるため、worktree の削除・再生成で全消滅する。2026-07-30 に2件の実事故が発生し、特に遮断器の trip 記録消失は「停止済みの遮断器が clear に戻る」fail-open 事故であり、Gate 制御の信頼性を直接毀損した。

## 受け入れ基準

- worktree から `git rev-parse --git-common-dir` 由来で main repo 側の安定ストアルート（`<main-repo>/.vibepro-store/<story-id>/`）を解決できる。worktree でない場合は repo 直下を用いる。
- `vibepro store snapshot <repo> --story-id <id>` が耐久記録クラス（`reviews/` `adjudications/` `verification/` `spec/` `gate-outcomes/` `evidence/` `executions/<id>/**/decisions/`）を安定ストアへミラーできる。
- `vibepro store hydrate <repo> --story-id <id>` が新worktreeへ記録を復元できる。復元は非破壊（削除なし・ローカルの新しいファイルを上書きしない）である。
- block/trip 系記録は union 復元され、store 側に trip が存在すればローカルが clear でも trip として復元される（fail-closed）。
- `vibepro store status <repo> --story-id <id>` が local/store の差分（missing / stale / conflict 件数）を表示できる。
- mutating コマンド（`review record` `review start` `review close` `adjudicate` `verify record` `spec write` `pr prepare`）の完了時に自動 snapshot が走る。失敗してもコマンド本体は失敗させず、警告として報告する（fail-soft）。
- store が存在しない・書き込み不能な環境では従来動作へフォールバックし、既存テストを壊さない。
