---
story_id: story-vibepro-e2e-acceptance-coverage-gate
title: Story受け入れ基準ごとのE2EカバレッジGate強化
view: dev
period: 2026-05
architecture_docs:
  reason: 既存のPR Gate DAG内のE2E Gate強化であり、新しいサブシステム境界を追加しないため
---

# Story受け入れ基準ごとのE2EカバレッジGate強化

## 背景

VibeProには既に `gate:e2e` があり、`vibepro pr prepare` / `vibepro pr create` のGate DAGではE2E証跡がないPRを止められる。

一方で、`vibepro check launch-readiness` のような静的診断や `.vibepro/vibepro-manifest.json` の `gate_status: pass` を完了判定のように見てしまうと、最終GateであるPR Gate DAGを通さない運用ミスが起きる。

さらに既存の `gate:e2e` は、E2E証跡やFlow Verificationが通ったかを見ていたが、Storyの各Acceptance Criteriaに対応する `tests/e2e/<story-id>-*.spec.ts` が存在し、その中で各ACを明示的にカバーしているかまでは強制していなかった。

## 方針

- `check launch-readiness` ではなく `pr prepare` / `pr create` のGate DAGを最終判定にする前提を維持する。
- 既存の `gate:e2e` を置き換えず、Story acceptance coverageを追加して強化する。
- E2E実行証跡がpassでも、StoryのAcceptance CriteriaごとのE2E spec coverageが不足していれば `gate:e2e` は `needs_evidence` にする。
- 対応ファイルは `tests/e2e/<story-id>-*.spec.ts`、`test/e2e/<story-id>-*.spec.ts`、`e2e/<story-id>-*.spec.ts` を候補にする。
- 各ACは `ac:1`、`ac-1`、`acceptance:1`、またはAcceptance Criteria本文でspec内に対応付ける。

## 受け入れ基準

- [x] E2E証跡がpassでも、StoryのAcceptance Criteriaに対応するE2E specがない場合は `gate:e2e` が `needs_evidence` になる
- [x] `gate:e2e` のJSONに `acceptance_e2e_coverage` が出力される
- [x] 不足しているAcceptance Criteriaが `missing_acceptance_criteria` として分かる
- [x] 対応するE2E specがあり、各ACが明示され、E2E証跡もpassなら `gate:e2e` が `passed` になる
- [x] E2E Gateのcritical instructionに、Story acceptance coverageが必要であることが出る
- [x] 既存の `node --test` が通る
