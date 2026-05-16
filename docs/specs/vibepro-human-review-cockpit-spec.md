---
story_id: story-vibepro-human-review-cockpit
title: VibePro Human Review Cockpit Spec
story_ref: docs/stories/vibepro-human-review-cockpit-story.md
architecture_ref: docs/architecture/vibepro-human-review-cockpit-architecture.md
---

# Spec: VibePro Human Review Cockpit

## 出力

`vibepro pr prepare` は既存成果物に加えて次を生成する。

- `.vibepro/pr/<story-id>/review-cockpit.html`
- `.vibepro/pr/<story-id>/human-review.json`

## `human-review.json`

最小構造:

```json
{
  "schema_version": "0.1.0",
  "model": "vibepro-human-review-v1",
  "story_id": "story-id",
  "status": "pending",
  "recommended_decision": "add_evidence",
  "decision_options": [],
  "review_record": {
    "selected_decision": null,
    "reviewer": null,
    "reason": null,
    "reviewed_at": null
  },
  "unresolved_gates": [],
  "execution": {
    "next_commands": []
  },
  "artifacts": {}
}
```

## 推奨判断

| decision | 条件 |
|----------|------|
| `add_evidence` | 必須Gateに未解決がある |
| `split_pr` | scope が `needs_clean_branch` または split-plan が分割推奨 |
| `proceed` | Gateが揃い、分割不要 |

選択肢として `waive_with_reason` と `block` も常に提示する。`waive_with_reason` は理由必須。

## HTML

`review-cockpit.html` は次を表示する。

- 推奨判断と理由
- 判断選択肢
- 未解決Gateと必要証跡
- PR分割方針
- Graphify調査範囲
- 次コマンド
- 参照成果物
- `human-review.json` テンプレート

次コマンドとレビューJSONはクリックでコピーできる。

## 言語設定

固定ラベルは `output.language` に従って `ja` / `en` を切り替える。JSON key、status、decision id、command は翻訳しない。
