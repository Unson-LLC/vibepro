---
story_id: story-vibepro-dependency-cycle-scc-reduction
title: "dependency_cycle の SCC 縮約 — 69,490件の単純閉路列挙を「1つのSCC + 20の相互依存ペア」へ畳み、ratchet gate を載せられる粒度にする"
status: active
view: dev
period: 2026-08
category: quality
parent_design: vibepro-dependency-cycle-scc-reduction
related_stories:
  - story-vibepro-conformance-delta-ledger
  - story-vibepro-target-model-governance-rebaseline
  - story-vibepro-target-model-projection-v2
reason:
  decision: "`dependency_cycle` の violation 単位を『全単純閉路（simple cycle）1本ごと』から『強連結成分（SCC）1個ごと』へ変更し、SCC 内部の修復着手点として相互依存ペア（2-cycle）を独立次元 `mutual_dependency` として出す。SCC 検出は反復版 Tarjan（線形時間 O(V+E)）で行い、SCC violation には members / 内部 edge 数 / 内部 mutual pair / 重み最小の feedback edge 候補を持たせる。これにより dependency_cycle は 69,490 件から 1 件へ、violation 総数は 69,524 から 55 件へ落ち、新規悪化の ratchet gate を後続 story で載せられる粒度になる"
  alternatives: "(a) 単純閉路列挙を残したまま件数上限（例: 先頭100件）で切る案は、切り捨てが決定論的な violation id 集合を壊し、conformance delta ledger（CDL-S-3/S-4）の new/resolved 判定が上限境界の揺れでノイズ化するため採用しない。(b) 閉路長の上限（例: 長さ4まで）で絞る案は、閾値が設計上の意味を持たない恣意的な定数であり、かつ『長い閉路だけで繋がっている部分』を静かに見落とすため採用しない。(c) dependency_cycle 次元自体を廃止して undeclared_dependency に統合する案は、CDL-S-6 が『個々の edge は宣言可能に見えても合成が層構造を壊す』という独立の失敗様態として次元を分離した判断を無効化するため採用しない。(d) SCC 1件だけを出して mutual_dependency を出さない案は、『16モジュールが1つの塊』という情報だけでは着手点が一切示されず、リファクタリング story を導出できないため採用しない。(e) 最小 feedback arc set を厳密に解く案は NP困難であり、決定論的かつ線形時間という計測器の性質を壊すため採用せず、重み（実 import 本数）最小の SCC 内部 edge を候補として提示する近似に留める"
  compatibility: "`export function detectModuleCycles(moduleEdges)` は署名を含めてそのまま維持する。この関数は merge 済みの story-vibepro-conformance-delta-ledger の Spec clause S-003 が code anchor `export function detectModuleCycles(moduleEdges) {` と test case `CDL-S-6: detectModuleCycles finds a normalized 2-module cycle regardless of start node` で拘束しており、削除すると過去 story の spec anchor が解決不能になるため。関数は conformance パイプラインからは呼ばれなくなるが、export・引数・戻り値（正規化済み単純閉路の配列）の契約は不変で、既存テストもそのまま通る。呼び出し側だけを SCC ベースへ切り替え、関数本体には組合せ爆発の実測値と代替（detectModuleSccs）を明記した非推奨コメントを置く。violation id の接頭辞は `dependency_cycle:` から `dependency_cycle_scc:` へ変わるが、kind は `dependency_cycle` のまま維持するので delta ledger の by_kind 集計・pr prepare の conformance_summary 参照は構造変更なしで動く。新次元 `mutual_dependency` は DELTA_VIOLATION_KINDS と summary へ加算フィールドとして追加するのみ"
  rollback: "`findDependencyCycles` の呼び出しを `detectModuleSccs` から `detectModuleCycles` へ戻し、`mutual_dependency` を DELTA_VIOLATION_KINDS / summary / markdown から外せば従来出力へ戻る。target-model.json・rules[]・allowed_dependencies は一切変更しないため、モデル側のロールバックは不要"
  boundary: "ratchet gate（新規悪化 block）の実装はしない（次 story）。未宣言依存22件のコード修正・循環の実際の切断はしない（feedback edge 候補を提示するに留める）。target-model.json の modules / allowed_dependencies / rules[] は変更しない。過去 story（story-vibepro-conformance-delta-ledger）の Spec は変更しない。conformance の他次元（undeclared_dependency / orphan_file / budget_violation / stale_pattern）の判定ロジックは変更しない。ファイル単位の循環検出はしない（モジュール単位のまま）"
created_at: 2026-08-05
updated_at: 2026-08-05
---

# dependency_cycle の SCC 縮約 — 69,490件の単純閉路列挙を「1つのSCC + 20の相互依存ペア」へ畳む

## User Story

**As a** architecture conformance を「新規悪化を止める ratchet」まで進めたい開発者
**I want** `dependency_cycle` が「絡まっている塊」1件と「その塊を解く着手点」の一覧として報告されること
**So that** 循環依存の測定結果が読める量になり、新しく増えた循環をノイズに埋もれさせずに検知でき、どの依存を切ればよいかから次のリファクタリング story を導出できる

## Context and Gap

- 本 worktree の base（`origin/main` = `882c3df8`）で `vibepro architecture conformance .` を実測すると、violation 合計 69,524 件のうち `dependency_cycle` が 69,490 件（99.75%）を占める。閉路長ヒストグラムは {2:20, 3:73, 4:237, 5:735, 6:1885, 7:4027, 8:7098, 9:10458, 10:12943, 11:13200, 12:10530, 13:5966, 14:2016, 15:295, 16:7} で、典型的な単純閉路列挙の組合せ爆発である。
- 原因は `src/architecture-conformance.js` の `detectModuleCycles` が、各 start node から DFS して**全単純閉路**を列挙していること。モジュール数が「低い十数」であれば安いという当初の想定（関数コメント）は、密に絡んだグラフでは成立しない。閉路数はモジュール数に対して階乗的に増える。
- 一方でこの 69,490 件が持つ情報量は、実質「1つの絡まった塊がある」だけである。循環に関与する 16 モジュール（agent-runtime, architecture, cli, diagnosis, evidence, gate-pr, graph, reporting, review, run-session, scanners, spec, story, task, uiux-design, workspace-infra）は**単一の強連結成分**を成す。列挙された閉路はすべてこの 1 つの SCC の内部経路にすぎない。
- この状態では ratchet gate（新規悪化を block）を載せられない。(1) 新規に 1 本 edge が増えるだけで数千〜数万件の「新規 violation」が湧き、本当の悪化が埋もれる。(2) 列挙自体が計測コストを支配する。(3) delta ledger の new/resolved 集計が実質的に無意味な数字になる。
- SCC 1 件だけでは「どこを直せば切れるか」が分からない。実測では相互依存ペア（2-cycle）が 20 組あり、これが最小かつ最も明白な修復着手点である（architecture↔gate-pr, cli↔diagnosis, cli↔gate-pr, cli↔story, cli↔workspace-infra, diagnosis↔gate-pr, diagnosis↔spec, diagnosis↔story, evidence↔gate-pr, evidence↔workspace-infra, gate-pr↔reporting, gate-pr↔review, gate-pr↔spec, gate-pr↔story, gate-pr↔workspace-infra, reporting↔workspace-infra, review↔run-session, review↔workspace-infra, run-session↔workspace-infra, story↔task）。

## Acceptance Criteria

- [ ] DCS-S-1: `detectModuleSccs(moduleEdges)` が有向モジュールグラフの強連結成分を**反復（非再帰）版 Tarjan** で線形時間 O(V+E) で求め、size>1 の SCC と、自己ループを持つ単一ノードの SCC を循環として返す。結果はメンバーのソート順で決定論的に並ぶ。
- [ ] DCS-S-2: `dependency_cycle` violation は SCC 1 個につき 1 件になり、id は構成モジュールのソート済みリストから決定論的に導出される（`dependency_cycle_scc:<module>+<module>+...`）。同一グラフを 2 回スキャンすると id 集合が完全一致する。
- [ ] DCS-S-3: SCC violation は `members`（ソート済み）、`module_edge_count`（SCC 内部のモジュール間 edge 数）、`import_edge_count`（それらを構成する実 import 本数）、`mutual_pairs`（SCC 内部の相互依存ペア）、`feedback_edge_candidates` を持つ。
- [ ] DCS-S-4: 相互依存ペア（両方向に import がある module ペア）が `mutual_dependency` という独立 kind の violation として出力される。id は `mutual_dependency:<a>+<b>`（アルファベット順）で、各件は両方向の実 import 本数と例示 edge を持つ。
- [ ] DCS-S-5: `feedback_edge_candidates` は SCC 内部のモジュール間 edge を実 import 本数の昇順で並べた上位候補であり、各候補は from/to/import 本数/例示 edge を持つ。これは最小 feedback arc set の厳密解ではなく重み最小の候補提示であることが、コードと出力の両方で明示される。
- [ ] DCS-S-6: `summary` に `mutual_dependency_count` が追加され、`dependency_cycle_count` は SCC 件数を指す。`architecture-conformance-delta.js` の `DELTA_VIOLATION_KINDS` に `mutual_dependency` が含まれ、delta の `by_kind` に次元として現れる。
- [ ] DCS-S-7: `export function detectModuleCycles(moduleEdges)` は署名・戻り値契約ともに維持され、既存の CDL-S-6 テスト（正規化の start node 非依存性）がそのまま通る。ただし conformance パイプラインからは呼ばれない。
- [ ] DCS-S-8: 本リポジトリ実測で `dependency_cycle` が 69,490 件から 1 件、`mutual_dependency` が 20 件、`undeclared_dependency` 22 / `orphan_file` 1 / `budget_violation` 11 が不変であることが確認できる。

## Inherited Behavior

- import scan による依存判定（PR #387 / `EDGE_SOURCE = 'import_scan'`）を維持する。graphify calls エッジは復活させない。
- violation id は要素自身の意味値から導出する（配列 index やグループ序数を使わない）という CDL-S-1/S-2 の不変条件を維持する。
- 循環は個々の edge が `allowed_dependencies` で許可されていても報告する（CDL-S-6 の判断）。
- conformance は derive-only であり、recorded evidence を新設しない。

## Non Goals

- ratchet gate（新規悪化 block）の実装。
- 循環の実際の切断（コード修正）と未宣言依存 22 件の解消。
- target-model.json（modules / allowed_dependencies / rules[] / governance）の変更。
- 過去 story の Spec 改訂。
- ファイル単位の循環検出。
- 最小 feedback arc set の厳密解法。

## 初期タスク

1. SCC 検出器
   - 反復版 Tarjan `detectModuleSccs` を実装、決定論性テスト
2. violation 形状の切り替え
   - `findDependencyCycles` を SCC ベースへ、`mutual_dependency` 次元を追加、feedback edge 候補
3. 集計・delta・markdown の追随
   - `summary.mutual_dependency_count`、`DELTA_VIOLATION_KINDS`、conformance markdown の見出し
4. 後方互換の確認
   - `detectModuleCycles` 維持、両 story の `spec drift` が clean であることの実測
