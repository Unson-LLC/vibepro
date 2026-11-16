---
story_id: story-vibepro-release-0-2-0-beta-7
title: 0.2.0-beta.7 を npm へ出荷する
status: active
view: dev
period: 2026-08
category: release
artifact_profile: feature_packet
feature_slug: release-0-2-0-beta-7
architecture_docs:
  - ../../../architecture/story-vibepro-release-0-2-0-beta-7.md
spec_docs:
  - ../../../features/release-0-2-0-beta-7/02_functional_spec.md
parent_design: story-vibepro-release-0-2-0-beta-7
source:
  type: operator_request
  title: "Issue #454 の修正をマージし npm へ公開する"
reason: "alternatives considered: (a) 公開済みの0.2.0-beta.6を再利用する案はnpmのversion不変性に反し、(b) 次の機能PRまで公開を待つ案はIssue #454のaccepted-spec系譜修正がnpm利用者へ届かないため退け、(c) versionだけを0.2.0-beta.7へ上げる最小リリースPRを採用する。compatibility impact: パッケージ内容はmainへmerge済みの変更と同一で、リリースPR自体は公開API・依存・runtime挙動を変更しない。rollback plan: merge前はPRを閉じ、公開後はbeta.7をdeprecateしてbeta/latestをbeta.6へ戻す。npm versionのunpublish・上書きは行わない。boundary and scope: Story、Architecture、Spec、Task、catalog、package.jsonとpackage-lock.jsonのroot version、VibePro証跡、post-merge公開確認に限定し、src・bin・依存・publish workflowは変更しない。"
created_at: 2026-08-12
updated_at: 2026-08-12
---

# 0.2.0-beta.7 を npm へ出荷する

## 背景

Issue #454 の修正は PR #455 として main にマージ済みだが、npm の `vibepro` は
`0.2.0-beta.6` のままである。継続的リリースは、versionを上げたPRがマージされた
場合だけ同じマージコミットを検証・公開するため、専用の最小リリースPRが必要になる。

## User Story

**As a** npmからVibeProを利用する開発者

**I want to** Issue #454の修正を含むmainを新しいbeta版として取得したい

**So that** accepted-specの有効なStory・test系譜がPR準備成果物へ欠落なく投影される版を利用できる

## Acceptance Criteria

- [ ] REL7-AC-001: `package.json` と `package-lock.json` のroot package versionが
      `0.2.0-beta.7` で一致し、`vibepro --version`も同じ値を返す。
- [ ] REL7-AC-002: リリースPRはStory・Architecture・Spec・Task・catalog・version
      metadataだけを変更し、`src`、`bin`、依存、公開workflowの挙動を変更しない。
- [ ] REL7-AC-003: マージコミットに対してtypecheck、全テスト、npm pack dry-runが成功した
      後だけ、`vibepro@0.2.0-beta.7`とGitHub prerelease
      `v0.2.0-beta.7`が公開される。
- [ ] REL7-AC-004: 公開後、npm `gitHead`、`beta` / `latest` dist-tag、GitHub Releaseの
      target commitが同じrelease merge commitを指すことを実測する。

## 対象外

- 新しいruntime機能や依存の追加
- publish workflowの変更
- npm上の既存versionの上書きまたはunpublish

## 公開後の完了条件

PR前のgateはrelease candidateの準備完了までを証明する。npm registry、dist-tag、
GitHub Release、Actionsの成功はマージ後に実測し、その結果で公開完了を判断する。
