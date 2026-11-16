---
story_id: story-vibepro-release-0-2-0-beta-14
title: 0.2.0-beta.14 を npm へ出荷する
status: active
view: dev
period: 2026-08
category: release
artifact_profile: feature_packet
feature_slug: release-0-2-0-beta-14
spec_docs:
  - ../../../features/release-0-2-0-beta-14/02_functional_spec.md
source:
  type: operator_request
  title: "PR #486 のReview DAG収束修正をnpmへ公開する"
reason: "alternatives considered: (a) 公開済みbeta.13を使い続ける案はPR #486の修正をnpm利用者へ届けられず、(b) runtime変更をrelease commitへ再同乗させる案は既にmainへマージ済みのimmutable source境界を曖昧にするため退け、(c) version metadataと必要なrelease catalogだけをbeta.14へ更新する。compatibility impact: release commit自体は公開API・依存・runtime挙動を変更しない。rollback plan: merge前はPRを閉じ、公開後はbeta.14をdeprecateしてbeta/latestを直前の正常版へ戻す。npm versionのunpublish・上書きは行わない。boundary and scope: Story、Spec、catalog、package.jsonとpackage-lock.jsonのroot version、post-merge公開確認に限定し、src・bin・依存・publish workflowは変更しない。"
created_at: 2026-08-24
updated_at: 2026-08-24
---

# 0.2.0-beta.14 を npm へ出荷する

## 背景

PR #486で因果的Review DAGと進展感知型convergenceを`main`へ導入したが、npmの
`vibepro`は`0.2.0-beta.13`のままである。専用のversion更新PRをマージし、同じ
マージコミットから`0.2.0-beta.14`を公開する。

## User Story

**As a** npmからVibeProを利用する開発者

**I want to** PR #486の収束修正を含む新しいbeta版を取得したい

**So that** HEAD変更だけの誤停止を避け、意味状態に進展がないreview waveだけを停止できる

## Acceptance Criteria

- [ ] REL14-AC-001: `package.json`と`package-lock.json`のroot versionが`0.2.0-beta.14`で一致する。
- [ ] REL14-AC-002: release差分の製品実装面はStory・Spec・catalog・version metadataに限定し、版番号を固定する回帰テスト以外の`src`、`bin`、依存、公開workflowを変更しない。
- [ ] REL14-AC-003: exact-HEADの公開関連テスト、typecheck、package dry-run、必須CIが成功する。
- [ ] REL14-AC-004: 公開後、npm `gitHead`、`beta` / `latest` dist-tag、Git tag、GitHub prerelease target、fresh install runtimeが同じrelease merge commitへ収束する。
- [ ] REL14-AC-005: npm公開とdocs投影を別段階として読み戻し、部分失敗を成功へ丸めない。

## 対象外

- 新しいruntime機能や依存の追加
- publish workflowの変更
- npm上の既存versionの上書きまたはunpublish

## 公開後の完了条件

PRのマージやActions成功だけでは公開完了としない。npm registry、Git tag、GitHub Release、
fresh install runtime、docs投影を同じrelease merge commitへ照合して完了を判断する。
