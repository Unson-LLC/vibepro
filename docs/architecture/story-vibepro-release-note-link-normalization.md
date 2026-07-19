---
story_id: story-vibepro-release-note-link-normalization
status: final
parent_design: vibepro-release-note-link-normalization
---

# Release note link normalization architecture

`extractReleaseSections`の表示値正規化境界に、repo-root docs link専用の純粋変換を置く。入力Markdownを行単位で走査し、fenced codeとinline codeを除いたMarkdown link destinationのうち`docs/` prefixだけをcanonical GitHub URLへ変換する。通常リンクはblob URL、画像はraw URLにする。

この境界はprojection先より前なので、英語release page、日本語release page、CHANGELOGが同一本文を受け取る。公開siteに含まれない`docs/management`も参照可能になり、外部URLや一般の相対リンクは推測変換しない。VitePress buildを未知形式に対するfail-closed検査として残す。

raw HTML/Vue interpolationのescape、PR番号markerによるupsert、npm/GitHub Release経路には触れない。rollbackは純粋変換と生成済みlink修正のrevertだけで、永続schema migrationはない。
