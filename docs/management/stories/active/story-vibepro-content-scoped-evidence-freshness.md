---
story_id: story-vibepro-content-scoped-evidence-freshness
title: "証跡の鮮度を HEAD 束縛からコンテンツ束縛に変え、無関係コミットでの失効をなくす"
status: active
parent_design: vibepro-content-scoped-evidence-freshness
view: dev
period: 2026-07
source:
  type: operator_feedback
  title: "コミットすると証跡・レビューが全部 stale になるため、ツリー最終化後に儀式をまとめて行う運用を強いられている"
related_stories:
  - story-vibepro-scoped-evidence-invalidation
  - story-vibepro-pr-freshness-gate-dag
  - story-vibepro-evidence-reuse-metric-semantics
spec_docs:
  - docs/specs/story-vibepro-content-scoped-evidence-freshness.md
created_at: 2026-07-05
updated_at: 2026-07-05
---

# Story

検証証跡とレビュー証跡は現在 git HEAD SHA に束縛されており、docs のみのコミットでもコード証跡が一括で stale になる。この結果「実装しながら証跡を貯める」のではなく「ツリーを最終化してから証跡→レビューを一気に取る」という逆順の運用が事実上強制され、Commit Small の原則とも衝突している。story-vibepro-scoped-evidence-invalidation が始めた changed-surface スコープ判定を鮮度モデルのデフォルトまで押し切り、証跡の束縛先を「その証跡が依拠するファイル群のコンテンツハッシュ」に変える。

## User Story

**As a** 小さくコミットしながら Story を進める VibePro ユーザー<br>
**I want** 証跡の鮮度が「証跡が依拠するファイルの内容が変わったか」で判定されること<br>
**So that** 無関係な docs コミットで証跡が失効せず、実装の途中から証跡を積み上げてそのまま `pr prepare` に到達できる

## Scope

- 証跡記録時に、その証跡が依拠する surface（対象ファイル群）のコンテンツハッシュを束縛情報として保存する。
- `pr prepare` の鮮度判定は、束縛された surface のコンテンツハッシュが現在のツリーと一致するかで行う。surface 外のファイルだけが変わったコミットでは証跡は current のまま。
- レビュー証跡（agent review record）にも同じコンテンツ束縛を適用する。
- 高リスクゲート（security 系・release 系）には strict HEAD 束縛を要求できる設定を残す。
- `gate:pr_freshness` の詳細に、各証跡がどの surface に束縛され、どのファイル変更で失効したかを表示する。

## Acceptance Criteria

- [ ] CEF-S-1: コード証跡の記録後に docs のみのコミットを行っても、`pr prepare` は当該証跡を current として扱う。
- [ ] CEF-S-2: 証跡の束縛 surface に含まれるファイルを変更するコミット後は、当該証跡が stale になる（既存挙動と同等の失効）。
- [ ] CEF-S-3: agent review 証跡も同じ規則に従い、surface 外の変更では stale にならない。
- [ ] CEF-S-4: strict HEAD 束縛を要求する設定が有効なゲートでは、任意のコミットで従来どおり失効する。
- [ ] CEF-S-5: `gate:pr_freshness` の詳細から、証跡ごとの束縛 surface と失効理由（どのファイルが変わったか）を確認できる。
- [ ] CEF-S-6: テストで docs-only 継続 / surface 内変更失効 / review 証跡 / strict 設定の各分岐を固定する。

## 既存挙動（inherited behavior）

- Evidence recorded with explicit HEAD binding under the strict setting behaves as today and is unchanged.
- Stale artifact remediation guidance (`stale_artifact_details` with remediation_command) is unchanged.
- Evidence invalidation scoping by changed surface introduced in story-vibepro-scoped-evidence-invalidation remains valid and is extended, not replaced.

## Non Goals

- 証跡の自動再取得（story-vibepro-pr-evidence-autopilot が扱う）。
- worktree 間の artifact 収穫・lineage 再結合。
- 鮮度以外の証跡受理条件（マーカー語彙・kind 分類）の変更。
