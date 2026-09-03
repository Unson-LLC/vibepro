---
story_id: story-vibepro-release-0-2-0-beta-21
title: Issue #518の修正を0.2.0-beta.21として配布する
status: active
artifact_profile: feature_packet
feature_slug: release-0-2-0-beta-21
spec_docs:
  - docs/specs/story-vibepro-release-0-2-0-beta-21-spec.md
reason: Issue #518の修正はmainへ統合済みだが、公開済みbeta.20には含まれない。既存のpost-merge release経路を使い、実装を変更せずversion metadataをbeta.21へ更新する。pack検証をVibeProのbuild証跡として記録するため、既存pack:dry-runを呼ぶbuild aliasだけを追加する。公開失敗時はdist-tagを変更せず、同一SHAのregistry、GitHub Release、fresh installが揃うまで完了としない。
---

# Story

VibePro利用者として、Issue #518のPR送信先整合性修正を含む`0.2.0-beta.21`をnpmから導入したい。

## Acceptance Criteria

- REL21-AC-001: `package.json`、`package-lock.json`、CLIのversionが`0.2.0-beta.21`で一致する。
- REL21-AC-002: 対象テストと型検査が成功し、パッケージ内容を`npm pack --dry-run`で確認できる。
- REL21-AC-003: マージ後、npm registryの`0.2.0-beta.21`、GitHub Release/tag、fresh installが同一のsource SHAを示す。

## Boundary

- Issue #518の実装内容は変更しない。
- `build:pack-dry-run`は既存`pack:dry-run`の検証用aliasに限定し、公開処理を変更しない。
- npm publishとGitHub Releaseは既存のpost-merge release workflowに委ねる。
- registry、Release、fresh installのいずれかが未確認なら本番反映完了としない。
