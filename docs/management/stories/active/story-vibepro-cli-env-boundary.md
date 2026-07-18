---
story_id: story-vibepro-cli-env-boundary
title: "CLI entrypointでprocess.envを保持する"
status: active
spec_docs:
  - docs/specs/story-vibepro-cli-env-boundary.md
reason:
  decision: "bin entrypointからrunCliへ実プロセス環境を明示的に渡す"
  alternatives: "各subcommandでprocess.envへ個別fallbackする案は境界漏れを再発させるため採用しない"
  compatibility: "runCliを直接呼ぶテストや埋め込み利用者は従来どおりenvを注入できる"
  rollback: "entrypointのenv引数を除去すれば旧挙動へ戻る"
  boundary: "環境変数の値やsecretをartifactへ保存せず、依存注入境界だけを修正する"
---

# Story

## User Story

**As a** VibePro CLI利用者  
**I want** binary経由でも現在のprocess environmentが全subcommandへ渡ること  
**So that** 同じHEADと引数でdirect `runCli` とbinaryのGate判定が分岐しない

## Acceptance Criteria

- [ ] CEB-S-1: `bin/vibepro.js` は `runCli` のIO contextへ `process.env` を渡す。
- [ ] CEB-S-2: entrypoint契約テストがstdout、stderr、envの3入力を固定する。
- [ ] CEB-S-3: secret値をログまたはartifactへ追加しない。

## Non Goals

- 各subcommandの環境変数解決規則の変更。
- classifier premise recovery自体の変更。
