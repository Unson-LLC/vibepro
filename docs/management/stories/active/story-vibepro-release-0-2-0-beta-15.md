---
story_id: story-vibepro-release-0-2-0-beta-15
title: 0.2.0-beta.15 を npm へ出荷する
status: active
view: dev
period: 2026-08
category: release
artifact_profile: feature_packet
feature_slug: release-0-2-0-beta-15
spec_docs:
  - ../../../features/release-0-2-0-beta-15/02_functional_spec.md
source:
  type: operator_request
  title: "PR #489 のmulti-tenant applicability/evidence separationをnpmへ公開する"
reason: "公開済みbeta.14ではPR #489の修正をnpm利用者へ届けられない。release commitへ製品コードを同乗させず、version metadata、release契約、版番号回帰testだけをbeta.15へ更新する。公開前はPRを閉じ、公開後はimmutable versionを上書きせずdeprecateとdist-tag復元で対処する。"
created_at: 2026-08-25
updated_at: 2026-08-25
---

# 0.2.0-beta.15 を npm へ出荷する

## 背景

PR #489（merge SHA `877dd461695edb52e138a811078551705799d433`）で、非マルチテナントへの
適用可否と実装証拠を分離する修正が`main`へ入った。release sourceは、そのmergeを含む
current base `bf2ed3f591be098d2f7c9f9180a824547fcb246e`であり、beta.14ではない。

## User Story

**As a** npmからVibeProを利用する開発者

**I want to** PR #489のmulti-tenant applicability/evidence separationを含むbeta版を取得したい

**So that** 適用対象外と実装証拠不足を混同せずに診断できる

## Acceptance Criteria

- [ ] REL15-AC-001: `package.json`と`package-lock.json`のroot versionが`0.2.0-beta.15`で一致する。
- [ ] REL15-AC-002: 差分はStory・Architecture・Spec・Task、version metadata、版番号回帰testだけで、製品コード、workflow、依存を変更しない。
- [ ] REL15-AC-003: release sourceとしてPR #489 merge SHAとcurrent baseを明記し、beta.14を候補版として残さない。
- [ ] REL15-AC-004: wrong version、lock mismatch、stale beta.14 pinを回帰testが検出する。
- [ ] REL15-AC-005: exact HEADでrelease checks、typecheck、pack dry-run、full suiteが成功する。
- [ ] REL15-AC-006: 公開前にbeta.15未公開と`latest` / `beta`の現行値を読み戻す。

## Task

1. 版番号回帰testをbeta.15へ更新し、beta.14 metadataに対するREDを記録する。
2. packageとlockfileのroot versionをbeta.15へ揃える。
3. Story、Architecture、Specをrelease source SHAへ結び付ける。
4. targeted checks、typecheck、pack dry-run、full suite、差分境界を検証する。
5. focused commitを作る。push、PR、merge、publish、tag、Release、docs deployは行わない。

## 対象外

- Track Aまたは製品コードの修正
- workflow、依存、VibePro Gate、`.vibepro`生成物の変更
- npm publish、dist-tag、Git tag、GitHub Release、docs deploy

## 公開後の完了条件

PRのmergeやActions成功だけでは公開完了としない。npm `gitHead`、dist-tag、Git tag、
GitHub prerelease、fresh install runtime、docs投影を同じrelease merge commitへ照合する。
