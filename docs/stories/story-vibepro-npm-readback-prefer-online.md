# npm 公開後の readback を registry の cache に左右されず収束させる

## Problem Frame

vibepro の npm-publish run 38734145965（2026-10-15 21:26 JST、0.2.0-beta.31）は `npm publish` を 21:26:59 に終えたあと、`scripts/post-merge-release.mjs` の readback が 21:27:32 に `npm registry did not converge after 6 attempts` で失敗した。公開自体は成功しており、Maintainer が 21:29 に beta.31 の公開を確認している。

原因は2つ:
1. 待ち時間が短い。6 回・backoff 1/2/4/8/16 s で合計 31 s しか待たない。
2. publish 前の `npm view vibepro@<ver>` が、新しい版を含まない packument をローカルの npm cache に残す。registry は packument を `Cache-Control: public, max-age=300` で返すため、npm は最大 300 s その cache を使い、readback が E404 を繰り返しうる。

同じ問題は brainbase#795（`scripts/npm-release.mjs`）で直しているので、同じ方法を vibepro に入れる。

## Constraints

- publish は一度だけ。readback の失敗で再 publish しない。gitHead 検査と dist-tag 調整の手順は変えない。
- workflow の permissions は変えない。`id-token` も `--provenance` も追加しない。runner は self-hosted のまま。
- 待ち時間は publish job の `timeout-minutes: 90` に十分収まること。
- runner 共有の npm cache を消さない。

## Options

1. **採用:** registry を読む `npm view` すべてに `--prefer-online` を付ける。readback の 2 回目以降は使い捨ての `--cache` ディレクトリで cache を迂回し、終わったら消す。既定の試行を 15 回（1/2/4/8/16 s のあと 30 s 上限、待ち合計 301 s ＞ max-age 300 s）にする。brainbase#795 と同じ定数。
2. publish 後に `npm cache clean --force` を実行する。runner 共有 cache を消す副作用があるので採らない。
3. `--prefer-online` だけにする。npm が revalidate を省いた場合に cache の 404 が残りうるので、cache 迂回も併用する。

## Acceptance Criteria

- AC-1: `npmMetadata`、`npmVersions`、dist-tags と time の `npm view` が `--prefer-online` を付ける。
- AC-2: 既定の収束待ちが 15 回・合計 301 s で、300 s を超える（テストで固定）。
- AC-3: 2 回目以降の readback は `bypassCache` で使い捨て cache を使い、終了後に削除する。cache に残った publish 前の 404 を越えて収束する。
