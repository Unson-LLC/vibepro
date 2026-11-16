---
story_id: story-vibepro-accepted-spec-traceability
title: accepted-specの条項系譜を同一HEADへ再解決する
status: active
view: dev
period: 2026-08
category: quality
artifact_profile: feature_packet
feature_slug: accepted-spec-traceability
source:
  type: github_issue
  title: "Issue #454: accepted-spec lineage is dropped before PR artifact projection"
  url: "https://github.com/Unson-LLC/vibepro/issues/454"
reason: "alternatives considered: changed-file名による既存heuristicの強化は、specの明示的なStory/test系譜を捨てたまま誤陽性を増やすため却下。specへHEAD SHAを書き込む案はspec自身を含むcommitとの自己参照になり成立しないため却下。target HEADのGit treeにあるaccepted-spec blobを権威として同じtreeのStory/test blobへ再解決する案を採用。compatibility impact: accepted-specがないStoryは従来heuristicを維持し、mapped_tests string[]を削除せずprovenance情報を加算する。rollback plan: resolver、PR projection、専用fixture、Story/Architecture/Spec/Taskを単一commitでrevertする。boundary and scope: accepted-specのStory AC/test lineage、PR 3成果物への同一投影、負例のfail-closed、関連テストに限定し、Gateポリシー・npm公開・自動mergeは変更しない。"
created_at: 2026-08-11
updated_at: 2026-08-11
---

# accepted-specの条項系譜を同一HEADへ再解決する

## User Story

**As a** VibeProでPR readinessを判断する開発者・レビュアー
**I want** accepted-specのStory参照とtest参照がtarget HEADのGit treeへ決定的に再解決されること
**So that** ファイル名heuristicではなく、由来と検証状態を分離した証拠で条項の対応状況を判断できる

## Acceptance Criteria

- ASTR-AC-001: target HEADのartifact routing設定からcanonical pathを決定し、そのHEADのaccepted-spec blobを権威として読み、HEAD SHA・spec path・blob OIDをprovenanceに保持する。
- ASTR-AC-002: specのstory_idが対象Storyと一致し、各story_refは安定AC IDへ完全一致で解決する。
- ASTR-AC-003: test_refのfileとcaseを同一HEADの指定file blobへ完全一致で解決する。
- ASTR-AC-004: invariantのtest_patternを同一HEADのtest blobで検証し、不一致をmappedにしない。
- ASTR-AC-005: scenarioは有効なtest_refがあればtest_patternなしでもmappedにできる。
- ASTR-AC-006: 12 AC / 12 spec clause fixtureで9 invariantと3 scenarioを1対1に全件mappedへ投影する。
- ASTR-AC-007: pr-prepare.json、canonical traceability.json、pr-body.mdが同じ条項mapとprovenanceを示す。
- ASTR-AC-008: unknown AC、missing file、missing case、failed patternを理由コード付きでfail closedにする。
- ASTR-AC-009: worktree accepted-specがHEADと相違または未追跡なら理由コード付きでfail closedにする。
- ASTR-AC-010: lineage_statusとverification_statusを別軸で保持し、target HEADに一致するcomputed evidenceだけをtrustedとし、stale・self-reported・mutationありのevidenceを昇格しない。
- ASTR-AC-011: mapped_tests string[]とaccepted-specなしの旧heuristicを互換維持する。
- ASTR-AC-012: Node 22の対象・関連回帰テスト、git diff --check、AGENTS/CLAUDE一致を通す。

## 完了境界

- PR作成とmergeはGate・Review完了後に別段階で行う。
- immutable npm runtimeでの消費側再生成とnpm公開は本実装commitの外で確認する。
