---
story_id: story-vibepro-pr-prepare-timeout-progress
title: pr prepareが無出力で固まらず進捗とタイムアウトを返す
status: active
source:
  type: github_issue
  id: "57"
  url: https://github.com/Unson-LLC/vibepro/issues/57
architecture_docs:
  - docs/architecture/vibepro-pr-prepare-timeout-progress.md
spec_docs:
  - docs/specs/vibepro-pr-prepare-timeout-progress.md
---

# Story

`vibepro pr prepare` は PR 作成前の最終ゲートなので、ここが無出力で止まると AI エージェントが VibePro を迂回して raw `gh pr create` に進みやすくなる。

VibePro は大きいリポジトリや重い Story でも、処理中の stage を見せ、stage 単位で上限時間を持ち、詰まった場合は構造化された原因を返す必要がある。

## Acceptance Criteria

- `vibepro pr prepare --json` は stdout の JSON を壊さず、stderr に stage progress を出す。
- `vibepro pr prepare` は stage ごとの duration を `preparation.diagnostics.pr_prepare_stages` に残す。
- stage が設定時間を超えた場合、該当 stage 名、経過時間、timeout 値、再実行時の調整方法を含むエラーで終了する。
- timeout は `--stage-timeout-ms <ms>` で調整できる。
- `vibepro pr create` 経由で内部的に `pr prepare` を実行する場合も同じ progress / timeout policy を使う。
