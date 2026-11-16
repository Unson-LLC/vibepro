---
story_id: story-vibepro-github-prerelease-convergence
title: GitHub ReleaseのSemVer分類をcreate/editで収束させる
status: active
view: dev
period: 2026-08
category: quality
artifact_profile: feature_packet
feature_slug: github-prerelease-convergence
source:
  type: bug
  title: "BUG-REL6-PRERELEASE: prerelease GitHub Release classification diverges"
reason: "alternatives considered: (a) beta.6だけをGitHub UIで手動修正する案は再実行時に再発し、stable公開時の逆方向誤分類も防げないため却下。(b) create経路だけに--prereleaseを加える案は既存Releaseのedit経路が収束せず、latest状態も暗黙のまま残るため却下。(c) SemVerと現在のGitHub Latestを一度だけ評価し、create/editの両経路へ同じ明示フラグを渡し、操作後にtag SHAとReleaseメタデータを再取得して一致しなければ失敗終了する案を採用。compatibility impact: npm公開順序、タグ名、Release本文、stable/prereleaseのSemVer規則は維持し、GitHub Releaseのprerelease/latest属性だけを決定的かつ単調にする。rollback plan: まず対象tag SHAを保持し、gh release editでprerelease/latestを直前の正しい分類へ戻してmetadataとlatest tagを再確認する。誤作成Releaseはtag SHAを照合してからReleaseだけを削除し、tagは削除しない。その後release分類helper、workflow呼出し、専用回帰テストを単一commitでrevertする。boundary and scope: scripts/post-merge-release.mjs、.github/workflows/post-merge-release.yml、test/github-release-convergence.test.js、既存workflow回帰テスト、Story/Architecture/Spec/Task証跡に限定し、npm dist-tag方針、公開バージョン、beta.6リリースbranch、PR作成・マージ・公開操作は変更しない。"
created_at: 2026-08-11
updated_at: 2026-08-11
---

# GitHub ReleaseのSemVer分類をcreate/editで収束させる

## User Story

**As a** VibeProの公開処理を再実行する保守担当者
**I want** GitHub Releaseのprerelease分類がSemVerから決まり、latest分類がSemVerと操作前のGitHub Latestから単調に決まり、createとeditのどちらでも同じ状態へ収束すること
**So that** npm公開後のGitHub Releaseが誤分類されたまま成功扱いにならず、安定版とプレリリース版の公開面が一致する

## 背景

- 現行workflowは`gh release create`と`gh release edit`へprerelease/latestフラグを渡していない。
- そのため、`0.2.0-beta.6`のようなプレリリースでもGitHub Releaseの既定分類へ依存する。
- edit経路は既存Releaseの誤分類を直す契約を持たず、再実行しても収束しない。
- 操作前のtag SHAは確認するが、create/edit後のtag SHAとReleaseメタデータを再取得して一致を証明していない。

## 影響範囲

impact_scope_explained: `post-merge-release.yml`のGitHub Release create/edit分岐、`scripts/post-merge-release.mjs`のSemVer分類・Release収束helper、実際のCLI subprocessを使う`test/github-release-convergence.test.js`、既存workflow回帰テスト。npm公開・dist-tag収束とは独立したGitHub Release境界に限定する。

## Acceptance Criteria

- [x] GRC-S-1: `0.2.0-beta.6`は`prerelease=true`かつ`latest=false`へ分類される。Test: `test/github-release-convergence.test.js`。
- [x] GRC-S-2: `0.2.0`は`prerelease=false`となり、現在のLatest以下でなければ`latest=true`へ分類される。Test: `test/github-release-convergence.test.js`。
- [x] GRC-S-3: Releaseが存在しないcreate経路と既存のedit経路が、同じ明示フラグで期待状態へ収束する。Test: `test/github-release-convergence.test.js`。
- [x] GRC-S-3b: より新しい安定版がLatestの状態で古い安定版をcreate/editしても、Latestは新しい安定版のまま維持される。Test: `test/github-release-convergence.test.js`。
- [x] GRC-S-4: 操作後にtagのcommit SHAが期待SHAと一致しなければ失敗終了する。Test: `test/github-release-convergence.test.js`。
- [x] GRC-S-5: 操作後にReleaseの`isPrerelease`、`isLatest`、`tagName`、`targetCommitish`を再取得し、期待状態と不一致なら失敗終了する。Test: `test/github-release-convergence.test.js`。
- [x] GRC-S-6: focused unit/E2Eテストはフラグの文字列存在だけでなく、fake `gh`を介したcreate/edit状態遷移と検証失敗を観測する。Test: `test/github-release-convergence.test.js`。
- [x] GRC-S-7: Node 22のclean `npm ci`環境でfocused test、typecheck、全テストが通る。Test: `test/github-release-convergence.test.js`。

## 実装タスク

1. SemVer分類とLatest単調性を実装する
   - プレリリースは常に`latest=false`とする。
   - 安定版は現在のLatestとSemVer比較し、古い版の再実行ではLatestを維持する。
2. create/editを共通helperで収束させる
   - 操作前後のtag SHAと操作後metadataを検証する。
   - 外部状態が一致しなければ非0終了する。
3. 回帰テストとVibePro証跡を固定する
   - create/edit、prerelease/stable、古いstable再実行、SHA/metadata driftを検証する。
   - Node 22でfocused test、typecheck、全テストをrunner-direct記録する。

## 完了境界

- 本Storyでは修正、VibePro証跡、明示的stage、1 intent commitまで行う。
- push、PR作成、マージ、npm公開、beta.6リリースbranchの変更は行わない。
