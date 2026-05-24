---
story_id: story-vibepro-pr-prepare-timeout-progress
title: PR Prepare Timeout and Progress Architecture
---

# Architecture

`preparePullRequest()` の内部処理を stage runner で囲む。

Stage runner は次を担当する。

- `stage_start`, `stage_complete`, `stage_failed`, `stage_timeout` の progress event を発行する
- stage ごとの開始時刻、終了時刻、duration、timeout を記録する
- stage timeout 時に `VIBEPRO_PR_PREPARE_STAGE_TIMEOUT` code を持つ Error を投げる

CLI は `--json` の stdout を machine-readable JSON のまま維持し、progress は stderr に出す。
これにより、JSON consumer を壊さずに長時間無出力状態を避ける。

## Timeout Boundary

Timeout は process 全体ではなく stage 単位で扱う。既定値は10分で、通常の大きいリポジトリを誤って止めにくくする。
対象リポジトリが正当に重い場合は `--stage-timeout-ms` で上げられる。

Artifact write / manifest write のような mutating stage も timeout 対象にする。
Node.js の `writeFile` が対応する箇所では `AbortSignal` を渡し、timeout後に書き込み処理だけが裏で続く状態を避ける。

CPU 同期処理は JavaScript event loop を占有すると timer が遅延するため、今後重い同期 scan が見つかった場合は、その scan 自体を chunk 化する。
