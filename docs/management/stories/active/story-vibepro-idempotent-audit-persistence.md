---
story_id: story-vibepro-idempotent-audit-persistence
title: "canonical audit 持ち回りを冪等化し、story ごとの同一メッセージ二重コミットを解消する"
status: active
view: dev
period: 2026-07
source:
  type: value_audit_followup
  title: "main の直近40コミット中22本が persist audit artifacts で、全 story で同一メッセージのコミットが2回ずつ入っている"
related_stories:
  - story-vibepro-audit-bundle-budget
  - story-vibepro-canonical-audit-cost-accounting
  - story-vibepro-canonical-audit-artifacts
parent_design: vibepro-idempotent-audit-persistence
architecture_docs:
  - docs/architecture/vibepro-idempotent-audit-persistence.md
spec_docs:
  - docs/specs/story-vibepro-idempotent-audit-persistence.md
created_at: 2026-07-07
updated_at: 2026-07-07
reason: "alternatives considered: remove the second persistence call (loses final merge artifacts from the canonical bundle), squash the two commits via force-push (rewrites shared base history), or make bundle generation deterministic so the existing already_present check works; selected deterministic bundle generation with logical-content comparison. compatibility impact: canonical bundle schema keeps all fields; promoted_at semantics change from generation time to first-promotion time when logical content is unchanged; audit replay and existing consumers keep working. rollback plan: revert src/merge-manager.js and the bundle generation changes, this Story, the spec, and design-ssot links in one commit. boundary and scope: only the execute-merge canonical audit promotion/persistence path changes; pr prepare artifact generation and gate semantics are untouched. accepted followups: none for this PR."
---

# Story

`execute merge` は canonical audit bundle を base ブランチへ持ち回る際、`persistCanonicalAuditToBase` を 2 回呼ぶ（`src/merge-manager.js` の 1 回目: merge 直後、2 回目: 最終 merge artifact を bundle に含めた後）。2 回目のための bundle 再生成で `promoted_at` タイムスタンプと gzip 再圧縮のバイト列が毎回変わるため、`already_present` 判定（`git diff --cached --quiet`）が論理的に同一内容でも絶対に成立せず、**全 story で同一メッセージのコミットが 2 本ずつ** base に積まれる。

実測: main の直近 40 コミット中 22 本が `docs: persist VibePro audit artifacts` で、確認した 10 story すべてが重複ペア。差分は `promoted_at`・`content_hash`・`compressed_bytes` の揺れのみ（例: story-vibepro-pr-body-limit-guard の f5a14ff3 と d59e1727 の diff は 3 ファイル 19 行、全て volatile フィールド）。コミット数・push 回数・履歴ノイズ・下流 CI 起動の四重の固定費になっている。

## User Story

**As a** VibePro を使う開発者<br>
**I want** 1 回の `execute merge` が base に積む audit 持ち回りコミットを最大 1 本にすること<br>
**So that** main の履歴が story 実体の変更を反映し、無意味な再コミット・再 push・下流 CI 起動が消える

## Scope

- canonical audit bundle 生成の決定化: 論理内容（volatile フィールドを除いた artifact 本体）が既存 canonical bundle と同一なら `promoted_at` を初回昇格時刻のまま引き継ぎ、gzip はタイムスタンプ非依存（deterministic bytes）で生成する。
- `already_present` 判定が論理内容比較として機能する状態にする（volatile フィールドの揺れで偽陰性にならない）。
- 2 回目の persistence 呼び出しは、最終 merge artifact の追加で論理内容が実際に変わった場合のみコミットを生む。
- 事前宣言する数値目標: (1) 本 Story マージ以降の story 1 本あたり audit 持ち回りコミットは最大 1 本、(2) 論理内容が不変の再実行はコミット 0 本（`already_present`）、(3) 既存の `vibepro audit replay` が引き続き成功する。

## Acceptance Criteria

- [ ] IAP-S-1: 1 回の `execute merge` で base に積まれる `docs: persist VibePro audit artifacts` コミットは最大 1 本である。
- [ ] IAP-S-2: 論理内容が既存 canonical bundle と同一の場合、persistence は `already_present` で終わり、新規コミットを作らない。
- [ ] IAP-S-3: 同一入力からの bundle 生成（gzip 含む）は同一バイト列を生成する。
- [ ] IAP-S-4: 最終 merge artifact の追加で論理内容が変わった場合は、その差分を含む 1 本のコミットが積まれる（情報の欠落なし）。
- [ ] IAP-S-5: 既存の `vibepro audit replay` は決定化後の bundle からも成功する。
- [ ] IAP-S-6: テストが「再生成でバイト同一」「二重 persist で 1 コミット」「内容変化時は正しく再コミット」の各経路を固定する。

## 既存挙動（inherited behavior）

- The canonical audit bundle schema and its consumers (audit replay, audit index) are unchanged.
- The two-phase promotion flow in execute merge (promote, persist, write merge artifacts, promote again, final persist) is unchanged as a control flow; only content determinism and the dedupe check change.
- Failure handling (`canonical_audit_*_failed` statuses and merge stop reasons) is unchanged.

## Non Goals

- audit bundle の内容削減・予算化（story-vibepro-audit-bundle-budget の責務）。
- 既存 main 履歴上の重複コミットの遡及クリーンアップ（履歴書き換えはしない）。

## Runtime Evidence

- current_reality: 変更は `src/merge-manager.js` の bundle 生成・persistence 判定と focused tests のみ。新規コマンド・scheduler・外部送信・デプロイ経路は追加しない。
- failure_modes: 決定化の比較に失敗した場合は従来どおりコミットする側に倒す（audit 証跡の欠落より重複を許容する）。gzip 決定化が環境依存で崩れた場合もコミット内容は正しく、重複が再発するだけで情報は失われない。
