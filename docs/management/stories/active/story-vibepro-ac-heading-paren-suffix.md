---
story_id: story-vibepro-ac-heading-paren-suffix
title: 受入条件見出しの括弧サフィックスを認識する
status: active
view: dev
period: 2026-10
started_at: 2026-10-17
owner_repository: vibepro
spec_docs:
  - .vibepro/spec/story-vibepro-ac-heading-paren-suffix/spec.json
---

# 受入条件見出しの括弧サフィックスを認識する

## Storyと利用者成果

Markdown の受入条件見出しは、見出し語の直後に全角の `（…）` または ASCII の `(…)` が一つ続いても認識される。括弧の無い従来の見出しは、これまで通り認識される。既存 Story の受入条件の件数は、T4 と T3 以外では変わらない。

## 受入条件

- AC-1: 見出し語の直後に全角 `（…）` または ASCII `(…)` が一つ続く受入条件見出しを認識する。
- AC-2: 括弧の無い従来の受入条件見出しは、これまで通り認識する。
- AC-3: 既存 Story markdown の受入条件件数は変わらない。件数が変わるのは T4 `story-vibepro-task-plan-decomposer` と T3 `story-vibepro-task-plan-overlap-refs` だけで、それぞれ 0 件から 4 件になる。

## 対象外

- T4 と T3 の spec.json の改訂
- 括弧が二つ、入れ子、全角と半角の混在、`受入条件外（x）` のように見出し語が延びた行を受入条件見出しとして認めること
