---
story_id: story-vibepro-judgment-system-proof-ledger
title: VibeProを判断DAG実証系として観測できるProfileとProof Ledgerを正本化する
status: active
view: dev
period: 2026-09
category: architecture
source:
  type: operator_feedback
  title: "6つの判断DAG実証系を横断比較し、証明済み能力と不足を他の実証系へ改善仮説として返したい"
reason: "alternatives considered: (a) 横断比較をBrainbase側の文書だけで行う、(b) 各repoへ共通packageを抽出する、(c) 各repoが自分の証明台帳を機械検証付きで持ちBrainbaseが集約する。選択は(c)。(a)は引用したテストが消えても気づけず、(b)は実装契約が未収束のまま早すぎる抽象化になる。compatibility impact: 既存CLI・artifact・gate挙動は変更しない。docs/proofs と scripts/check-proof-ledger.mjs と test/proof-ledger.test.js の追加のみ。rollback plan: 3ファイルとStory登録を削除する。boundary and scope: 証明の記録と機械検証だけを扱い、Judgmentの実装変更・Skill改訂・他repoへの適用は後続Storyへ分離する。"
created_at: 2026-09-02
updated_at: 2026-09-02
---

# VibeProを判断DAG実証系として観測できるProfileとProof Ledgerを正本化する

## 背景

Brainbase / VibePro / Zeims / keiba / FX / Tech Knight は同型の判断システム（Context → Judgment → Authority → Execution → Evaluation）を別々に実装している。これらを横断観測し、どの能力がどこまで証明され、何が反証され、どの改善仮説を他へ移せるかを判断するメタ判断DAGを作る計画がある。

その前提として、各実証系は「何が証明済みか」を自己申告ではなく、現在のHEADに存在する実装とテスト名で裏付けた台帳として持つ必要がある。VibeProには判断DAGの設計文書と実装とテストが揃っているが、削除済みの adjudication を現行として記述する文書が残り、外部の観測者が design / historical / current を混同できる状態にある。

## Story

判断DAG横断比較の観測者として、VibePro が何を・どの深度で・どの条件で証明していて、何を証明していないかを、リポジトリ内の機械検証付き台帳から読みたい。

それにより、リポジトリ単位の完成度ではなく Capability × Proof の単位で改善判断ができ、他の実証系へ移す Transfer Hypothesis を VibePro 側の事実に基づいて起草できる。

## Acceptance Criteria

- `docs/proofs/vibepro-judgment-proof-ledger.json` が、VibePro の判断DAG能力を claim 単位（id / capability / layer / claim / depth P0–P6 / status / source / conditions / not_proven / transfer_targets）で保持する。 <!-- ac:JPL-001 -->
- 現行として数える claim は、引用した実装パスとテスト名が現在のHEADに実在することを `scripts/check-proof-ledger.mjs` が検証し、存在しない引用は失敗する。 <!-- ac:JPL-002 -->
- 削除済み機能は `historical`（`removed_in` 付き）、反証済み設計は `refuted`（`refuted_by` 付き）として台帳に残り、current の深度を主張できない。 <!-- ac:JPL-003 -->
- 台帳は `gaps` と inbound / outbound の `transfer_hypotheses` を持ち、参照先の claim / gap が存在しなければ検証が失敗する。 <!-- ac:JPL-004 -->
- `docs/architecture/vibepro-judgment-system-profile.md` が native_goal / portfolio_contribution / current_frontier / non_goals / accepted_divergences / authoritative_sources を固定する。 <!-- ac:JPL-005 -->
- `npm test` が台帳検証を含み、CI で台帳と実装の乖離を止める。 <!-- ac:JPL-006 -->

## Non-goals

- Development Judgment の実装変更、Skill 改訂、stale 文書の書き換え（`gaps` として記録し後続Storyへ分離）
- 他5実証系の台帳作成、Brainbase への集約 API
- 共有 package の抽出

## 検証

```bash
node scripts/check-proof-ledger.mjs
node --test test/proof-ledger.test.js
npm run typecheck
```
