---
story_id: story-vibepro-execute-merge-surface-sync
title: VibePro Execute Merge Surface Sync Spec
---

# 仕様

## 対象 surface

- `README.md`
- `README.ja.md`
- `skills/vibepro-workflow/SKILL.md`
- `skills/vibepro-story-refactor/SKILL.md`
- `skills/vibepro-human-review/SKILL.md`
- `node bin/vibepro.js help` が出す既存のコマンド surface

## 必須挙動

- README 英語版と日本語版は、標準フローを `pr create` で止めず `execute merge` まで表現する
- README には `vibepro execute merge <repo> --story-id <id>` の具体例を含める
- README には、監査可能性が必要な通常経路では raw `gh pr merge` を使わないことを明記する
- workflow skill は PR 作成後の次ステップとして `execute merge` を案内する
- story refactor skill は完了条件に `execute merge` を含める
- human review skill は PR 作成後に merge step が `execute merge` であることを確認対象に含める
- docs/skills の説明は、既存 CLI help の `execute merge` surface と矛盾してはいけない

## 非目標

- `execute merge` のコマンド仕様変更
- merge queue / auto-merge 追加
- CLI help 文面そのものの再設計
