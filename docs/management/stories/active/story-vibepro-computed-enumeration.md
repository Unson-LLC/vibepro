---
story_id: story-vibepro-computed-enumeration
title: 網羅範囲の実測値をシステムが計算して埋め、エージェントには識別子と範囲だけを宣言させる
status: active
view: dev
period: 2026-07
category: architecture
source:
  type: operator_feedback
  title: "enumeration gate の8ラウンドで、機械の再計算は8戦8勝で一度も破られなかったが、その再計算が照合する N をエージェントが自書きしていたため、同じ6件の主張が8回書き直された。うち3件は識別子の意味に触れないコミットで stale 化した。破れないのは計算であって、記入欄ではない"
related_stories:
  - story-vibepro-computed-evidence-architecture
  - story-vibepro-enumeration-coverage-gate
reason: "alternatives considered: (a) 記入欄を残したまま stale 検出を賢くする — 再計算はすでに8戦8勝で正しく検出できており、問題は検出漏れではなく『検出されるたびに人手で数え直す往復』なので、精度を上げても往復は減らない。(b) N の自書きを禁止し既存 artifact も無効化する — 親Storyの Non Goals『既存の記録済み証跡 artifact の遡及的無効化』に反し、8ラウンド分の有効な証跡を捨てることになる。(c) 数値欄を持たない宣言形式を追加し、N・M・K をシステムが tree と base diff から計測して埋め、claim ごとに count_source で出所を記録する — これを採用。8ラウンドで唯一無敗だった機構（再計算）はそのまま残し、その入力からエージェントの記入だけを外す。既存の counted 形式は引き続き parse・recount され、agent_declared として区別可能に記録されるため遡及的無効化は起きない。compatibility impact: 既存の counted 形式の scenario・その意味・gate の判定は変更しない。ただし1点だけ非互換がある: ENUMERATION_CLAIM_SIGNAL に `count <token> across` を追加したため、`enumeration:` で始まりこの形を含むのに文法に一致しない prose（例 `enumeration: we count ghost_state across src and test as one class`）は、これまで prose として素通りしていたが今後 enumeration_scenario_malformed として verify record 全体が reject される。本リポジトリの記録済み証跡7件にはこの形は存在せず影響は将来分のみだが、先行Storyが同種の narrowing を明記したのと同様にここに明記する。宣言形式は新しい任意の形式で、gate が next_commands で publish する雛形だけが宣言形式に変わる。計測不能時（base diff が読めない）は enumeration_split_unknown で fail closed にし、『不明』が『全件更新』として通らないようにする。rollback plan: 影響面は6つで、revert 時にはすべてを戻す必要がある: (1) src/enumeration-evidence.js の ENUMERATION_DECLARATION_GRAMMAR・ENUMERATION_CLAIM_SIGNAL への count 追加・parseEnumerationScenario の分岐と count_source・countSitesOnDisk の sites 収集・classifySites・parseAddedLineMap・provider の addedLineMap・verifyObservedCount の computed 分岐・describeScenario の count_source と agent_declared_found・collectEnumerationCoverage の count_provenance・scenarioTemplate、(2) src/pr-manager.js の buildEnumerationCoverageGate required_actions（数値を書くなという運用者向け指示。ここを残すと gate が publish する雛形と印字する指示が食い違う）、(3) test/enumeration-coverage-gate.test.js の CEA-S-2 節（src/enumeration-evidence.js の classifySites 等を static import しているため、コード面だけ戻すと module 解決時に SyntaxError で落ちる。assertion 失敗ではない）、(4) skills/vibepro-gate-evidence/SKILL.md の宣言形式の記述、(5) .vibepro/config.json のStory登録、(6) docs/evidence/story-vibepro-computed-enumeration-{unit,e2e,related,typecheck}.json と本Story doc。既存の verify record 証跡artifactは形式が変わらないため影響を受けないが、gate 側の生成物は claims[].count_source / claims[].agent_declared_found / count_provenance を新たに持つ。いずれも prepare のたびに再生成される。boundary and scope: 網羅範囲の主張における計数の実行主体の移動のみ。gate の適用条件・range floor・recount の判定・escape・既存 gate の閾値は変更しない。親Storyの他の5つの子Story（violation ledger / runner-direct evidence / owner-gated budget / derived mutation checklist / class-recurrence circuit breaker）は対象外。"
parent_design: story-vibepro-computed-evidence-architecture
pr_scope_strategy: atomic_single_pr
pr_scope_reason: "計数の実行主体を移す変更は3レーンに分割できない。runtime-behavior だけを先に出すと、gate が publish する雛形は宣言形式になる一方 SKILL.md は counted 形式を指示したままになり、requirements-ssot だけを先に出すと存在しない形式を運用者に指示することになる。どちらの順序でも、分割した瞬間にドキュメントと shipped behaviour が食い違う期間が生まれる。これはこのStory自身がラウンド7・8で high finding として2度検出された欠陥クラスそのものであり、分割によって意図的に作り出すべきものではない。misc-follow-up の4件は他の2レーンを実行した結果の証跡artifactであり、単独ではレビュー対象を持たない。repo-control（.vibepro/config.json）は本Storyの brainbase.stories[] 登録であり、登録だけを先に出すと存在しない振る舞いのStoryが active になり、振る舞いだけを先に出すと gate が参照するStoryが未登録になる。登録は登録される振る舞いと同時にしか出荷できない。したがって出荷境界は3レーンの和集合で1つであり、分割はレビュー容易性を上げず整合性だけを下げる。"
pr_scope_review_facets:
  - requirements-ssot
  - runtime-behavior
  - misc-follow-up
  - repo-control
pr_scope_dependency_boundaries:
  - "requirements-ssot -> runtime-behavior"
  - "runtime-behavior -> misc-follow-up"
  - "repo-control -> requirements-ssot"
created_at: 2026-07-28
updated_at: 2026-07-28
---

# 網羅範囲の実測値をシステムが計算して埋め、エージェントには識別子と範囲だけを宣言させる

## Background（実測。推測ではない）

親Story `story-vibepro-computed-evidence-architecture` の子Story 2/6（CEA-S-2）。

先行Story `story-vibepro-enumeration-coverage-gate` は、網羅範囲の主張を
`verify record --scenario` の1形式に固定し、gate が宣言範囲を再走査して照合する
機構を実装した。この機構は**8ラウンドの独立レビューで一度も破られなかった**。
水増しした count、重複パスによる範囲の膨張、狭すぎる範囲の申告は、すべて
再計算との不一致として機械的に検出された。

破れなかったのは計算である。壊れ続けたのは記入欄のほうだった。

```
enumeration: grepped <id> across <paths>; <N> sites found, <M> updated, <K> unchanged because <reason>
                                          ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
                                          ここをエージェントが書く
```

`N` は tree の関数である。宣言範囲に含まれるどのファイルが変わっても `N` は変わる。
つまり**真だった主張が、誰も書き換えていないのに偽になる**。gate は正しくそれを
検出し、そのたびにエージェントが手で数え直して書き直す。

このStoryの実装セッション（ラウンド7・8）で実測した往復:

| コミット | 変更内容 | stale 化した主張 |
|---|---|---|
| ff49ce7c | producer 1行 + escape + test | `gate:enumeration_coverage` 26→28、`product_source_unreadable` 2→4、`isCriticalUnresolvedGate` 18→21 |
| 5eab6962 | escape 条件 + test + doc | 6件すべて（34 / 19 / 3 / 3 / 6 / 19 へ） |

ff49ce7c は `product_source_unreadable` という識別子の**意味には一切触れていない**。
にもかかわらずその count は 2 から 4 に変わり、主張は偽になり、手で数え直された。
同じ6件の主張が、このStoryの8ラウンドを通じて**8回書き直された**。

さらに悪いことに、書き直しのたびに新しい虚偽が混入した。ラウンド7では
「CLI suite を head ef966c76 で実行した」と記録したが artifact は ff49ce7c を
記録していた。ラウンド8では「両方の `isCriticalUnresolvedGate` 実装をカバーした」
「4面すべてを振る舞いで検証した」「execution-state の3面は test/execution-state.test.js
でカバーされる」と記録し、mutation testing で3件すべて偽と判明した。
**虚偽を避けようと明示的に努力しているエージェントが、1ラウンドに3件の虚偽を書いた。**

## 学び

1. **再計算は破れない。記入欄が壊れる。** 検出精度の問題ではないので、
   gate を賢くしても往復は減らない。欄を消すしかない。
2. **stale な数値は「誤り」ではなく「陳腐化」だが、書き直しは新しい誤りの入口になる。**
   書き直し8回で虚偽5件。書き直しの回数と虚偽の件数は独立ではない。
3. **エージェントが決めているのは識別子と範囲だけである。** `N` はエージェントの
   判断ではなく tree の観測値であり、`M`/`K` は base diff から機械導出できる。
   エージェントにしか出せないのは「触らなかった site をなぜ触らなくてよいのか」
   という判断だけで、これは計測に落ちない。

## User Story

**As a** enumeration gate を通して変更を出荷するエージェントとレビュアー
**I want** 網羅範囲の主張に数値を書く欄が存在せず、識別子と範囲を宣言すれば
実測値はシステムが計測して artifact に埋め、どの主張が計算由来でどれが
自書き由来かが artifact 上で判別できる状態
**So that** 無関係な変更のたびに数え直す往復と、その往復が生む虚偽の混入が
構造的に消え、レビュアーは「数が合っているか」ではなく
「範囲の選び方が妥当か」だけを見ればよくなる

## Acceptance Criteria

- [x] CEA-S-2-1: 数値欄を持たない宣言形式
      `enumeration: count <identifier> across <paths>[; unchanged because <reason>]`
      が受理され、parse 結果の `found` / `updated` / `unchanged` は null になる。
      エージェントの入力に数値を書く場所が存在しない。
- [x] CEA-S-2-2: gate が宣言形式の claim について、`found` を tree の再走査から、
      `updated` / `unchanged` を base diff の追加行マップから計測して埋める。
      計測値はエージェントの入力を経由しない。
- [x] CEA-S-2-3: 各 claim が `count_source`（`computed` / `agent_declared`）を持ち、
      自書き由来の claim だけが `agent_declared_found` に申告値を保持する。
      report は `count_provenance` で両者の件数を集計する。
      同一識別子・同一範囲・同一数値の2件が、出所によって判別できる。
- [x] CEA-S-2-4: 宣言形式の claim は、宣言範囲に site が増減しても書き直し不要で
      verified のまま維持される。同一内容の counted 形式は同じ変更で
      `enumeration_count_mismatch` になる。
- [x] CEA-S-2-5: base diff が読めず updated/unchanged を分離できない場合は
      `enumeration_split_unknown` で fail closed になる。不明が全件更新として通らない。
- [x] CEA-S-2-6: 計測の結果 `unchanged > 0` の場合のみ「なぜ触らないか」の判断節を
      要求し、拒否メッセージは計測済みの N・M・K を提示する。
      エージェントは数を数えるためにこの往復を使わない。
- [x] CEA-S-2-7: gate が publish する雛形（`scenarioTemplate` / `next_commands`）が
      宣言形式になり、数値の placeholder を含まない。
- [x] CEA-S-2-8: 既存の counted 形式は引き続き parse・recount・受理され、
      `agent_declared` として記録される。既存 artifact は無効化されない。

## Evidence

**このStoryは自身の `gate:enumeration_coverage` を宣言形式だけで閉じている。**
実測値は artifact 側にしか存在しない:

- `.vibepro/pr/story-vibepro-computed-enumeration/pr-prepare.json` の
  `enumeration_coverage.count_provenance` が `{computed: N, agent_declared: 0}` であること
- 同 `claims[]` の各 claim が `count_source: "computed"` と
  `agent_declared_found: null` を持つこと

この節に数値を転記しない。ラウンド8の gate_evidence レビューは、初稿のこの節が
`34/34/0` と `19/13/6` を掲げていたのを high finding として棄却した。実際には
それらは宣言 base（`27b3bf66`）ではなく `origin/main` 基準の値で、しかも `34` と
`19` は**変更前ツリーの site 総数**だった。**手書きの数値を消すためのStoryの、
その根拠節自体が、手書きゆえに stale 化していた。** 数値は artifact から読むこと。

`git diff -U0` の追加行集合に site を写像するという同じ導出を、ラウンド8の
レビュアーは人手で行った。この実装はそれを宣言だけから再現する。

mutation testing（out-of-repo コピー、baseline 62 pass / 0 fail）:

| mutation | 結果 |
|---|---|
| `count_source` を常に agent_declared にする | 6 fail |
| computed claim への計測値の埋め込みを外す | 4 fail |
| diff 読み取り失敗時に空 Map を返す（unknown を全件更新扱い） | 1 fail |
| `scenarioTemplate` を counted 形式に戻す | 1 fail |
| `unchanged > 0` の判断節要求を外す | 1 fail |

## Non Goals

- counted 形式の廃止。既存 artifact の有効性を保つため parse は残す。
- 親Storyの他の5つの子Story。
- 「範囲の選び方が妥当か」の自動判定。範囲は依然としてエージェントの宣言であり、
  range floor（クラス全体に届いているか）の機械検査は先行Storyのまま変更しない。
  範囲の妥当性判断は人間とレビュアーに残る。

## Operational impact

`gate:enumeration_coverage` の判定条件は変わらない。変わるのは、gate が
`next_commands` に印字する雛形が宣言形式になることと、artifact の
`claims[]` に `count_source` / `agent_declared_found`、report に
`count_provenance` が増えることだけである。
