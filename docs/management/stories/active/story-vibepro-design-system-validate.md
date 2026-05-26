---
story_id: story-vibepro-design-system-validate
title: Design System validation gateを追加する
status: active
github_issue: 85
architecture_docs:
  - ../../../architecture/vibepro-design-system-validate.md
specs:
  - ../../../specs/vibepro-design-system-validate.md
---

# Design System validation gateを追加する

## 背景

VibePro-native DSは生成できるようになったが、StoryごとのUI/UX変更がDS drift、CTA優先度の退行、状態semanticsの退行、component role driftを起こしていないかを明示的に検証するコマンドがない。

## 目的

`vibepro design-system validate` を追加し、native DSとStory/Spec/Architecture文脈を照合したGate証跡を作る。DS artifact内のsecret混入も検出し、UI/UX変更時にPR Gateへ接続できる形にする。

## 受け入れ基準

- `vibepro design-system validate <repo> --id <ds-id> --story-id <story-id>` が実行できる
- `.vibepro/design-system/<ds-id>/validation/<story-id>.json` と `.md` が生成される
- validation finding が `pass` / `needs_evidence` / `needs_review` / `block` を区別する
- DS drift、CTA priority regression、state semantics regression、component role drift、navigation/density policy driftを検査する
- DS artifact内のsecret-like valueを検出した場合は `block` になる
- CLI helpとREADMEで発見できる
