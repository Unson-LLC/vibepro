---
parent_design: vibepro-autonomy-roadmap-rebaseline
---

# Spec: Guarded Autonomyロードマップ再編

## Inputs

- 最新`origin/main`
- Guarded Run Session ContractとRun Context Capsuleのmerge済みaudit artifact
- 10件のGuarded Autonomy Story文書
- PR #338、#321、#331の公開状態と変更責務
- codebase-memory graphで確認したGuarded Run、review repair、decision record、content binding、Agent Reviewの所有境界

## Required artifacts

- `docs/management/stories/active/story-vibepro-autonomy-roadmap-rebaseline.md`
- `docs/architecture/vibepro-autonomy-roadmap-rebaseline.md`
- 10件のordered Story文書
- `.vibepro/config.json`への11 Story登録

## Validation

1. 10 Story IDが重複せず、順序1–10が一度ずつ現れる。
2. 完了済み2件と未完8件が区別される。
3. Story 5、6、8、10の責務境界がArchitecture記載と一致する。
4. PR #338、#321、#331の扱いがblocking/non-blockingとして明示される。
5. `story diagnose --run-graphify`とStory mapが全Storyを認識する。

## Runtime impact

なし。CLIの実行ロジック、Gate判定、waiver、merge経路は変更しない。
