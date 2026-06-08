---
story_id: story-vibepro-execute-merge-surface-sync
title: execute merge を README と skills に反映する
status: active
reason: 既存の execute merge capability を README と skill surface に同期する文書変更であり、runtime 境界や CLI surface 自体は変更しないため新規 ADR は不要。
architecture_docs:
  - ../../../architecture/vibepro-execute-merge-surface-sync.md
spec_docs:
  - ../../../specs/vibepro-execute-merge-surface-sync.md
---

# execute merge を README と skills に反映する

## 背景

`vibepro execute merge` は CLI help と実装には存在するが、README と主要 skills の運用説明が `pr create` で止まっている。これでは VibePro の標準経路が docs と skill surface から再構成できない。

## 目的

人間とエージェントの両方が、PR 作成後の標準 merge 経路として `vibepro execute merge` を参照できるようにする。

## 受け入れ基準

- README 英語版に `pr create -> execute merge` の標準フローが明記される
- README 日本語版に `pr create -> execute merge` の標準フローが明記される
- README の PR 作成後の手順に `vibepro execute merge` の例が追加される
- README に通常経路として直接 `gh pr merge` を使わない方針が明記される
- `skills/vibepro-workflow/SKILL.md` に PR 作成後の `execute merge` が標準経路として追加される
- `skills/vibepro-story-refactor/SKILL.md` に ship 完了条件として `execute merge` が追加される
- `skills/vibepro-human-review/SKILL.md` に merge 直前の確認項目として `execute merge` が追加される
- `node bin/vibepro.js help` のコマンド surface と README / skills の説明が矛盾しない
