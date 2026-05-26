---
story_id: story-vibepro-design-system-validate
title: Design System validateでDS driftとUI regression gateを明示する
view: dev
period: 2026-05
architecture_docs:
  - ../../architecture/vibepro-design-system-validate.md
spec_docs:
  - ../../specs/vibepro-design-system-validate.md
status: active
created_at: 2026-05-26
updated_at: 2026-05-26
---

# Design System validateでDS driftとUI regression gateを明示する

## 背景

VibePro-native Design Systemは、既存コード、Graphify evidence、visual foundationsを統合してUI改善の制約を作れる。ただし、実装前にStory/Spec/Architecture文脈へ照らしてDS drift、CTA priority欠落、state semantics欠落、component role欠落、navigation/density欠落、secret混入を止める明示gateが必要。

## 受け入れ基準

- [ ] `vibepro design-system validate <repo> --id <ds-id> --story-id <story-id>` が実行できる
- [ ] `.vibepro/design-system/<ds-id>/validation/<story-id>.json` と `.md` が生成される
- [ ] VibePro-native authorityでないDSは `DS-VALIDATE-DRIFT` でblockになる
- [ ] CTA priority、state semantics、component roles、navigation/densityが明示checkになる
- [ ] Story/Spec/Architecture文脈が見つからない場合は `needs_evidence` になる
- [ ] secretらしい値がDS artifactsへ混入した場合はblockになる
- [ ] help/READMEからコマンドが発見できる
