---
story_id: story-vibepro-test-each-lineage
title: Accepted Specでtest.eachのケースを解決する
status: active
view: dev
period: 2026-08
category: quality
artifact_profile: feature_packet
feature_slug: test-each-lineage
source:
  type: github_issue
  title: "Issue #462: Accepted Spec lineageがtest.eachのテストケースを認識できない"
  url: "https://github.com/Unson-LLC/vibepro/issues/462"
reason: "alternatives considered: Zeims2側に通常testを複製する案は検証対象を歪め、test.eachを使う他利用者でも再発するため却下。単純な部分文字列検索はコメントや別の識別子を誤検出するため却下。既存のtest/it完全一致規則をtest.each/it.eachの二段呼び出し構文へ限定拡張する。compatibility impact: 通常test/it、存在しないcaseName、HEAD blob結合は維持する。rollback plan: resolver変更と専用回帰テストを単一commitでrevertする。boundary and scope: src/traceability.jsのNode test case解決と関連テスト、Zeims2固定HEADでの再検査に限定し、税務判断DAG、fixture、Accepted Spec期待値、他基盤は変更しない。"
created_at: 2026-08-14
updated_at: 2026-08-14
---

# Accepted Specでtest.eachのケースを解決する

## User Story

**As a** parameterized testをAccepted Specの検証証拠として使う開発者
**I want** `test.each`と`it.each`のケース名をtarget HEADのtest blobから完全一致で解決できること
**So that** 実在して通過したparameterized testが`test_case_missing`と誤判定されず、回避用テストを複製せずにGateを閉じられる

## Acceptance Criteria

- TELA-AC-001: `test.each(dataset)(caseName, ...)`のcaseName完全一致をresolvedとして扱う。
- TELA-AC-002: `it.each(dataset)(caseName, ...)`のcaseName完全一致をresolvedとして扱う。
- TELA-AC-003: template名が一致しない場合は従来どおり`test_case_missing`でfail closedにする。
- TELA-AC-004: 通常の`test(caseName, ...)`と`it(caseName, ...)`の既存挙動を維持する。
- TELA-AC-005: 判定対象はtarget HEADのfile blobのままとし、既存の来歴保証を維持する。
- TELA-AC-006: Node 22の対象・関連回帰テスト、`git diff --check`、AGENTS/CLAUDE一致を通す。
- TELA-AC-007: Zeims2 HEAD `f2aacbb3bf7a48d96f2cf58ac3b4b85275023947`を変更せず再検査し、Accepted Spec lineageが7/7 resolvedになる。
- TELA-AC-008: 実装をGate・Review・CIで検証し、PRをmergeした後、新しい不変バージョンとして公開する。

## 完了境界

- 実装PRとnpm公開は分離し、公開は実装merge後のリリースStoryで行う。
- Zeims2のfixture、Accepted Spec、税務判断DAGは変更しない。
