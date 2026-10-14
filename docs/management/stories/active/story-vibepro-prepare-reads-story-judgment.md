---
story_id: story-vibepro-prepare-reads-story-judgment
title: judgment prepare が Story の見出しを判断入力に読む
status: active
contract_type: bug_fix
view: dev
period: 2026-10
---

# judgment prepare が Story の見出しを判断入力に読む

## 背景

佐藤さんの直接の指示（2026-10-14 18:24）: 書き足しは許可しない。VibeProを直して prepare が Story の枠組み・選択肢を読むようにする。

`judgment prepare` は problem_frame を uncertain に固定し、current_constraint、axes、options も固定の文言で埋めていた。Story に書いた枠組みを判断入力へ写さないため、DAG の前に JSON へ書き足す必要があった。

## Story

開発者として、Story に書いた Problem Frame、Constraints、Options などを `judgment prepare` の下書きにそのまま入れたい。

それにより、書かれた項目は下書きの problem_frame、constraints、options、current_constraint、observations、axes になり、書かれていない項目は推論されず uncertain または空のままになる。

## Acceptance Criteria

- NGJ2-AC-001: `## Problem Frame`、`## Constraints`、`## Options`、`## Current Constraint`、`## Observations`、`## Axes` の各項目を下書きの対応フィールドへ写す。
- NGJ2-AC-002: 見出しが無い、または中身が空の項目は uncertain または空のままにし、Story 本文から値を推論しない。
- NGJ2-AC-003: 不明なキー、列挙外の値、重複、標準外の axis id など不正な形式は拒否し、値を推測しない。
- NGJ2-AC-004: 見出しの形式を `docs/specs/vibepro-development-judgment-workflow.md` に書く。

## Boundary

- この Story 自体の判断 DAG は当面通さない。
- 見出し名は英語の固定文字列だけを読む。それ以外の見出しは Story 本文として無視する。
