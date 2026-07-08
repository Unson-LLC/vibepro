---
story_id: story-vibepro-roi-measurement-loop-closure
title: "ROI台帳をworktree分断から中央台帳へ接続し、月次チューニングが読めるデータを蓄積する"
status: active
view: dev
period: 2026-07
source:
  type: value_audit_followup
  title: "gate-outcomes ledger が gitignore + worktree ローカルのため、#287/#291 の計測ループが空回りしている"
related_stories:
  - story-vibepro-gate-outcome-roi-ledger
  - story-vibepro-agent-runtime-metrics
  - story-vibepro-session-cost-attribution-hardening
  - story-vibepro-automation-runtime-cost-ingestion
parent_design: vibepro-roi-measurement-loop-closure
architecture_docs:
  - docs/architecture/vibepro-roi-measurement-loop-closure.md
spec_docs:
  - docs/specs/story-vibepro-roi-measurement-loop-closure.md
created_at: 2026-07-07
updated_at: 2026-07-07
reason: "alternatives considered: un-gitignore the local ledger (merge conflicts across worktrees), a external database (new infra dependency), or merge-time promotion of ledger entries into a tracked central ledger reusing the existing canonical-audit persistence step; selected merge-time promotion. compatibility impact: local .vibepro/gate-outcomes/ledger.json stays gitignored and keeps its schema; a new tracked central ledger file is added and usage report gains a read path, no existing command output field is removed. rollback plan: revert src/merge-manager.js ledger promotion, src/usage-report.js central read path, the central ledger file, this Story, the spec, and design-ssot links in one commit. boundary and scope: promotion happens only inside execute merge post-merge persistence; gate outcome recording semantics in pr-manager remain unchanged; classification authority stays in the ledger schema. accepted followups: none for this PR."
---

# Story

`gate:*` の解消履歴を貯める ROI 台帳（`.vibepro/gate-outcomes/ledger.json`、#287）は、gitignore されたローカルファイルとして各 worktree に分断されている。実データは存在する（ci-gate-check worktree に senior_gap_judgment の needs_review→passed エントリ等）が、mainには台帳が存在せず、月次ゲートチューニング定例（#291、`docs/guide/gate-tuning-ritual.md`）が読むべきデータの蓄積先がない。エントリの outcome も `unclassified` のまま放置される。

このままでは「どのゲートが本物のバグを止め、どのゲートが言い換えコストだけを課しているか」という VibePro 最重要の投資判断が、永久に体感頼みになる。ledger エントリを merge 時に中央台帳へ昇格させ、月次定例が読む一本のデータソースを成立させる。

## User Story

**As a** VibePro の運用者<br>
**I want** `execute merge` が worktree ローカルの ledger エントリを重複なく tracked な中央台帳へ昇格させ、`usage report` がそれを読めること<br>
**So that** 月次ゲートチューニング定例が worktree の生存に依存しない実データで降格・閾値調整を判断できる

## Scope

- `execute merge` の post-merge 持ち回り（canonical audit と同じステップ）で、story に対応するローカル ledger エントリを中央台帳 `docs/management/roi-ledger/ledger.json` へ `entry_key` 重複排除つきでマージする。
- `usage report --gate-roi` が中央台帳を読み、gate_id ごとの解消件数・outcome 分類の分布・unclassified 残数を出す。
- `docs/guide/gate-tuning-ritual.md` の読解対象を中央台帳に更新する。
- 事前宣言する数値目標: (1) 本 Story マージ以降に `execute merge` された story の ledger エントリが中央台帳に 100% 到達する、(2) 中央台帳のエントリは `entry_key` 一意で重複 0 件、(3) `usage report --gate-roi` が unclassified 件数を明示する（隠さない）。

## Acceptance Criteria

- [x] RML-S-1: `execute merge` 完了後、当該 story のローカル ledger エントリが中央台帳に存在する。
- [x] RML-S-2: 同一 `entry_key` のエントリは中央台帳で 1 件に重複排除され、再実行しても件数が増えない。
- [x] RML-S-3: ローカル ledger が存在しない・エントリ 0 件の場合、merge は失敗せず、昇格結果 summary に `no_entries` を明示する。
- [x] RML-S-4: `usage report --gate-roi --json` が中央台帳から gate_id 別の件数・classification 分布・unclassified 件数を返す。
- [x] RML-S-5: 中央台帳の書き込みは決定的順序（entry_key ソート）で、同一入力から同一バイト列が生成される。
- [x] RML-S-6: テストが昇格・重複排除・空 ledger・report 読解の各経路を固定する。

## 既存挙動（inherited behavior）

- Local ledger recording in `.vibepro/gate-outcomes/ledger.json` during `pr prepare` is unchanged and stays gitignored.
- The ledger entry schema (`vibepro-gate-outcome-ledger-v3`) is unchanged.
- Canonical audit artifact persistence during `execute merge` is unchanged.
- Existing `usage report` output fields are unchanged; `--gate-roi` is additive.

## Non Goals

- outcome の自動分類（human/agent が分類する運用は月次定例側の責務のまま）。
- salestailor / brainbase 等の外部リポジトリ側の中央台帳運用の変更。
- runtime cost（token/時間）計測そのもの（story-vibepro-agent-runtime-metrics 等の責務）。

## Runtime Evidence

- current_reality: 変更は `src/merge-manager.js` の post-merge 持ち回りステップへのマージ処理追加、`src/usage-report.js` の読み取り経路追加、focused tests、ritual doc 更新のみ。scheduler・DB・外部送信・新規デーモンは追加しない。
- failure_modes: ローカル ledger 欠如は `no_entries` として明示し merge を止めない。中央台帳の parse 失敗は昇格 summary を failed にして merge の warnings に出す（黙って捨てない）。重複 entry_key は最初の 1 件を保持する。
