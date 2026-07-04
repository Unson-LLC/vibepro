---
story_id: story-vibepro-keyword-gate-structured-migration
title: "summary キーワード照合で解けるゲートを構造化証跡ベースに移行する"
status: active
view: dev
period: 2026-07
source:
  type: operator_feedback
  title: "特定の語を summary に書くとゲートが解ける状態は品質を保証せず、呪文の暗記を要求している"
related_stories:
  - story-vibepro-evidence-token-normalization
  - story-vibepro-verification-observation-artifacts
  - story-vibepro-engineering-judgment-spine-evidence
  - story-vibepro-path-surface-matrix-gate
spec_docs:
  - docs/specs/story-vibepro-keyword-gate-structured-migration.md
created_at: 2026-07-05
updated_at: 2026-07-05
---

# Story

複数の必須ゲートが、証跡 summary の自由記述に対する正規表現・キーワード照合で解消判定をしている（judgment spine の非 generic コマンド語、path_surface_matrix の review_surface 語、requirement gate の英語 inherited-behavior 語 + 条件トークンなど）。この方式は「正しい語を知っているか」の試験になっており、品質を保証せず、構築時点でゲーム可能で、operator に呪文の暗記を強いる。story-vibepro-verification-observation-artifacts が導入した構造化フィールド（`--target` / `--scenario` / `--observed key=value`）を正とし、キーワード照合で解けるゲートを構造化証跡ベースの判定へ移行する。

## User Story

**As a** ゲートを証跡で解消しようとする VibePro ユーザー<br>
**I want** ブロック中のゲートが「どの構造化フィールドに何を記録すれば解消するか」を提示し、その記録で判定されること<br>
**So that** summary の言い回しを試行錯誤せず、事実を構造化して記録すれば再現性をもってゲートが解ける

## Scope

- 棚卸し: 自由記述 summary へのキーワード・正規表現照合を解消条件に含む必須ゲートを列挙し、それぞれの照合条件を構造化フィールドへの対応に写像する。
- 判定移行: 対象ゲートは構造化フィールド（targets / scenarios / observations / 明示宣言）を第一の判定入力とする。
- ガイダンス移行: 対象ゲートのブロック時フィードバックは、受理される構造化フィールドと記録コマンドの具体形を提示する。「summary に特定の語を含めよ」という案内は残さない。
- 互換期間: 既存のキーワード照合による解消は移行期間（最低 1 ヶ月）維持し、キーワード経由で解消された場合は deprecation 注記をゲート詳細に出す。期間経過後の照合削除は別コミットで行う。
- requirement gate の inherited-behavior 判定は、story doc の自由英文照合に代えて、構造化された宣言（対象条件と unchanged/existing の区分）を受理する。

## Acceptance Criteria

- [ ] KGM-S-1: キーワード照合を解消条件に含む必須ゲートの一覧と、各々の構造化フィールド対応表が成果物として存在する。
- [ ] KGM-S-2: 対象ゲートは、summary が bland でも構造化フィールドが充足していれば解消される。
- [ ] KGM-S-3: 対象ゲートのブロック時フィードバックに、受理される構造化フィールドと記録コマンド形が表示される。
- [ ] KGM-S-4: 移行期間中、既存のキーワード照合による解消は引き続き機能し、ゲート詳細に deprecation 注記が付く。
- [ ] KGM-S-5: requirement gate は構造化された inherited-behavior 宣言で REQ-GAP を解消できる。
- [ ] KGM-S-6: テストで構造化解消 / キーワード互換解消 + 注記 / フィードバック表示の各分岐を固定する。

## 既存挙動（inherited behavior）

- Keyword-based resolution paths remain functional during the migration window and are unchanged until the separately committed removal.
- Structured observation recording (`--target` / `--scenario` / `--observed`) introduced by story-vibepro-verification-observation-artifacts is unchanged and becomes the primary input.
- Gate activation conditions (which gates are required for which changes) are unchanged; only resolution matching migrates.

## Non Goals

- ゲートの追加・削除・必須化範囲の変更。
- 移行期間終了後のキーワード照合コード削除（後続の削除専用変更で行う）。
- bug_physics triage の matcher 言語依存誤発火の修正（別 Story で扱う）。
