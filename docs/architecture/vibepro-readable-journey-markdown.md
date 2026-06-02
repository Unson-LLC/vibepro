---
summary: "Readable Japanese Journey Markdown rendering for Patton-style Journey artifacts."
read_when:
  - Changing journey derive Markdown output
  - Changing Patton-style Journey Map presentation
  - Debugging Journey Map readability
---

# Readable Journey Markdown

## Architecture

The Journey JSON remains the machine-readable source of truth. The Markdown renderer is a human review surface.

The renderer is organized into two layers:

1. **Decision layer**: Japanese summary for current state, product journey flow, release slices, and next judgment.
2. **Audit layer**: Patton-style matrix, walking skeleton details, evidence bindings, conflicts, unplaced stories, and open questions.

This matches VibePro's role as an AI development control plane: humans should first understand what the Journey means, then inspect raw traceability when needed.

## Rendering Order

```text
latest-journey.json
  -> VibePro Journey header
  -> いまの結論
  -> 現在の体験フロー
  -> リリーススライス
  -> 次の判断
  -> 監査ログ: Patton式マップ
  -> 監査ログ: 証跡バインディング
```

## Design Rules

- Do not put long Story ID lists in the first decision layer.
- Do not remove traceability; move it to the audit layer.
- Translate status, release slice, evidence type, and next-action labels for the human reading surface.
- Keep existing JSON fields backward compatible so existing integrations continue to work.
- Keep `journey map` and `journey derive` using the same renderer.

## Source of Judgment

The output style follows the brainbase judgment that Keigo Sato prefers:

- simple entry before exhaustive detail,
- meaningful structure over raw lists,
- judgment axes and next actions, not only information organization,
- externalized evidence below the human decision surface.
