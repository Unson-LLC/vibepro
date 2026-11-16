# delivery-efficiency 予算ガードレール: あるべき姿と現状のギャップ

**作成**: 2026-08-01 / **目的**: 設計やり直しの入力資料 / **状態**: 調査結果（未コミット・提案なし）
**調査方法**: 3系統の並列調査（実装実測 / redesign-required判定の一次資料 / 宣言された意図）。すべて read-only。

---

## 0. 結論（3行）

1. **`agent_consumption_ms` が何の測定値なのかは、一度も定義されたことがない。** 壊れた測定を直す問題ではなく、測定が存在しない問題。
2. **1つの設定キーに、要求の異なる2つの目的（コスト計器 / エージェント自己改変ガード）が同居している。** 権限チェックで守られているのは後者だけ。
3. **承認記録の正本が gitignore されており、checkout を跨いで有効でない。** 人間が承認した事実は tracked ミラーに残るが、強制側はそれを読まない。

---

## 1. あるべき姿（宣言された意図）

### 1.1 何のための予算か — TDEG

> PR readinessが正しいことと、そこへ効率よく到達したことは別である。
> — `docs/management/stories/active/story-vibepro-trusted-delivery-efficiency-guardrail.md:36`

最適化対象（`:45-52`）:
- **成果**: current HEAD での Trusted PR-ready、accepted defect の修正、具体的な risk reduction
- **コスト**: `observed_work_ms` / `active_wait_ms` / `tool_wait_ms` / subagent wall-clock / 並行agent consumption / review dispatch数 / Full Suite回数 / fresh input token / total token / cost
- **不明値**: `unknown` のまま保持し、0や無料へ変換しない
- **制約**: required Gate、critical Gate、独立Review、current-HEAD freshness を効率化理由で弱めない

### 1.2 override gate は何を守るか — OGB

> **override は書けるが、accepted な decision record が無ければ効かない。**
> — `docs/management/stories/active/story-vibepro-owner-gated-budget-override.md:44-46`

導入の引き金（`:26-42`）:

> 実装エージェントが**止める仕組みの設計権と、それを緩める権限の両方を持っていた**…実装エージェントは自セッションで `.vibepro/config.json` を編集して自分の予算を2回引き上げた。

**注**: TDEG は「コスト制御の計器」、OGB は「自己改変ガード」。要求が異なる（計器は精度、ガードは改竄耐性）が、同じ config キーに乗っている。

### 1.3 守るとされている不変条件

- required/critical Gate、独立最終レビュー、current-HEAD束縛、fail-closed は効率化で緩めない（TDEG arch `:88-96`、Spec INV-001）
- unknown は 0 でも無料でも pass でも waiver でもない
- changed lines を時間・トークン・価値の配分根拠にしない
- 予算超過・no-progress・attribution unknown・orphaned agent は**型付き停止**であり、追加spawn・成功・waiver・Gate pass へ暗黙変換されない（TDEG-S-7）
- `pr prepare` は correctness readiness と efficiency debt を**分離**し、required Gate が満たされても debt を見えなくしない（TDEG-S-8）

---

## 2. 現状（実測）

実装は `origin/main` (`5626ddb5`) にのみ存在。現ブランチ `codex/autonomous-implementation-closure-roadmap` には無い。

### 2.1 実効的に機能している次元は 13 中 3 つだけ

`review authorize` は `reviews[]`（lifecycle の start/close 時刻と role）**しか**渡さない（`src/agent-review.js:780-785`）。したがって:

| 次元 | config値 | 実効 |
|---|---|---|
| `max_subagent_count` | 6 | ✓ |
| `max_agent_consumption_ms` | 1,800,000 | ✓（条件付き、後述） |
| `max_review_dispatches_by_role` | 各1 | ✓ |
| `max_total_tokens` / `max_cost_usd` / `max_fresh_input_tokens`(8,000,000) | 設定あり | **✗ 常に unknown** |
| `max_observed_work_ms` / `max_active_wait_ms` / `max_tool_wait_ms` / `max_elapsed_ms` | 設定あり | **✗ 常に unknown** |
| `max_expensive_verification_count` | 1 | ✗（authorize時） |
| `require_known_attribution` | false | **✗ true にすると全dispatchが即停止**（`attribution_status` を `known` にする producer が存在しない） |

### 2.2 `agent_consumption_ms` の実体 = 重複を二重計上する延べ壁時計

`src/delivery-efficiency-guardrail.js:252` は各 review の `finished_at - started_at` を**単純合算**する。重複除去版 `subagent_wall_clock_ms`（`unionDuration`）は**計算されているのに予算次元が存在しない**。

並列4本を10分回すと union 10分・consumption 40分。テストがこの差を固定している（`test/delivery-efficiency-guardrail.test.js:441-468`）。

### 2.3 予算は PR も merge も止めない

- `has_efficiency_debt` を読むコードは repo 内に**ゼロ**
- `summarizeEfficiencyDebt` の `ready_for_pr_create` は `correctness_ready` のコピーで debt を見ない（`:294`、テスト `:507-518` が `debt=true && ready=true` を明示的に固定）
- `pr create` / `execute merge` / `buildMergeGateAuthorization` はいずれも予算を precondition にしない
- 実際に止まるのは **`review authorize` の1点だけ**。そこから間接的に `gate:agent_review` 未resolve → `ready_for_pr_create: false` → PR/merge 拒否、という経路で効く
- `error.code = 'VIBEPRO_REVIEW_DISPATCH_STOP'` は設定されるが**読み手ゼロ**（型付き停止になっていない）

### 2.4 インセンティブが逆転している

open な lifecycle が**1件でもあれば** `hasCompleteReviewTiming` が false になり、`agent_consumption_ms` は `null` → `unknown` → exceeded になり得ない（`:233-234, 250-252`、テスト `:492-505` が固定）。

**close を怠るほど時間予算が緩む。** かつ long-running（＝高コスト）なケースでこそ効かなくなる。

### 2.5 リセット経路が存在しない

`readStoryLifecycleEntries` は Story 配下の**全stage・全entry**を flat 化する（`src/agent-review.js:3793-3805`）。剪定・アーカイブ・リセットの実装は皆無。

回復手段は override 積み増しのみ。結果として `main` の config には **19件の per-Story override**、最大 `max_subagent_count: 481` / `max_agent_consumption_ms: 1,448,270,856`（約16.8日）。

### 2.6 承認が checkout を跨がない（実測で確認）

| 種別 | パス | git | 読み手 |
|---|---|---|---|
| **強制される正本** | `.vibepro/pr/<story>/decision-records.json` | **gitignore** | `resolveBudgetOverrideAuthority` |
| tracked ミラー | `docs/management/decisions/*-budget-override-*.md` | tracked | **コード上ゼロ**（重複回避のファイル名lookupのみ） |

実測: `story-vibepro-owner-gated-budget-override` は tracked ミラーが存在し digest も一致するが、`main-dist` checkout に正本が無く、**`unauthorized / missing_approval` に落ちて base 予算が適用される**。

### 2.7 override gate は2経路のうち1つしか覆っていない

per-Story override は7項目の権限チェックで守られる。一方 **global default `budgets.delivery_efficiency` は依然として素の JSON で、エージェントが書き込め、権限チェックが無い**。OGB 自身が訂正を記録している（`:52-58`）:

> 「迂回路が無い」という表現は過大だったので訂正する。強制されている性質は**「Story 別 override に迂回路が無い」**であり、global default の gating は後続 Story に残る。

後続 Story（GE-004）は存在しない。

### 2.8 運用文書がゼロ

`skills/` `CLAUDE.md` `AGENTS.md` `docs/guide/` `docs/playbooks/` `docs/reference/` で `delivery_efficiency` / efficiency debt / budget stop のヒット **0件**。運用手順は `docs/management/decisions/` の判例としてのみ存在する（増額 / 打ち切り / 分割 の3択を提示する形が定着しているが、どこにも規範化されていない）。

---

## 3. 置き換え案がなぜ却下されたか

branch `claude/zealous-jones-a4447a` (`311d9155`) が試み、**独立裁定12項目中6件が judged_unsound** で `design_status: redesign_required` へ。

実装は3段ラダー（measured → bounded → unbounded）。裁定の核心（原文）:

> **Tier 1 には producer がいない。** `agent_consumption_ms` は lifecycle entry に書き込まれることがなく、`usage_accounting` は input_tokens/output_tokens/total_tokens/cost_usd にキー制限されている。したがって実際のレビューはすべて tier 2 で解決する。

> **bound を設定するのは予算を課される側である。** `timeout_ms` は `review start --timeout-ms` から来る。architecture は自己申告案を trivially self-serving として却下しておきながら、構造的に同型のベクタを、そうと言わずに採用した。

> **この次元は最も重要な場面で不活性になり得る。** count × timeout の天井が cap を大きく下回るため、無条件に `within_budget` を報告する。

**却下されたが記録された代替案**:

| 案 | 却下理由 | 備考 |
|---|---|---|
| トークン基準へ全面移行 | 手動dispatchのレビューは `usage_accounting` が null になり、次元が何も制約しなくなる | 「将来の tier-1 ソースとしては良い」と明記 |
| 待機時間の明示的減算 | 予算を課される lifecycle の内側で自己申告させることになり、検証不能で自明に手前勝手 | **採用案の timeout_ms が同型だと裁定で指摘された** |
| グローバル上限の引き上げ | agent-heavy と slow-verification を区別しない。誤った単位が誤発火する閾値を動かすだけ | |
| 次元そのものの廃止 | 少数の非常に高価なエージェントに対する唯一のガードレール。dispatch 数では表現できない | |

**architecture doc の結論（再設計の出発点）**:

> 生き残るもの: 元の診断。壁時計は誤った単位であり、インシデントは実在し、per-Story override による膨張は誤った処方である。生き残らないもの: このラダーが帰属可能な作業量を測っているという主張。再設計には、**実際に書き込む producer を伴う本物の作業シグナル（トークンかツール呼び出し）か、測定を装わない明示的に限定された代理指標**が要る。

---

## 4. ギャップ表

| # | あるべき姿 | 現状 | 深刻度 |
|---|---|---|---|
| G1 | コストを測って制御する | **測定単位が未定義**。事実上の単位は重複二重計上の延べ壁時計。置換案は「測定ではない」と裁定済み | 根本 |
| G2 | 列挙された全コスト次元を扱う | 13次元中 **3つだけ**が実効。token/cost/work_ms は設定値があっても常に unknown | 大 |
| G3 | 効率 debt を人間に見せる | JSON に書かれるが**読み手ゼロ**。`ready_for_pr_create` は debt を見ない | 大 |
| G4 | 予算超過は型付き停止 | `error.code` は設定されるが読み手ゼロ。文字列メッセージのみ | 中 |
| G5 | 時間予算が常に効く | **open lifecycle 1件で無効化**。close を怠るほど緩む（逆インセンティブ） | 大 |
| G6 | 予算は制御可能な量 | **リセット経路なし**。Story 単位で単調累積、回復は override 積み増しのみ | 大 |
| G7 | 承認は repo に残り再現する | **強制される正本が gitignore**。tracked ミラーは write-only。checkout を跨ぐと `missing_approval` | 大 |
| G8 | エージェントが自分の予算を上げられない | per-Story は守られるが、**global default は素の JSON で書き込み自由** | 大 |
| G9 | 並行 consumption と wall-clock を分離する | union 版は計算済みだが**予算次元が無い**（分離した先が無い） | 中 |
| G10 | 運用者が手順を学べる | **文書ゼロ**。判例のみ | 中 |
| G11 | grandfather pin と config が同期 | コメント自身が「config 19 / pin 16」の事故を記録。同期はテストのみで強制なし | 中 |
| G12 | 同一主体の自己承認を検出 | **完全一致3パターンのみ**。表記ゆれ（`sato_keigo` vs `sato-keigo`）は素通り | 小 |
| G13 | base 予算の各次元が整合 | `subagent 6 × default timeout 600s = 3,600,000ms` に対し `max_agent_consumption_ms: 1,800,000`。6本使う前に時間で止まる（意図か不明） | 小 |

---

## 5. 再設計で決めるべき未決事項

文書が沈黙している論点（優先度順）:

1. **`agent_consumption_ms` は何の測定値か。** 最優先。定義されたことがない。
2. **予算は「同時負荷」を縛るのか「生涯消費」を縛るのか。** 実装は後者だが、Story の書きぶりは前者を想起させる（OGB 自身が「読んだ人間は前者を想像する」と注記）。
3. **terminal debt（timed_out / obsolete / orphaned_agent）は予算を消費すべきか。** 現状は消費する。所有 Story が無い。
4. **既定値（6 / 1,800,000 / expensive 1）の根拠。** どの文書にも無い。
5. **正当な grant のサイズと回数。** 「4回目は無い」という凍結条件が1件の決定記録にあるだけ。
6. **累積した override をいつ退役させるか。** WBAC は「不活性な状態を出荷するのが意図」として明示的にスコープ外。
7. **global default の gating（GE-004）。** 後続 Story が存在しない。
8. **予算停止に対する「分割」「打ち切り」は望ましい応答か。** 判例にはあるが規範化されていない。
9. **運用者はどこで学ぶのか。** skills/guide/playbook すべて沈黙。
10. **未承認 override に floor を設けるか。** 締める向きの override が緩い base に戻る問題。実在しないので保留中。
11. **role 語彙の統一と未登録 role の既定値。** 既定は `architecture/implementation/runtime/security`、実際の override はほぼ別語彙（`gate_evidence` 等）。対応表が無い。
12. **`require_known_attribution` を true にできる条件。** producer が存在しないので現在 true にすると全停止。

---

## 6. このセッションの実測データ（設計判断の材料）

2026-07-29〜08-01 の 5 Story 閉鎖作業で観測された事実:

- **owner grant を 5 回発行**（subagent 6→10→14→18→22→30）。すべて「作業量が増えた」ではなく「スイート待ちで壁時計が膨らんだ」ことが理由。
- **1件の実測**: `subagent_count 12/22`（余裕）に対し `agent_consumption_ms 28,928,270 / 14,400,000`（超過）。次元間で判断が矛盾した。
- **override 編集による digest 失効の連鎖**: 次元を1つ足すたびに既存 grant が失効し、新しい decision record が必要になる。これ自体は設計どおりだが、grant 発行の頻度を押し上げる。
- **エージェントの自己承認は正しくブロックされた**（分類器 + `isSelfGrant` の二重）。OGB の目的は達成されている。
- **ゲートを埋めるために証跡を盛る動機が構造的に存在するが、盛り得はゼロだった**: 偽の観測4件を全数スイープで取り下げても、該当ゲートは真正なトークンだけで閉じたまま。

---

## 7. 保全した一次資料

`claude/zealous-jones-a4447a` の裁定・レビュー記録は gitignore されており worktree 上にしか存在しなかったため、以下へ退避済み（20MB）:

```
/Users/ksato/workspace/repos/vibepro/.vibepro-store/story-vibepro-work-based-agent-consumption-budget/rescue-2026-08-01/
  adjudication/  reviews/  pr/  evidence/
```

**注意**: `311d9155` のコミットメッセージは3つのコード修正（`toDeliveryEfficiencyReviews` 抽出、reservation への `timeout_ms` 付与、portfolio の監査フィールド追加）を「実施した」と書いているが、**全ref検索でツリーに存在しない**（`git reset` で失われた形跡）。再設計時に「対応済み」と仮定しないこと。

また `gate_evidence` レビューが挙げた `src/usage-report.js:1950,1986` の矛盾（同じ台帳に対し2つの artifact が異なる数字を報告する）は、architecture doc の無効化リストに**未収録**。

---

## 8. 追記（2026-08-02、P4 着地時の実測）: 同型のギャップが証跡 binding 層にもある

P4（story-vibepro-vacuous-e2e-test-elimination、PR #407、merge commit `8dc2c3d6`）の着地作業で、
G1「測定が未定義」と同じ構図 — **記録は書けるが、その意味が検証されない** — が予算層の外でも実測された。
再設計のスコープを「予算次元」に閉じるか「記録の意味論全般」へ広げるかの判断材料。

### 8.1 `AC-N: <path>` 形式の target は黙って全件未束縛になる

証跡の target を `AC-3: test/e2e/foo.test.js` のように書くと、`normalizeSurfacePath` が
先頭トークン `AC-3:` をパスとして扱い、**その行は 1 件も束縛されない**。`missing_files` には
出るが、出力は「パース失敗の痕跡」に見え「5 target 中 4 件が未束縛」とは読めない。
G1 と同型: 束縛の成否という測定値があるのに、その解釈（何が束縛されなかったのか）が
運用者に届く形で定義されていない。回避は bare path の併記。

### 8.2 `verify import-ci` の kind マッピングは双方向に証跡を破壊する

CI の `test` ジョブ 2 本が両方 `integration` kind にマップされ、content-bound な
`runner_direct` 記録（束縛 3 ファイル・シナリオ 4 件）を上書き → 依存していた
`gate:common_judgment_spine` / `gate:responsibility_authority` が critical に退行した。
逆向きの再記録は `ci_import` 記録を消す。「1 kind 1 record」の同一 kind 上書きが
**どちら向きにも情報を失わせる**構造で、事前スナップショットを取っていた場合のみ検出できた。

### 8.3 AC マーカーの誤配置は下流に偽記述を生む（実証済み）

AC マーカーを「実際にその主張を実行しないファイル」の隣に置いたところ、後続レビュアーが
マーカー位置を根拠に偽の記述を書いた。§6 の「盛り得はゼロ」とは逆向きの事実:
盛る動機がなくても、**配置の誤りだけで偽情報が下流に増殖する**。マーカーと実行実体の
対応はトークンマッチのみで、意味的束縛が無い（§2 の観測プロセ手編集検出不能と同根）。

### 8.4 予算 grant の digest 束縛は §6 の観測の再現

grant へ次元を 1 つ足すだけで既存 grant が失効し再記録が必要になる事象が P4 でも再発
（owner 決定 3 件のうち 1 件はこの再記録）。§6 で観測した「grant 発行頻度の押し上げ」は
単発事象ではなく構造的。
