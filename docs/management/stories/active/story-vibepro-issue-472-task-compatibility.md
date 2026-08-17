---
story_id: story-vibepro-issue-472-task-compatibility
title: 旧形式タスクを含むStory診断を中断させない
status: active
contract_type: bug
parent_design: vibepro-issue-472-task-compatibility
reason: "代替案は描画時だけ欠損値を無視する方法、既存tasks.jsonを一括移行する方法、読込境界で現行タスク形へ正規化する方法。既存利用者の完了状態を保ち、生成・描画の全経路を同じ契約に揃えられる読込境界の正規化を採用する。旧形式のread_first_files欠落を空配列として扱う後方互換変更であり、新形式の出力は変えない。rollbackは正規化と回帰テストを同時にrevertする。境界はStory task state生成・Markdown描画・関連テスト・npm prereleaseに限定し、Graphify取込契約そのものは変更しない。"
---

# 旧形式タスクを含むStory診断を中断させない

## 利用者価値

既存プロジェクトでGraphifyを取り込んだ後も、過去版VibeProが保存した完了タスクを失わずにStory診断を最後まで実行できる。

## 現状

過去版が保存した `accepted_spec` タスクには `read_first_files` が存在しない場合がある。再診断はそのタスクを完了状態のまま引き継ぐが、Markdown描画が配列の存在を前提に `length` を参照するため例外終了する。Graphify取込は完了しているものの、診断レポート・タスク・manifestが更新されない。

## 受け入れ条件

- `read_first_files` を持たない既存完了タスクを含む状態を再診断しても例外終了しない。
- 既存タスクの識別子、完了状態、解決済みfindingとの対応を維持する。
- 新規生成タスクは従来どおり配列を持ち、読込対象がない場合のMarkdownは `Read first: -` と表示する。
- 回帰テストが旧形式データを状態生成からMarkdown描画まで通す。
- npm prereleaseを更新し、公開版を旧形式fixtureで再実行して診断完了を確認する。

## 失敗時とロールバック

- 正規化で既存フィールドが失われる場合は公開せず、入力コピーを保持する方式へ修正する。
- 公開後に問題が判明した場合は公開済みversionを上書きせず、dist-tagを直前版へ戻して新しいprereleaseで修正する。
