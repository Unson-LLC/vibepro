# Architecture: CLI environment boundary

## Context

`bin/vibepro.js` はstdout/stderrだけを `runCli` に注入している。一方、PR準備などの下流処理は注入された `io.env` を権威として扱うため、binary実行と埋め込み実行で判断入力が分岐する。

## Decision

OS process boundaryを所有するbin entrypointが `process.env` を一度だけ読み、既存のIO dependency objectへ渡す。下流は引き続き注入値を利用し、global readへ広げない。

## Failure and rollback

環境objectは参照として渡すだけで列挙・永続化しない。問題時は1引数の除去でrollbackできる。
