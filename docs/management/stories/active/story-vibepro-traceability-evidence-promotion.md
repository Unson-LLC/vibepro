---
story_id: story-vibepro-traceability-evidence-promotion
title: "traceability.jsonをskeletonから昇格させstory doc・artifact・merge lifecycleを自動接続する"
view: dev
period: 2026-06
source:
  type: value-audit
  id: VP-VALUE-AUDIT-2026-06-12-TRACEABILITY-PROMOTION
  title: "最新3 storyのtraceability.jsonがstory_doc_path null / evidence空 / in_progress止まりで、宣言はあるが再構成可能な証拠に届いていない"
related_stories:
  - story-vibepro-traceability-autobind-backfill
architecture_docs:
  - ../../../architecture/vibepro-traceability-evidence-promotion.md
spec_docs:
  - ../../../specs/vibepro-traceability-evidence-promotion.md
status: active
created_at: 2026-06-12
updated_at: 2026-06-12
---

# traceability.jsonをskeletonから昇格させstory doc・artifact・merge lifecycleを自動接続する

## User Story

**As a** story-to-PR traceability を監査する開発者
**I want to** traceability.json が story doc への参照・実 artifact への evidence リンク・merge 後の lifecycle 遷移を自動で持ってほしい
**So that** traceability が「宣言」ではなく、artifact 鎖を実際に辿れる「再構成可能な証拠」になる

## 背景

2026-06-12 の監査で、traceability-autobind-backfill 自身を含む最新 3 story の traceability.json が
`story_doc_path: null` / `evidence: []` / `lifecycle: in_progress`（merge 済みなのに）のままであることが
指摘された。原因は 3 つ:
(1) pr prepare が storyDocPath を渡していない、
(2) pr prepare が生成した実 artifact（pr-body.md / gate-dag.json / verification-evidence.json）を
evidence[] に接続していない、
(3) execute merge が traceability lifecycle を一切更新しない。
「宣言は証拠ではない」という autobind-backfill の invariant が、自身の artifact に跳ね返った状態。

## Scope

- pr prepare が story_doc_path を story source から解決して常に設定する
- pr prepare が生成 artifact への参照を evidence[] に自動接続する
- execute merge が成功時に lifecycle を `merged` へ遷移させ、merge 証拠を evidence[] に追加する
- lifecycle 語彙に `merged` を追加する

## 受け入れ基準

- [ ] `vibepro pr prepare` 成功時、traceability.json の `story_doc_path` に story doc の workspace 相対パスが設定される（story doc が解決できた場合）
- [ ] `vibepro pr prepare` 成功時、`evidence[]` に `{type: "pr_artifact", ref: <path>}` として pr-body.md と gate-dag.json への参照が追加される
- [ ] verification-evidence.json が存在する場合、同様に evidence[] に追加される（存在しない場合は追加されない）
- [ ] `vibepro execute merge` の merge 成功時、lifecycle が `merged`、source が `execute_merge` に更新され、`evidence[]` に `{type: "pr_merge", ref: <pr-merge.jsonのパス>}`（summary に PR URL を含む）が追加される
- [ ] `execute merge --dry-run` および precondition で停止した merge は traceability.json を変更しない
- [ ] 既存の `created_at` と `evidence[]` は両フローで保持され、同一 type+ref の evidence は重複追加されない
- [ ] `merged` が TRACEABILITY_LIFECYCLES に追加され、`trace declare` では宣言できない（証拠を伴う lifecycle のため）
- [ ] 既存テスト（autobind / backfill / usage-report）が全て通る
- [ ] テストは「prepare での story_doc_path 設定」「prepare での evidence 接続」「verification-evidence 有無の分岐」「merge での lifecycle 遷移」「dry-run 非変更」「evidence 重複防止」を含む

## 非目標

- 過去 story の traceability.json の遡及修正（再度 pr prepare / merge が走った時に自然に昇格する）
- pr create 時点での evidence 接続（prepare と merge の 2 点で十分な鎖が張れる）
- evidence[] に artifact の内容ハッシュを入れること（パス参照で開始し、必要になったら別 story）
