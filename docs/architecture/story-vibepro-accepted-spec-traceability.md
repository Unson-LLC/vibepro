---
story_id: story-vibepro-accepted-spec-traceability
title: accepted-spec HEAD-tree lineageアーキテクチャ
artifact_profile: feature_packet
feature_slug: accepted-spec-traceability
---

# アーキテクチャ

## 判断

`pr prepare` のtarget HEADにあるartifact routing設定からcanonical pathを決定し、そのHEADのaccepted-spec blobを権威とする。specへHEAD SHAを埋め込む自己参照は行わない。同じGit treeのStory blobとtest blobを読み、安定AC ID、test file、test case、任意test patternを再解決する。

## 信頼境界

- canonical specのworktree内容がHEAD blobと異なる、またはHEADに存在しない場合はfail closedにする。
- `story_id` と `story_refs[].ac_id` は完全一致で解決する。legacy互換は `text_snippet` がAC IDそのものに完全一致する場合だけ許可する。
- test caseは指定test file blob内のNode test宣言名へ完全一致させる。
- invariantのtest patternはHEAD blobで満たす必要がある。scenarioはpatternを必須にしない。
- changed file名だけをaccepted-spec由来のauthoritative mappingへ昇格しない。
- verificationはruntime identityだけで信頼しない。runner/importが計算した証拠で、recorded HEAD・run前後HEAD・非mutation・非timeout・完全出力がtarget HEADへ一致した時だけverifiedへ昇格する。
- 検証ランナー自身のNode版は `process.version` から計算し、callerが上書きできないprovenanceとしてrun artifactとverification evidenceへ保存する。

## 投影

既存 `mapped_tests: string[]` を維持し、`mapped_test_provenance`、`spec_clause_ids`、`mapping_source`、`lineage_status`、`verification_status`、`reason_codes` を加える。spec全体のprovenanceとfailuresを `accepted_spec_lineage` として保持し、pr-prepare.json、traceability.json、pr-body.mdへ同じmapを渡す。

## 互換性

accepted-specがないStoryは従来のchanged-file/test heuristicを使う。accepted-specが存在するのに系譜が壊れている場合はheuristicへfallbackしない。

## rollback

resolverとprojection追加、fixtureテスト、Story/Architecture/Spec/Taskを同じcommitでrevertすれば従来挙動へ戻る。
