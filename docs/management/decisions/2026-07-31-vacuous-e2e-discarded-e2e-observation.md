# 破棄したe2e観測(88/89)の開示と、フレーク判定の根拠

- date: 2026-07-31
- story: story-vibepro-vacuous-e2e-test-elimination
- type: evidence_disclosure
- recorded_by: implementing agent (session 70ea817c-ee56-48c0-ab7c-612da8629872)
- status: accepted

## 何が起きたか

head `36e09524` に対する `vibepro verify run --kind e2e` の1回目の実行は
**88/89 (fail 1)** を返した。同じheadでの2回目の実行は **89/89 (fail 0)** を返し、
`.vibepro/pr/story-vibepro-vacuous-e2e-test-elimination/verification-runs/e2e.json`
に記録されている証跡は後者(pass)である。

前者の失敗観測は、runnerが同じartifact pathへ上書きするため、
**痕跡を残さずに置き換えられた**。gate:gate_evidence レビューはこれを正しく指摘した:
「破棄されたfail観測が、記録上どこにも残っていない」。
本recordは、その観測を恒久的に開示するために作成する。

## 失敗した対象

- 失敗ケース: `GAH-S-2 exhausted runtime fallback stop codes remain resumable by the default policy`
- 定義位置: `test/guarded-run-session.test.js:2355`
- 到達経路: `test/e2e/story-vibepro-next-best-action-controller-acceptance.spec.ts`
  が子プロセスでsuiteを再生し、`fail 0` を要求するため、内側の1件failが
  e2e laneの1件failとして表面化した。

## フレークと判定した根拠

1. **本branchは当該テストを変更していない。**
   `git log origin/main..HEAD -- test/guarded-run-session.test.js` は空。
   直近の変更commitは `7e66c43e`(origin/main側)。
2. **タイムアウト値が実測値に対して極端に狭い。**
   当該ケースは `requirements: { ..., timeout_ms: 1000, ... }` を使う。
   idle時の実測は 151.7ms。負荷時に1000msを超えるのは容易であり、
   失敗方向は「時間切れ」であって挙動の不一致ではない。
3. **失敗時のホスト負荷が異常に高かった。** load average 20超。
   同runでは当該spec全体の再生が 180,446ms かかっている。
4. **同じテストはunit laneではpassしている。**
   同head `36e09524` の unit 証跡は 2282/2282 (fail 0) であり、
   `test/guarded-run-session.test.js` はそのlaneに含まれる。
   すなわち同一commit・同一コードで、負荷の低い実行ではpassする。

## 判定と限界

上記4点から、この失敗は**負荷起因のタイミングフレークであり、
本branchの変更に起因する回帰ではない**と判定する。

ただし限界を明示する: フレークであることを**証明**したわけではない。
本branchの範囲外のテストであるため、この判定をもって当該テストの
タイトなtimeoutを修正することはしない。`timeout_ms: 1000` は
負荷のあるCI/ローカルで再発しうる既知の弱点として残る。
恒久対策が必要なら、別Storyとして `test/guarded-run-session.test.js` の
timeout設計を扱うべきである。

**申し送り範囲の訂正**: 当初この申し送りは `test/guarded-run-session.test.js`
だけを対象にしていたが、それでは対象の半分しか捉えていない。
同一Storyの `2026-07-31-vacuous-e2e-discarded-unit-observation.md` が、
unit laneでの同種の破棄 (head `c364fb61`, 2293/2294,
`test/codex-subagent-host.test.js` の shutdown containment) を開示し、
申し送り対象を (1) guarded-run-session の timeout設計、
(2) codex-subagent-host の `waitFor` 待ち時間、
(3) runnerが破棄runを保持しない問題 の3件へ広げている。
別Storyを起こす際はそちらを正とすること。

## なぜwaiverではないか

これはgateのwaiverではない。記録されているe2e証跡は実際にpassした実行であり、
証跡の差し替えや基準の緩和は行っていない。本recordが行うのは、
**同一headで観測された不都合な実行結果を、上書きで消さずに開示すること**
だけである。
