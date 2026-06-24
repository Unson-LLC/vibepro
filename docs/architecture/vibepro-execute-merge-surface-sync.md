---
story_id: story-vibepro-execute-merge-surface-sync
title: VibePro Execute Merge Surface Sync Architecture
---

# 設計

この Story は runtime 実装を変えず、`execute merge` を VibePro の標準 shipping path として文書 surface に揃える変更である。責務は「既存 capability を README / skills から再構成できるようにすること」であり、merge command 自体の意味や gate は変えない。

## 境界

- CLI help は既存の source of truth として維持する
- README は人間向けの一次導線として、`pr create` 後に `execute merge` が続くことを示す
- skills は運用ガードレールとして、raw `gh pr merge` ではなく `vibepro execute merge` を標準経路にする

## 不変条件

- `execute merge` のコマンド surface は変えない
- `gh pr merge` を禁止するのではなく、「監査可能性が必要な通常経路では VibePro を使う」という方針として表現する
- README / skills は help 出力と矛盾しない

## 非目標

- 新しい CLI オプション追加
- merge artifact schema の変更
- review / verification gate の変更
