---
story_id: story-vibepro-release-exact-sha-fast-path
title: exact-SHA CI証拠を再利用してnpm公開を短縮する
status: active
view: dev
period: 2026-08
category: quality
artifact_profile: feature_packet
feature_slug: release-exact-sha-fast-path
architecture_docs:
  - ../../../architecture/story-vibepro-release-exact-sha-fast-path.md
spec_docs:
  - ../../../features/release-exact-sha-fast-path/02_functional_spec.md
parent_design: story-vibepro-release-exact-sha-fast-path
source:
  type: github_issue
  title: "Issue #458: exact-SHA CI証拠を再利用してnpm公開を短縮する"
  url: https://github.com/Unson-LLC/vibepro/issues/458
reason: "alternatives considered: (a) post-mergeで従来どおり全テストを常に再実行する案は安全だが公開遅延を固定化し、(b) CI結果を無条件に信頼する案はSHAやsource treeの不一致を見逃すため退け、(c) merge commit・reviewed head・package treeとexact-SHA必須CIを検証できた時だけrelease固有検証へ短縮し、それ以外は全テストへfail closedで戻す案を採用する。compatibility impact: npm公開条件と公開後照合は維持し、再利用条件を満たさないPRは既存と同じ検証を行う。rollback plan: validation_modeのfast分岐を削除すれば常時fullへ戻せ、npm versionの上書きやunpublishは行わない。boundary and scope: post-merge release workflow、CI/CodeQLのbase・head署名、検証・時間計測script、unit/E2E、Story・Architecture・Spec・Task・証跡に限定し、通常PRで行う検査内容やnpm/GitHub Releaseの整合条件は弱めない。"
created_at: 2026-08-12
updated_at: 2026-08-12
---

# exact-SHA CI証拠を再利用してnpm公開を短縮する

## 背景

0.2.0-beta.7では、PRのNode 20・Node 22・CodeQLが成功した後も、マージ後の
公開workflowが同じ変更面に対して全テストを再実行し、mergeからnpm公開まで
2分52秒かかった。安全性を落とさず、同一SHAに結び付いたCI証拠を再利用したい。

## User Story

**As a** VibeProのリリース担当者

**I want to** reviewed headと公開対象packageの結び付きを検証した上でexact-SHA CI証拠を再利用したい

**So that** 証拠が十分な公開は速く、証拠が不十分な公開は従来どおり安全に検証できる

## Acceptance Criteria

- [ ] RELFAST-AC-001: PR eventのbase SHA・reviewed head SHAとmerge commitの親、
      再計算したmerge treeと公開対象treeが一致することを機械検証する。
- [ ] RELFAST-AC-002: 現在のPR番号・base SHA・reviewed head SHAを署名した期待workflowの
      `test (20)`、`test (22)`、`analyze`が成功し、信頼できるappと鮮度条件を満たす時だけfast pathを選ぶ。
- [ ] RELFAST-AC-003: fast pathでは全テストを重複実行せず、version整合、型検査、
      release対象テスト、npm pack dry-runを維持する。
- [ ] RELFAST-AC-004: CI証拠の欠落・失敗・進行中・古さ・SHA不一致・base不一致・
      workflow不一致・tree不一致を理由付きで検出し、全テストへfail closedでフォールバックする。
- [ ] RELFAST-AC-005: fast pathとfallbackのどちらでも、npm `gitHead`、dist-tag、
      GitHub Release、git tagの公開後照合条件を弱めない。
- [ ] RELFAST-AC-006: fast、fallback、stale evidence、SHA mismatchをunit/E2Eで固定する。
- [ ] RELFAST-AC-007: `merge_at`、公開開始、npm `publishedAt`、workflow完了時刻から、
      公開前・npm公開・公開後同期・mergeからnpm公開・workflow全体の所要時間を記録する。
- [ ] RELFAST-AC-008: mergeからnpm公開まで120秒以内を目標として、達否をworkflow summaryに残す。

## 対象外

- exact-SHA証拠がない状態での検証省略
- npm immutable versionの上書きまたはunpublish
- GitHub Releaseのprerelease/latest整合条件の緩和
- 通常PRで実行するNode 20・Node 22・CodeQLの削減
