---
story_id: story-vibepro-monotonic-verification-clock
title: 検証の経過時間とタイムアウトを単調時計で測る
status: active
contract_type: bug_fix
view: dev
period: 2026-10
---

# 検証の経過時間とタイムアウトを単調時計で測る

## Story

開発者として、検証コマンドの経過時間と無進捗タイムアウトを壁時計の差ではなく単調時計で測りたい。

それにより、NTP などで時計が戻っても経過が負にならず、進み続けている実行が早いタイムアウトで殺されない。

## Problem Frame

- status: valid
- statement: 検証ランナーの経過時間と、進みが止まったときのタイムアウトが Date.now() の差で測られている。
- reason: main の CI run 38560592122 で、約 750ms 進む executeCommand の進捗延長テストが経過 385ms として失敗した。同じ差は時計が戻ると負（-278ms）にもなる。

## Constraints

### keep-datetime-records
- kind: invariant
- statement: 開始・終了の ISO 時刻、ファイル mtime、識別子は Date のままにする。

### same-clock
- kind: invariant
- statement: タイムアウトの起点と現在時刻は同じ単調時計から取る。

### no-new-secrets
- kind: invariant
- statement: Brainbase producer 契約テストを動かすために新しい秘密を設定しない。秘密の値は残さない。

## Options

### option-monotonic-elapsed
- summary: 経過時間とタイムアウトを performance.now() に切り替え、巻き戻りは 0 に丸める。
- action: fix
- addresses: keep-datetime-records, same-clock
- violates:
- residual_risk: low

### option-report-producer-gap
- summary: BRAINBASE_PRODUCER_MODULE が指す実モジュールが公開リポジトリに無いので、秘密を足さずスキップ理由を報告する。
- action: measure
- addresses: no-new-secrets
- violates:
- residual_risk: medium
