---
story_id: story-vibepro-session-exposure-provenance-dedup
parent_design: vibepro-runtime-cost-gap-closure
---

# Architecture

## Decision

意味分類 `buckets` のschemaとclassified exposure totalは互換維持し、mixed eventの個別bucket値は検出segmentへ意図的に再配賦する。各transcript entryへ `provenance_bucket` と正規化本文のSHA-256 `content_digest` を付与し、集約時に `provenance_buckets`、`unique_estimated_tokens`、`duplicate_estimated_tokens` を生成する。

compactionは常に `replayed_context`、system/developer/user環境入力は `world_state`、assistant生成は `generated_output`、tool出力は複数意味シグナルなら `mixed_tool_output`、それ以外は `fresh_read` とする。digestはsession window内だけで重複判定し、canonical artifact自体の保存やtotal accountingは変更しない。

## Public Contract

`artifact_token_accounting`へprovenance bucket、unique/duplicate token estimate、
carryover controlをadditiveに追加する。既存の`estimated_total_tokens`とsemantic
bucket schemaは互換維持し、mixed-event bucket allocationだけをsegment単位へ精緻化する。
unknown entryはunattributedのままとする。

## Boundaries and Failure Behavior

- transcriptはread-onlyの観測入力で、分類結果やdigestにartifact権威を与えない。
- digest deduplicationはwindow-localで、cross-session identityや永続化keyに使わない。
- mixed outputは検出したsegmentへ一度ずつ配賦し、event全体を単一fresh bucketへ寄せない。
- malformed、空、未一致entryはfresh evidenceへ昇格せずunattributedへ残す。
- replayed contextとduplicate amplificationはcarryover controlへ独立表示し、legacy totalからは削除しない。

## Done Evidence

focused unit testがclosed provenance set、digest安定性、duplicate accounting、
mixed segment配賦、legacy total非回帰、malformed/unmatched負経路を同じcurrent HEADで固定する。
typecheckと独立reviewは公開JSON shapeと責務境界を確認する。
