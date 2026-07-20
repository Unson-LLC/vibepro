---
story_id: story-vibepro-symlinked-bin-entrypoint
title: "symlink経由でもVibePro CLIを実行する"
status: active
parent_design: vibepro-symlinked-bin-entrypoint
impact_scope: "bin/vibepro.jsの直接実行判定と、そのプロセス境界の回帰テスト・設計系譜に限定する"
spec_docs:
  - docs/specs/story-vibepro-symlinked-bin-entrypoint.md
reason:
  decision: "argvの表記ではなく実体パスを比較し、npm/global binのsymlink実行を直接実行として認識する"
  alternatives: "利用者ごとのwrapper追加やsymlink禁止は配布境界を壊すため採用しない"
  compatibility: "実体パスの直接実行とmodule import時の非実行を維持する"
  rollback: "実体パス比較helperとsymlink回帰テストを除去すれば旧判定へ戻る"
  boundary: "CLI起動判定だけを変更し、subcommand、引数、Gateの意味は変更しない"
---

# Story

## User Story

**As a** npmまたはローカルbinからVibeProを使う利用者
**I want** `vibepro` がsymlinkで配置されていても実体ファイルの直接実行と同じように起動すること
**So that** 成功終了なのに処理も出力もない偽成功を避けられる

## Acceptance Criteria

- [ ] SBE-S-1: 実体の `bin/vibepro.js` とそれを指すfile symlinkの両方が `version` を出力して終了コード0を返す。
- [ ] SBE-S-2: `bin/vibepro.js` をmoduleとしてimportした場合はCLIを自動実行しない。
- [ ] SBE-S-3: 壊れたsymlink、解決不能なentrypoint、未指定の `process.argv[1]` は例外でimport利用を壊さず、直接実行と誤判定しない。

## Impact Scope

`bin/vibepro.js` のプロセスentrypoint判定と `test/bin-entrypoint.test.js` の回帰契約に限定する。

## Non Goals

- global CLIのインストール方法や配置先の変更。
- subcommand、Gate DAG、artifact形式の変更。
- directory symlinkを用いたrepository境界の変更。
