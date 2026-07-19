---
story_id: story-vibepro-release-note-link-normalization
status: final
parent_design: vibepro-release-note-link-normalization
---

# Release note link normalization architecture

`extractReleaseSections`の最終subsection表示値正規化境界に、repo-root docs link専用の純粋変換を置く。入力Markdownを全文offsetで走査し、blockquote/list containerを含むfenced codeと、複数行を含むinline codeの範囲を先に保護する。containerが終了した未閉鎖fenceはそこで保護を終え、後続proseを巻き込まない。その後、codeを含み得るnested labelとinline destinationを別々に解析し、`docs/` prefixだけをcanonical GitHub URLへ変換する。通常リンクはblob URL、画像はraw URLにする。

この境界はprojection先より前なので、英語release page、日本語release page、CHANGELOGが同一本文を受け取る。公開siteに含まれない`docs/management`も参照可能になり、外部URLや一般の相対リンクは推測変換しない。reference-style definitionは同じdestinationをlinkとimageが共有でき、blob/rawの選択をdefinition単体では決定できないため対象外とする。VitePress buildを未知形式と対象外形式に対するfail-closed検査として残す。

angle-wrapped destinationはwrapperをcanonical URLへ置換し、空白をpercent encodeしてからHTML/Vue escapeを一度だけ適用する。これにより有効なMarkdown destinationをescapeでliteral textへ壊さず、raw HTML/Vue interpolationの無害化を維持する。PR番号markerによるupsert、npm/GitHub Release経路には触れない。rollbackは純粋変換と生成済みlink修正のrevertだけで、永続schema migrationはない。
