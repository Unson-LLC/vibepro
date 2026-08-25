---
story_id: story-vibepro-beta16-release
title: 0.2.0-beta.16 を npm へ出荷する
status: active
view: dev
period: 2026-08
category: release
artifact_profile: feature_packet
feature_slug: release-0-2-0-beta-16
spec_docs:
  - ../../../features/release-0-2-0-beta-16/02_functional_spec.md
source:
  type: operator_request
  title: "PR #491、PR #492、PR #494 の修正を npm release candidate にまとめる"
reason: "公開済みbeta.15ではPR #491、PR #492、PR #494の修正をnpm利用者へ届けられない。release commitへ製品コードを同乗させず、version metadata、release契約、版番号回帰testだけをbeta.16へ更新する。公開前は候補commitを破棄でき、公開後はimmutable versionを上書きせずdeprecateとdist-tag復元で対処する。"
created_at: 2026-08-25
updated_at: 2026-08-25
---

# 0.2.0-beta.16 を npm へ出荷する

## 背景

PR #491（merge SHA `e9385b9846932a37456d62cf85f5ed6092eeec91`）、PR #492
（merge SHA `495b7fbc2724bd13c3f9d82c80b916dd4dd782e8`）、PR #494
（merge SHA `feb4426600ddb48ec91fdd0bbbb47eca18915601`）が`main`へ入った。
release sourceは、3件のmergeとそれぞれのrelease history投影を含むcurrent base
`3db04f430fe017aef42a456ef6c18434ad8b4407`であり、beta.15のsourceは再利用しない。

## User Story

**As a** npmからVibeProを利用する開発者

**I want to** PR #491、PR #492、PR #494のreview instruction、Task authority、Development Judgment計画接続の修正を含むbeta版を取得したい

**So that** safeなagent review指示とcanonical Story Taskに結び付いたPR readinessを利用できる

## Acceptance Criteria

- [ ] REL16-AC-001: `package.json`と`package-lock.json`のroot versionが`0.2.0-beta.16`で一致する。
- [ ] REL16-AC-002: 差分はStory・Architecture・Spec・Task、version metadata、版番号回帰testだけで、製品コード、workflow、依存を変更しない。
- [ ] REL16-AC-003: source lineageとしてPR #491、PR #492、PR #494、各merge SHA、docs projectionを含むcurrent baseを明記する。
- [ ] REL16-AC-004: wrong version、lock mismatch、stale beta.15 pinを回帰testが検出する。
- [ ] REL16-AC-005: exact HEADでrelease checks、typecheck、pack dry-run、full suiteが成功する。
- [ ] REL16-AC-006: 公開前にbeta.16未公開と`latest` / `beta`の現行値を読み戻す。

## Task

1. 版番号回帰testをbeta.16へ更新し、beta.15 metadataに対するREDを記録する。
2. packageとlockfileのroot versionをbeta.16へ揃える。
3. Story、Architecture、SpecをPR #491・#492・#494とcurrent baseへ結び付ける。
4. targeted checks、typecheck、pack dry-run、full suite、差分境界を検証する。
5. focused commitを作る。push、PR、merge、publish、dist-tag、tag、Release、docs deployは行わない。

## 対象外

- 製品コードまたは他Storyの修正
- workflow、依存、公開script、`.vibepro`生成物の変更
- npm publish、dist-tag、Git tag、GitHub Release、docs deploy

## 公開後の完了条件

PRのmergeやActions成功だけでは公開完了としない。npm `gitHead`、dist-tag、Git tag、
GitHub prerelease、fresh install runtime、docs投影を同じrelease merge commitへ照合する。
