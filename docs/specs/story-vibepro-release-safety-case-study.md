# Spec: リリース安全事例

Story: `story-vibepro-release-safety-case-study`

## 契約

### RSCS-CONTRACT-1 公開ページ

日本語VitePressは `/ja/cases/release-safety` にリリース安全事例を持つ。

対象: `docs/ja/cases/release-safety.md`

テスト: `test/release-safety-case-study.test.js`

### RSCS-CONTRACT-2 根拠

事例はPR #450、#451、#452と、`0.2.0-beta.6`を公開したActions実行へ直接リンクする。公開リンクだけで追跡できない総所要時間と別セッションレビューは、作業スレッド由来であることと計測境界を示す。

対象: `docs/ja/cases/release-safety.md`

テスト: `test/release-safety-case-study.test.js`

### RSCS-CONTRACT-3 主張の境界

事例は確認できた事実とVibeProの寄与に関する解釈を分け、VibeProが不具合を単独で自動検出したとは主張しない。PR #451の対象は`beta.6`と今後処理するReleaseであり、過去の`beta.1`から`beta.5`は再分類していないと明記する。

対象: `docs/ja/cases/release-safety.md`

テスト: `test/release-safety-case-study.test.js`

### RSCS-CONTRACT-4 日本語導線

日本語ナビゲーションの「事例」は `/ja/cases/release-safety` を指す。英語ナビゲーションは変更しない。

対象: `docs/.vitepress/config.mjs`

テスト: `test/release-safety-case-study.test.js`

### RSCS-CONTRACT-5 公開ビルド

公開マニュアルのビルドは新しい事例ページを含んだ状態で成功する。

対象: `docs/ja/cases/release-safety.md`, `docs/.vitepress/config.mjs`

検証: `npm run docs:build`
