---
story_id: story-vibepro-pre-spec-readiness-gate
title: Pre-Spec Readiness Gate
parent_design: vibepro-pre-spec-readiness-gate
architecture_docs:
  - docs/architecture/vibepro-pre-spec-readiness-gate.md
spec_docs:
  - docs/specs/vibepro-pre-spec-readiness-gate.md
---

# Story: Pre-Spec Readiness Gate

## 背景

VibeProはPR前のGate DAGと `execute merge` は強くなっている。一方で、Architecture / Specを書く前に診断、Graphify、Architecture check、Engineering Judgmentを通す順序はまだ運用ルールに寄っている。

このままだと、実装後またはPR直前に「そもそもSpecの前提が違う」と分かり、VibeProが設計補助ではなく後追い検査になる。

## 方針

Specにはdraftとfinalを分ける。draftは探索中の仮説として許可し、final specだけPre-Spec Readiness evidenceを必須にする。

Pre-Spec Readinessは既存artifactを束ねるだけで、新しい判断エンジンを増やさない。対象はStory、Graphify、Story診断、Architecture check、Engineering Judgmentである。

## 受け入れ基準

- `vibepro spec readiness . --id <story-id>` がPre-Spec Readiness artifactを生成する。
- readiness artifactはStory、Graphify、Story diagnosis、Architecture check、Engineering Judgmentの状態を含む。
- `vibepro spec write --final` はreadinessがreadyでない限り失敗する。
- `vibepro spec write --draft` はreadinessなしでもdraft artifactを書ける。
- final specは現在HEADに紐づくreadiness artifactを要求し、staleなら失敗する。
- 既存の `spec show` / `pr prepare` はfinal specだけを読む。
- Responsibility Authorityは `verify record` が出すcleanな `git_context` と `observation.values` を現在HEAD証跡として扱える。
- Responsibility Authority registryは `primary_authority.ref` 欠落または未知の `primary_authority.kind` を信頼せず、validation errorとしてfail closedする。
