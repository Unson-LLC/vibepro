---
story_id: story-vibepro-human-review-override
title: human reviewのblock推奨を明示overrideなしで通さない
status: active
parent_design: story-vibepro-human-review-override
reason: PR作成時の黙示的なproceedや作成済みPRをmerge承認とみなす案では責任者と理由が残らないため、既存decision ledgerを共通正本にして互換追加し、policy moduleの除去でrollback可能にする。
architecture_docs:
  - docs/architecture/vibepro-human-review-override.md
spec_docs:
  - docs/specs/story-vibepro-human-review-override.md
---

# human reviewのblock推奨を明示overrideなしで通さない

## 受け入れ基準

- [ ] `split_pr`または`block`推奨では、PR作成前にoverride理由とreviewerを要求する。
- [ ] mergeでも同じpolicyを再評価し、PR作成済みを承認の代用にしない。
- [ ] overrideはcurrent HEADにboundされたaccepted decisionとして監査できる。
- [ ] `proceed`など他の推奨は既存動作を維持する。

## シナリオ

- HRO-S1: Given current lifecycleが`proceed`を推奨する、when PR作成またはmergeを評価する、then overrideなしで既存フローを継続する。
- HRO-S2: Given current HEADの推奨が`split_pr`でreviewerが欠ける、when PR作成を評価する、then override不足として停止する。
- HRO-S3: Given current HEADの推奨が`block`で古いHEADのdecisionしかない、when mergeを評価する、then stale decisionを拒否して停止する。
- HRO-S4: Given 理由、reviewer、current HEADを持つaccepted decisionがある、when PR作成またはmergeを評価する、then 両入口で同じoverrideとして認識する。
