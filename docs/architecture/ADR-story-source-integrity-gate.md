---
story_id: story-story-source-integrity-gate
spec_ref: docs/specs/story-source-integrity-gate.md
---

# ADR: Story Source Integrity Gate

## Context

PR evidenceの価値は、Story、Spec、Architecture、差分、検証結果が同じ変更意図を指していることに依存する。
単一の変更Story文書を無条件で正本化すると、別Storyの背景や受け入れ基準がPR本文へ混入し、VibeProが「もっともらしいが信用できない証跡」を生成する。

## Decision

`pr prepare` のGate DAGに `gate:story_source_integrity` を追加し、Story Gateの直後に配置する。
このgateは、選択Storyと解決済みStory source、変更されたStory文書群の対応を検査する。
不一致があればPR作成をcriticalに止め、対象文書を別PRへ分けるか、Story frontmatterを明示的に修正するよう要求する。

## Consequences

この判断により、Story sourceが曖昧な変更はPR作成前に止まる。
一方で既存の `STR-001-foo.md` 形式をすべて壊さないため、slug正規化で `story-foo` との対応を許可する。

