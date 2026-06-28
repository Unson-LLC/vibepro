---
story_id: story-vibepro-architecture-readiness-gate
title: Architecture Readiness Gate
parent_design: vibepro-architecture-readiness-gate
architecture_docs:
  - docs/architecture/vibepro-architecture-readiness-gate.md
spec_docs:
  - docs/specs/vibepro-architecture-readiness-gate.md
---

# Story: Architecture Readiness Gate

## 背景

VibeProはStory、Architecture、Spec、Gate DAG、PRをつなぐ制御面である。一方で、Architectureを書く前にStory診断、Graphify、Architecture check、Engineering Judgmentを通す順序はまだ人間の運用判断に寄っている。

前回のPre-Spec Readiness Gateでfinal Specは証跡なしに昇格できなくなった。しかしArchitecture自体は、診断やEngineering Judgmentが欠けた状態でも正式文書として扱えてしまう。

このままだと、VibeProの設計思想である「権威ある設計判断は証跡に紐づける」がArchitecture段階で抜ける。

## 方針

Architectureにもdraftとfinalを分ける。draftは探索・仮説として許可し、final ArchitectureだけArchitecture Readiness evidenceを必須にする。

Architecture Readinessは新しい判断エンジンではなく、既存のStory、Graphify、Story diagnosis、Architecture check、Engineering Judgmentの証跡を束ねる昇格ゲートである。

## 受け入れ基準

- `vibepro architecture readiness . --id <story-id>` がArchitecture Readiness artifactを生成する。
- readiness artifactはStory、Graphify、Story diagnosis、Architecture check、Engineering Judgmentの状態を含む。
- `vibepro architecture write --final` はreadinessがreadyでない限り失敗する。
- `vibepro architecture write --draft` はreadinessなしでもdraft artifactを書ける。
- final Architectureは現在HEADに紐づくreadiness artifactを要求し、staleなら失敗する。
- READMEとREADME.jaにArchitecture final前の順序が明記される。
