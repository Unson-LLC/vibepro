---
story_id: story-vibepro-engineering-judgment-surface-evidence
title: Engineering Judgment Surface Evidence Architecture
---

# アーキテクチャ

## 判断

共通Engineering Judgment spineは、単に「何を考えるべきか」を列挙するだけでは足りない。diff surfaceごとに受け入れる証跡種別を限定し、generic test通過を高リスクsurfaceの代替にしない。

## 入力

- changed file groups / change classification risk surfaces
- Story / Spec / Architecture text
- verification evidence command, summary, kind, artifact metadata
- PR body rendering context

## 出力

`gate:common_judgment_spine.subchecks[]` にsurface-aware evidence fieldsを追加する。PR bodyは各subcheckについて、surface、required evidence kind、matched evidence、missing evidenceを短く表示する。

## 境界

このStoryは共通spineの証跡判定を深くする。route-specific gate、path surface matrix、failure mode coverage gateは引き続き別nodeとして残し、ここでは共通spineがgeneric evidenceで過剰passしないようにする。
