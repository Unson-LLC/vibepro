---
story_id: story-vibepro-release-notes-history
title: VibePro Release Notes History Spec
parent_design: vibepro-release-notes-history
---

# Spec

- `VRNH-CON-001`: 日英indexは正式公開版とPR由来の開発マイルストーンを別表で示す。
- `VRNH-CON-002`: 履歴snapshotは2026-07-16時点のmerged PR 281件、main target 273件と明記する。
- `VRNH-CON-003`: 2026-01 / 05 / 06 / 07の各ページは期間内の件数、主要テーマ、根拠PRを持つ。
- `VRNH-CON-004`: 正式公開版はGitHub Release/tagまたはnpm registryで確認できたversionだけを公開済みとして扱う。
- `VRNH-CON-005`: VitePress navigation/sidebarとpublic build contractは日英release routeを含む。
- `VRNH-CON-006`: version historyはrelease notesへリンクし、installed binary contract優先の説明を維持する。
- `VRNH-CON-007`: version historyの日英ledgerは公開版indexの先頭prefixと一致し、新release投影で旧versionの見出しと本文を変更しない。

検証は `test/public-release-notes.test.js` と `npm run docs:build` で行う。
