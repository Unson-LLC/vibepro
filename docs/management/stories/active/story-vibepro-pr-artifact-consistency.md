---
story_id: story-vibepro-pr-artifact-consistency
title: PR成果物を同一HEADの正規データから一貫生成する
status: active
view: dev
period: 2026-08
category: quality
artifact_profile: feature_packet
feature_slug: pr-artifact-consistency
source:
  type: github_issue
  title: "Issue #449: pr prepare emits inconsistent traceability and verification surfaces"
  url: "https://github.com/Unson-LLC/vibepro/issues/449"
reason: "alternatives considered: (a) pr-body.mdだけを局所修正する案は、pr-prepare.jsonとtraceability.jsonの条項不一致、およびtask authority欠落を残すため却下。(b) 消費側が生成成果物を手修正する案は、再実行で上書きされ正本境界を壊すため却下。(c) Story解析・条項map・検証計算値・task authorityをpr prepare内の正規projectionへ集約し、全VibePro所有成果物を同一モデルから生成する案を採用。compatibility impact: 既存JSONフィールドを削除せず、canonical traceabilityへの条項map伝播、verification computed counts、task authority projectionを加算する。既存の自由記述summaryは保持するがcomputed resultより下位の参考情報として型分離する。rollback plan: 共通projectionと追加表示、共有parser、専用回帰テストを単一Story commitとしてrevertすれば従来形式へ戻る。boundary and scope: src/pr-manager.js、src/traceability.js、src/requirement-consistency.js、必要な小規模共有parser、Issue #449回帰テスト、Story/Architecture/Spec/Task証跡に限定する。自動マージ、Gate判定方針、公開ランタイム配布、STAYe側成果物の更新は本PRの外で、修正後の消費側再生成として別確認する。"
created_at: 2026-08-11
updated_at: 2026-08-11
---

# PR成果物を同一HEADの正規データから一貫生成する

## User Story

**As a** VibeProでPR準備を判断する開発者・レビュアー
**I want** 同じHEADから生成されたトレーサビリティ、検証結果、タスク権限が全PR成果物で一致すること
**So that** 消費側でVibePro所有成果物を手修正せず、失敗や未完了を隠さない証拠に基づいてPR readinessを判断できる

## 背景

- Issue #449の消費側再現では、StoryとSpecに12条項ある一方、canonical `traceability.json` は0条項だった。
- canonical verification evidenceには tests=20 / pass=19 / fail=1 があるが、`pr-body.md` は計算済み件数を表示しなかった。
- 人間作成タスク6件と生成proposal 1件が別正本にある一方、PR surfaceは `task_context: null` で権限差を説明しなかった。
- current main `053f33bbb716d2c1a42d3a0153232b672ff7aad5` の最小回帰でも、番号付き見出しはrequirement parser 12件 / traceability parser 0件、大文字見出しは背景を含む13件 / 12件となった。

## 影響範囲

impact_scope_explained: `preparePullRequest` → `buildClauseMapForPrepare` / `recordTraceabilityForPrepare` / `renderPrBody`、`bindStoryTraceability`、Story Acceptance Criteria抽出、verification summary読込、task source projection、および専用回帰テスト。codebase-memoryのcurrent-main indexでは `preparePullRequest` からこれらの経路が直接または2 hopで接続される。トポロジーは試験範囲の選定にのみ使い、正しさは同一HEADの生成成果物比較テストで証明する。

## Acceptance Criteria

- [ ] PAC-S-1: 12個の安定AC IDを持つ回帰fixtureで、`pr-prepare.json` とcanonical `traceability.json` の条項集合・map status・summaryが一致する。
- [ ] PAC-S-2: 番号付き・大文字小文字variantのAcceptance Criteria見出しを両parserが同一に解釈し、背景の箇条書きを含めない。
- [ ] PAC-S-3: `pr prepare` が計算した正確なclause mapをcanonical sidecar bindingへ渡し、再実行で古いsidecarを決定的に修復する。
- [ ] PAC-S-4: tests=20 / pass=19 / fail=1 のcomputed verification resultを `pr-body.md` が正確に表示する。
- [ ] PAC-S-5: computed resultと矛盾する自由記述summaryは権威情報として表示せず、参考情報として明確に従属させる。
- [ ] PAC-S-6: 人間task ledger 6件（done 4 / pending 2）とgenerated proposal 1件（proposal_only / todo / mutates_repository=false）を、別authorityとして `pr-prepare.json` とPR本文に表示する。
- [ ] PAC-S-7: 既存のPR prepare・traceability・verification・Story parserテストに退行がなく、修正版current HEADでVibePro verification証跡と独立review証跡を記録できる。

## 完了境界

- 本StoryのPRはVibePro自身の `pr prepare` / `pr create` で作成する。
- マージ、npm publish、STAYe PR #111の成果物再生成は別途明示された実行権限と修正版ランタイムを必要とする。
