---
story_id: story-vibepro-session-exposure-provenance-dedup
title: Session exposureをprovenance分類しdigest重複排除する
status: active
view: dev
period: 2026-07
reason: 既存の意味bucketを互換維持し、直交するprovenanceとdigest集計を追加する。rollbackは追加フィールドの削除で可能。
architecture_docs:
  - docs/architecture/vibepro-session-exposure-provenance-dedup.md
spec_docs:
  - docs/specs/vibepro-session-exposure-provenance-dedup.md
---

# Session exposureをprovenance分類しdigest重複排除する

## 背景

session-costはartifactらしい文字列を意味bucketへ分類できるが、freshな読込、生成出力、compaction replay、world state、複数内容を含むtool出力を区別できない。同じ内容の再掲も毎回tokenへ加算され、fake-value監査が実際の新規露出を過大評価する。

## 受け入れ基準

- [ ] exposureを `fresh_read` / `generated_output` / `replayed_context` / `world_state` / `mixed_tool_output` に分類する。
- [ ] 同一正規化内容はSHA-256 digestで識別し、unique tokenとduplicate tokenを別集計する。
- [ ] 既存の意味bucketとtotal token accountingは後方互換を維持する。
- [ ] mixed tool outputを単一の意味bucketだけに帰属した新規読込として扱わない。
- [ ] synthetic sessionで分類と重複排除を回帰検証する。

## 検証シナリオ

- `SEXP-S-1`: 5種類のprovenance closed setをsession-cost出力で確認する。
- `SEXP-S-2`: 同一正規化本文2件がraw 2件、unique digest 1件になることを確認する。
- `SEXP-S-3`: audit/src/testを同時に含むtool出力が `mixed_tool_output` になることを確認する。
- `SEXP-S-4`: 既存semantic bucket totalsを維持し、未知入力をfresh evidenceへ昇格しない。
