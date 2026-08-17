# 旧形式Storyタスク互換 Spec

Story: `story-vibepro-issue-472-task-compatibility`

## INV-001: 旧タスクの欠落フィールドを内部契約へ正規化する

`buildStoryTaskState` が既存の完了タスクを引き継ぐとき、
`read_first_files` が欠落している場合だけ空配列へ正規化する。
今回の正規化はそれ以外の既存値、未知フィールド、識別子を保持し、
従来の完了遷移（`done`、完了時刻、完了証跡の更新）は変更しない。

- code_ref: `src/story-task-generator.js#applyCompletionStatus`
- test_ref: `test/vibepro-cli.test.js#story task generator renders legacy resolved tasks without read_first_files after re-diagnosis`

## S-001: 旧形式タスクを再診断して描画できる

Given `read_first_files` を持たない旧形式の完了タスクが保存されている。

When 診断が既存タスクを引き継ぎ、Markdownを生成する。

Then 例外終了せず、タスクは完了状態のまま保持され、
`Read first: -` として描画される。

- code_ref: `src/story-task-generator.js#buildStoryTaskState`
- code_ref: `src/story-task-generator.js#renderStoryTasks`
- test_ref: `test/vibepro-cli.test.js#story task generator renders legacy resolved tasks without read_first_files after re-diagnosis`

## 公開後の受け入れ

`vibepro@0.2.0-beta.10` を新しい一時環境へ導入し、Issue #472 と同じ
STAYe旧形式fixtureに対する `story diagnose --run-graphify` が完了することを
診断成果物のreadbackで確認する。
