---
story_id: story-vibepro-release-note-link-normalization
title: Release note link normalization spec
parent_design: vibepro-release-note-link-normalization
code_refs:
  - scripts/post-merge-release.mjs
test_refs:
  - test/post-merge-release.test.js
---

# Spec

- `RNLN-001`: release section内のinline Markdown destinationが`docs/`で始まる場合、通常リンクをcanonical GitHub blob URL、画像をraw URLへ変換する。reference-style definitionはlink/image用途を一意に判定できないため変換しない。
- `RNLN-002`: fenced codeとinline code内の例示は変換しない。
- `RNLN-003`: HTTP(S)、anchor、mailto、既存のsite-root相対、`docs/`以外のrelative destinationを変更しない。
- `RNLN-004`: HTML/Vue sanitizationとPR番号単位のidempotent upsertを維持する。
- `RNLN-005`: 日英release historyとCHANGELOGは同じ正規化済みnoteを受け取る。
