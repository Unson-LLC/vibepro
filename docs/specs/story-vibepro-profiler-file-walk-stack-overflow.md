---
story_id: story-vibepro-profiler-file-walk-stack-overflow
title: diagnosis-path directory walkers iterative rewrite Spec
status: active
parent_design: story-vibepro-profiler-file-walk-stack-overflow
last_reviewed_root_hash: bd8ab55a93bddc236303c6d081ed4eee4beb31080787c9c5220180ab347f0617
---

# diagnosis-path directory walkers iterative rewrite Spec

正本のSpec artifactは `.vibepro/spec/story-vibepro-profiler-file-walk-stack-overflow/spec.json`（clauses: INV-001 / S-001 / S-002、diagrams: flow / threat_model）。本ファイルはDesign SSOTのlineage束縛用のspec pointerであり、Storyの受け入れ基準・Inherited Behaviorは
`docs/management/stories/active/story-vibepro-profiler-file-walk-stack-overflow.md` を参照する。

## Contract Summary

- INV-001: diagnosis生成パス上の8 walker（architecture-profiler / network-contract / database-access / code-quality / static-site / component-style / flow-design / gesture-interaction）は明示キュー＋単一アキュムレータで走査し、再帰・spread引数渡しを使わない。
- S-001: spread上限相当のサブツリー（--stack-size=200 × 30000 files）でも RangeError なく完走する。
- S-002: 走査契約（IGNORED_DIRS除外・1MB上限・forward-slash相対パス・flow-designのENOENT/ENOTDIR許容）は旧実装と同一。
