---
story_id: story-vibepro-judgment-system-proof-ledger
title: VibePro Judgment System Profile
status: active
---

# VibePro Judgment System Profile

VibePro は、判断DAGを中核に持つ6つの実証系（Brainbase / VibePro / Zeims / keiba / FX / Tech Knight）の一つとして観測される。このProfileは「他の実証系にある機能がVibeProにない」ことを遅れと誤判定しないための固定基準であり、証明そのものは [`docs/proofs/vibepro-judgment-proof-ledger.json`](../proofs/vibepro-judgment-proof-ledger.json) が正本を持つ。Ledgerは `node scripts/check-proof-ledger.mjs` と `test/proof-ledger.test.js` で、引用した実装・テスト名・参照が現在のHEADに存在することを機械検証する。

## native_goal

シニアエンジニアの判断（何を決めるか、何を証拠にするか、いつ反証されたか、なぜ選択肢を捨てたか）を、開発組織の中で再現・追跡・修正可能な履歴として残し、判断の質を複利で積み上げる。

## portfolio_contribution

- 認識・証拠・判断の層（Judgment DAG）の研究所。仮説→予測→証拠→判定、unknown / stale / inconclusive の扱い、immutable run と parent lineage、decision delta を提供する。
- 「AI推奨は advisory、採択は明示 authority、Outcome は後日」の三分離を、実コードとCLIで示す。
- Brainbase Judgment receipt を digest だけで束縛する cross-system receipt の最初の実装例。

## current_frontier（2026-09-02、origin/main `309f5f8d`、0.2.0-beta.19）

| 層 | 現状 | 深度 |
|---|---|---|
| Context | Story・差分・前回 run から保守的 draft を生成。schema 0.3.0 で fail-closed。Brainbase receipt bind | P2 |
| Judgment | Senior Judgment evaluator（VALUE / SIMPLIFY / VALIDATE を因果証拠から導出）→ 5ノードの Development Judgment DAG へ圧縮 | P2 |
| Authority | 採択は `--reviewed-by` / `--authority` 必須。判断は常に advisory。bug Story の診断DAGだけが blocking | P2 |
| Execution | actionable 判断を `story plan` へ binding。実装 commit への到達を結ぶ receipt はない（run-lineage は dormant） | P2（binding まで） |
| Evaluation | disposition と Outcome を時間分離して append。Outcome は次回 prepare の history boundary へ feedback | P2 |

実 Story での運用は 2026-09-03 時点で applicability 8 件（7 repo、Codex 43 セッション）が全件 not_applicable で、評価・Outcome への到達は 0 件（Ledger `VPJ-OBS-001`）。したがって全層とも P3 以上の証明はない。

## non_goals

- PR readiness・merge・release の権限を判断DAGへ戻すこと（旧 Gate DAG は 2026-08-06 に反証済み: `VPJ-REF-016`）
- delivery-efficiency 予算、review lifecycle 会計、HEAD厳密束縛による証跡 stale 化の復活
- Frame / Story / 問題設定の自動採択
- 全判断の Brainbase 自動同期
- FX・keiba・Brainbase との共有 package 抽出（conformance fixture を2実証系が通過するまで）

## accepted_divergences

- **Authority scope モデルを持たない**: 採択 authority は自由文字列。VibePro の公開先は PR であり、既存の人間レビュー＋CI が権限を担う。Zeims 型 scoped authority は Transfer Hypothesis `VPJ-TH-IN-002` として検証対象であり、未検証のまま欠落扱いにしない。
- **Outcome は人間入力ラベル**: 開発判断の成果（設計が正しかったか）は自動計測できないことが多い。自動突合は `VPJ-TH-IN-001` で範囲を限定して検証する。
- **決定・検証レコードは upsert**: append-only なのは判断 run のみ（`VPJ-GAP-006`）。横断 fixture では判断 run に範囲を限定する。
- **単一直線 lineage**: 判断系列の分岐・マージは扱わない。

## authoritative_sources

| 種別 | 正本 |
|---|---|
| 縮小方針・反証記録 | `docs/management/REBUILD.md`, `docs/management/rebuild-plan.md` |
| 判断DAGの意味契約 | `docs/architecture/development-judgment-dag.md` |
| 運用ループ | `docs/architecture/vibepro-development-judgment-operating-loop.md`, `docs/guide/feature-map.md` |
| Senior Judgment | `docs/architecture/vibepro-senior-engineering-judgment-dag.md`, `docs/guide/senior-engineering-judgment.md` |
| 実装 | `src/judgment-dag.js`, `src/senior-judgment-dag.js`, `src/judgment-workflow.js`, `src/judgment-operations.js`, `src/brainbase-integration.js` |
| 証明台帳 | `docs/proofs/vibepro-judgment-proof-ledger.json` |
| historical（現行として数えない） | `docs/architecture/vibepro-judgment-dag-adjudication.md` ほか adjudication 系 Story |

## 観測時の共通質問への回答

| 問い | VibePro の回答 |
|---|---|
| Goal | Story の goal と success_criteria（`expected_outcomes` として node に事前登録される） |
| Observe | 変更ファイル・前回 run・Brainbase receipt。freshness は申告制 |
| Judge | Senior Judgment evaluator（決定論、LLM 非依存） |
| Authorize | `judgment input adopt`（採択）。判断自体に release 権限はない |
| Execute | `story plan` binding。実装は通常の git フロー |
| Evaluate | `judgment disposition record` → `judgment outcome record` |
| Learn | Outcome → 次回 `judgment prepare` の history boundary / adopted batch |

## 既知の不足（Ledger `gaps` の要約）

open:

1. 事前登録された `expected_outcomes` に対する観測の突合がない（`VPJ-GAP-003`）。
2. 採択 authority が自由文字列で scope 検証がない（`VPJ-GAP-004`）。
3. 決定・検証レコードは upsert で append-only ではない（`VPJ-GAP-006`）。
4. `run-lineage.js` は dormant で、判断→実装の execution receipt がない（`VPJ-GAP-008`）。
5. applicability の判定基準が未定義で、実運用は入口で全件 no になっていた（`VPJ-GAP-009`、本Storyで基準を定義）。Codex 側の Skill 配布が 8/8 版で止まっている（`VPJ-GAP-010`）。

resolved（2026-09-02）: `VPJ-GAP-001`（PR #514: workflow Skill に判断ループ手順）、`VPJ-GAP-002` / `VPJ-GAP-007`（PR #516: adjudication 文書を historical 化）、`VPJ-GAP-005`（PR #515: 採択 digest 不一致テスト）。

## 更新規約

- Ledger の claim を昇格（depth を上げる）するには、対応するテスト名または実 run の参照を `source` へ追加し、`npm test` の `proof-ledger` テストが通ること。
- 機能を削除したら claim を `historical` へ落とし `removed_in` を書く。削除して claim を消さない。
- 反証されたら `refuted` と `refuted_by` を残す。反証記録は他実証系が同じ統合を再現しないための資産である。
