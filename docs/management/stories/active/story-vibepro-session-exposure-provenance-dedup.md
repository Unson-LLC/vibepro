---
story_id: story-vibepro-session-exposure-provenance-dedup
title: Session exposureをprovenance分類しdigest重複排除する
status: active
parent_design: vibepro-runtime-cost-gap-closure
view: dev
period: 2026-07
reason: "alternatives considered: keep classifying every exposure only by semantic path, discard duplicates from totals, or add orthogonal provenance and digest accounting while refining mixed-event allocation; selected provenance plus window-local digest deduplication and segment allocation. compatibility impact: total token accounting, classified exposure total, and bucket schema remain stable; mixed-event bucket values are intentionally redistributed across detected segments. rollback plan: remove the additive fields and restore single-bucket mixed-event allocation without rewriting historical artifacts. boundary: transcript input is observational; digest accounting does not authorize or mutate source artifacts."
architecture_docs:
  - docs/architecture/vibepro-session-exposure-provenance-dedup.md
spec_docs:
  - docs/specs/vibepro-session-exposure-provenance-dedup.md
---

# Session exposureをprovenance分類しdigest重複排除する

## 背景

session-costはartifactらしい文字列を意味bucketへ分類できるが、freshな読込、生成出力、compaction replay、world state、複数内容を含むtool出力を区別できない。同じ内容の再掲も毎回tokenへ加算され、fake-value評価が実際の新規露出を過大評価する。

## 受け入れ基準

- [x] SEXP-S-1: 分類済みexposureを `fresh_read` / `generated_output` / `replayed_context` / `world_state` / `mixed_tool_output` に分類する。
- [x] SEXP-S-2: 同一正規化内容はSHA-256 digestで識別し、unique tokenとduplicate tokenを別集計する。
- [x] SEXP-S-3: total token accountingは後方互換を維持し、mixed event内のsemantic tokenをsegment別に配賦する。
- [x] SEXP-S-4: mixed tool outputを単一の意味bucketだけに帰属した新規読込として扱わず、未分類entryをfresh evidenceへ昇格しない。
- [x] synthetic sessionで分類・segment配賦・重複排除・carryover controlを回帰検証する。

## 検証シナリオ

- `SEXP-S-1`: 5種類のprovenance closed setをsession-cost出力で確認する。
- `SEXP-S-2`: 同一正規化本文2件がraw 2件、unique digest 1件になることを確認する。
- `SEXP-S-3`: audit/src/testを同時に含むtool出力が `mixed_tool_output` になることを確認する。
- `SEXP-S-4`: classified exposure totalを維持し、mixed eventだけをsegmentへ再配賦し、未知入力をfresh evidenceへ昇格しない。

## Runtime Evidence

- `current_reality`: session-costはsemantic bucket schemaとclassified exposure totalを保持し、mixed eventのtokenを検出segmentへ配賦したうえで、各transcript entryへprovenanceとwindow-local digestを付与する。
- `invariants`: total session token accountingとclassified exposure totalは変えない。同一内容もraw totalから消さず、unique/duplicateを追加集計する。mixed tool outputの個別bucket値はsegment配賦により意図的に変わり、単一fresh evidenceへ昇格しない。
- `boundaries`: digestはsession window内の会計識別子であり、artifact identity、権威、永続化、cross-session equivalenceには使わない。
- `failure_modes`: malformed/unmatched entryはunattributed、compactionはreplayed_context、system環境入力はworld_stateに留める。重複やmixed outputを新規価値として過大計上しない。
- `done_evidence`: current-head unitとtypecheckがprovenance closed set、digest dedup、segment配賦、後方互換、負経路を固定し、独立Agent ReviewとAC adjudicationが出力契約を確認する。
