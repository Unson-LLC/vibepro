---
story_id: story-vibepro-session-exposure-provenance-dedup
---

# Architecture

意味分類 `buckets` は互換維持し、各transcript entryへ `provenance_bucket` と正規化本文のSHA-256 `content_digest` を付与する。集約時に `provenance_buckets`、`unique_estimated_tokens`、`duplicate_estimated_tokens` を生成する。

compactionは常に `replayed_context`、system/developer/user環境入力は `world_state`、assistant生成は `generated_output`、tool出力は複数意味シグナルなら `mixed_tool_output`、それ以外は `fresh_read` とする。digestはsession window内だけで重複判定し、canonical artifact自体の保存や意味bucketの生値は変更しない。
