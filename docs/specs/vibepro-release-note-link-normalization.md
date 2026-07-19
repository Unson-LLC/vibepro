---
story_id: story-vibepro-release-note-link-normalization
title: Release note link normalization spec
parent_design: vibepro-release-note-link-normalization
code_refs:
  - scripts/post-merge-release.mjs
test_refs:
  - test/post-merge-release.test.js
diagrams:
  - kind: threat_model
    title: Release note projection trust boundaries
    mermaid: |
      flowchart LR
        LivePR[GitHub live merged PR payload] --> Validate[merged PR and repository validation]
        Validate --> Parse[Markdown parser and docs link normalization]
        Parse --> Sanitize[HTML and Vue sanitization]
        Sanitize --> Docs[English and Japanese release docs plus CHANGELOG]
        Unknown[Malformed or unsupported Markdown] --> Preserve[Preserve input and continue projection]
        Preserve --> Sanitize
        Reproject[Docs-only reproject command] --> Validate
        Reproject -. never invokes .-> Publish[npm publish or version history]
---

# Spec

- `RNLN-001`: release section内のinline Markdown destinationが`docs/`で始まる場合、通常リンクをcanonical GitHub blob URL、画像をraw URLへ変換する。既存percent escape、Markdown punctuation escape、HTML entityはVitePressが解釈するhref意味を保持し、angle wrapperは除去する。reference-style definitionはlink/image用途を一意に判定できないため変換しない。
- `RNLN-002`: VitePress parserがblock codeと判定したblockquote/list container内のfence、混在container fence、未閉鎖fence、およびinline code、解析済みlinkのdestination/title内の例示は変換しない。label内のnested imageは独立して変換し、parserが外側linkと認識しないnested-link形式は外側を原文保持する。parserがproseと判定したcontainer終了後のlinkは保護対象にせず、fenced code内やblockquote/list container内の見出しをsection境界にしない。
- `RNLN-003`: HTTP(S)、anchor、mailto、既存のsite-root相対、`docs/`以外のrelative destination、未escapeの`<`または不正Unicodeを含むmalformed angle destinationを変更せず、後続projectionを継続する。
- `RNLN-004`: HTML/Vue sanitizationとPR番号単位のidempotent upsertを維持する。
- `RNLN-005`: 日英release historyとCHANGELOGは同じ正規化済みnoteを受け取る。
- `RNLN-006`: release sectionの開始・終了はcontainer外のtop-level headingだけで決まり、blockquote/list内の同名見出しはsectionを選択・切断しない。
- `RNLN-007`: VitePress Markdown rendererは`project`、`reproject`、`release-body`でのみdynamic importして初期化し、`plan`と`publish-npm`はVitePress package解決にもparser初期化にも依存しない。隔離subprocessで両commandの実境界を検証する。
- `RNLN-008`: `reproject --event <live-pr-payload>`はmerged PRを検証してrelease docsをPR番号markerで冪等更新するが、npm publishとversion history projectionは実行しない。rollback時はGitHub APIで修正後のPR本文を取得したpayloadだけを入力とする。
