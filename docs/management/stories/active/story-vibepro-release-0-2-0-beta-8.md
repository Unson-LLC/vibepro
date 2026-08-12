---
story_id: story-vibepro-release-0-2-0-beta-8
title: 0.2.0-beta.8 を npm へ出荷する
status: active
view: dev
period: 2026-08
category: release
artifact_profile: feature_packet
feature_slug: release-0-2-0-beta-8
spec_docs:
  - ../../../features/release-0-2-0-beta-8/02_functional_spec.md
source:
  type: operator_request
  title: "Issue #458 の修正をマージし npm へ公開する"
reason: "alternatives considered: (a) 公開済みの0.2.0-beta.7を再利用する案はnpmのversion不変性に反し、(b) 次の機能PRまで待つ案はIssue #458の公開短縮を実運用で検証できないため退け、(c) versionだけを0.2.0-beta.8へ上げる最小リリースPRを採用する。compatibility impact: リリースPR自体は公開API・依存・runtime挙動を変更しない。rollback plan: merge前はPRを閉じ、公開後はbeta.8をdeprecateしてbeta/latestをbeta.7へ戻す。npm versionのunpublish・上書きは行わない。boundary and scope: Story、Spec、catalog、package.jsonとpackage-lock.jsonのroot version、post-merge公開確認に限定し、src・bin・依存・publish workflowは変更しない。"
created_at: 2026-08-12
updated_at: 2026-08-12
---

# 0.2.0-beta.8 を npm へ出荷する

## 背景

Issue #458 のexact-SHA CI証拠再利用は PR #460 としてmainへマージ済みだが、npmの
`vibepro`は`0.2.0-beta.7`のままである。versionを上げた専用PRをマージし、同じ
マージコミットから`0.2.0-beta.8`を公開して短縮経路を実運用で確認する。

## User Story

**As a** npmからVibeProを利用する開発者

**I want to** Issue #458の修正を含む新しいbeta版を取得したい

**So that** 必須CIと公開sourceが一致する場合に、安全性を保ったまま公開待ち時間を短縮できる

## Acceptance Criteria

- [ ] REL8-AC-001: `package.json`と`package-lock.json`のroot versionが
      `0.2.0-beta.8`で一致し、`vibepro --version`も同じ値を返す。
- [ ] REL8-AC-002: リリースPRはStory・Spec・catalog・version metadataだけを変更し、
      `src`、`bin`、依存、公開workflowの挙動を変更しない。
- [ ] REL8-AC-003: マージコミットに結び付いた必須CI証拠が全成功ならfast pathを使い、
      不足・不一致時はfull validationへfail closedする。
- [ ] REL8-AC-004: 公開後、npm `gitHead`、`beta` / `latest` dist-tag、Git tag、
      GitHub prerelease target、fresh install runtimeが同じrelease merge commitへ収束する。
- [ ] REL8-AC-005: merge-to-npmの実測時間をworkflow証拠から記録し、120秒目標を評価する。

## 対象外

- 新しいruntime機能や依存の追加
- publish workflowの変更
- npm上の既存versionの上書きまたはunpublish

## 公開後の完了条件

PRのマージやActions成功だけでは公開完了としない。npm registry、Git tag、GitHub Release、
fresh installしたruntimeを同じrelease merge commitへ照合して完了を判断する。
