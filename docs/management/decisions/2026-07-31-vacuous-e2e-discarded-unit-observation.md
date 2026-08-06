# 破棄したunit観測(2293/2294)の開示と、フレーク判定の根拠

- date: 2026-07-31
- story: story-vibepro-vacuous-e2e-test-elimination
- type: evidence_disclosure
- recorded_by: implementing agent (session 70ea817c-ee56-48c0-ab7c-612da8629872)
- status: accepted

## なぜこのrecordがあるか

同じStoryの `2026-07-31-vacuous-e2e-discarded-e2e-observation.md` は、e2e laneで
破棄された観測(88/89)を開示し、その基準を明文化した:

> 同一headで観測された不都合な実行結果を、上書きで消さずに開示すること

本recordは、**unit laneでも同じ事象が起きていた**ことを、同じ基準で開示する。
gate:gate_evidence レビューはこの非対称を正しく指摘した: e2e側の破棄は
git-trackedなrecordとして出荷されるのに、unit側の破棄は
`.vibepro/pr/.../decision-records.json` (`.git/info/exclude:23` によりgit除外)
にしか存在せず、merge後にリポジトリへ何も残らない。
それは本Storyが解消しようとしている欠陥そのもの
(「捨てられた赤が見えないまま残る緑の件数」) である。

## 何が起きたか

head `c364fb61` に対する `vibepro verify run --kind unit`
(`npm test -- --test-concurrency=1`) の1回目の実行は
**2294件中 pass 2293 / fail 1** を返した。同じheadでの2回目の実行は
**2294/2294 (fail 0)** を返し、
`.vibepro/pr/story-vibepro-vacuous-e2e-test-elimination/verification-runs/unit.json`
に記録されている証跡は後者(pass, duration 2,927,781ms)である。

- 失敗ケース: `production Codex host shutdown contains the detached worker process group`
- 定義位置: `test/codex-subagent-host.test.js`
- 失敗様態: `waitFor` の condition timeout

## 記録上の限界(重要)

runnerは同一 artifact path (`verification-runs/unit.json` / `unit.log`) へ
上書きするため、**1回目の失敗runの生ログは保持されていない**。
本recordが根拠にできるのは、実行直後に手元へ書き出した集計
(tests=2294 / pass=2293 / fail=1, head before/after ともに `c364fb61`) と、
そのとき同定した上記ケース名までである。失敗時のスタックや実測msは復元できない。

これはrunner側の構造的な欠落であり、本recordの怠慢ではない。
`verification-runs/*.json` の `discarded_agent_observations` は
本来この用途のフィールドだが、runner-direct実行では常に空配列であり、
破棄されたrunを保持しない。**この欠落自体を、下記の追跡対象に含める。**
(runner改修は本Storyのスコープ外であり、ここでは開示と申し送りのみ行う。)

## フレークと判定した根拠

1. **本branchは当該テストも対象製品コードも変更していない。**
   `git diff --name-only origin/main HEAD | grep -i codex` は空である。
   変更集合は `test/e2e` の削除17件、lintスクリプトとそのテスト、
   `ci.yml`、`package.json`、docs/spec/config artifact に限られる。
2. **同一ケースは同一headの再実行でpassしている。**
   2回目のrunで2294/2294、fail 0。コード同一・環境負荷のみ異なる。
3. **既知の負荷起因フレークとして先行開示がある。**
   `decision-1785409758875-45d43cf2` (type: noise, accepted, 記録head `c6d75836`)
   が同一テストの同一失敗様態を、fail時 11712 / 12140 / 13279ms に対し
   単独実行 約1.7〜10秒 という測定差とともに記録している。
   本recordはその**別インスタンス** (head `c364fb61`) の開示であり、
   先行recordの再掲ではない。
4. **失敗時のホスト負荷が高かった。**
   本worktreeを含む複数の並行ラウンドがスイートを実行しており、
   `--test-concurrency=1` へ落とす運用はこの競合への対処として導入されている。

## 判定と限界

上記から、この失敗は**負荷起因のタイミングフレークであり、本branchの変更に
起因する回帰ではない**と判定する。ただしフレークであることを**証明**した
わけではない。1回目の生ログが失われている以上、本判定は
「変更集合が当該テストに到達しない」という静的事実と、
「同一headでpassする」という再現事実に依存する。

## 申し送り(follow-up scope)

先行するe2e側recordは恒久対策の対象として
`test/guarded-run-session.test.js` の timeout設計のみを挙げていた。
本recordはその範囲を**明示的に広げる**。別Storyで扱うべき対象は以下3件:

1. `test/guarded-run-session.test.js` の timeout設計 (`timeout_ms: 1000` 等)
2. `test/codex-subagent-host.test.js` の shutdown containment の `waitFor` 待ち時間
3. runnerが破棄したrunを保持しない問題
   (`discarded_agent_observations` が runner-direct 実行で常に空になる)

## なぜwaiverではないか

これはgateのwaiverではない。記録されているunit証跡は実際にpassした実行であり、
証跡の差し替えも基準の緩和も行っていない。本recordが行うのは、
同一headで観測された不都合な実行結果を上書きで消さずに開示すること、
そして開示できない部分(生ログの喪失)を限界として明記することだけである。
