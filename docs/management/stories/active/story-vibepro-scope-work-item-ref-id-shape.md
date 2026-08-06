---
story_id: story-vibepro-scope-work-item-ref-id-shape
title: Scope分類のwork-item参照抽出をid形状で判定する
status: active
view: dev
period: 2026-08
category: platform
source:
  type: operator_feedback
  title: "commit messageの「Story-local」がforeign work item扱いされ、atomic scopeがunsafe判定になった"
related_stories:
  - story-vibepro-content-scoped-evidence-reuse-key
  - story-vibepro-atomic-scope-review-contract
reason: "alternatives considered: (a) require every extracted ref to resolve to a docs/management/stories file, (b) denylist known English adjectives after `story-`, (c) require the token to be shaped like a work-item id. (a) was rejected because it fails open exactly where the Gate matters -- cross-repo Stories, deleted/renamed Stories, and the spoofed-versioned-merge fixtures all reference ids that exist on no local path, and the existing spoofing tests depend on those staying flagged. (b) was rejected as an unbounded lexical denylist. (c) selected: a reference must be a standalone, id-shaped token. compatibility impact: additive narrowing of extraction only; signal ids, field names, and the str/bfd/bug/inc numeric family are unchanged, and the >1-commit `multiple_commits_scope_contamination_risk` signal still fires so scope still reports needs_clean_branch. rollback plan: revert this commit and rerun pr prepare. boundary and scope: src/pr-manager.js extractCommitWorkItemRefs plus its three assessScope call sites; no runtime, storage, or CLI surface change. accepted followups: 3+-segment source-module names in ASCII prose (src/story-catalog-generator.js) are still extracted; excluding them would require a file-extension rule that would also drop genuine story-doc path references, so they are left fail-closed."
created_at: 2026-08-06
updated_at: 2026-08-06
---

# Scope分類のwork-item参照抽出をid形状で判定する

## User Story

**As a** VibeProでPR準備とatomic scope判定を行うユーザー
**I want** commit messageの `story-` 参照が、Story実体への参照である時だけwork-item参照として抽出される
**So that** 散文中の英語形容詞やソースファイル名がforeign lineageとして誤検出され、atomic scopeがunsafe判定へ落ちない

## Background

`extractCommitWorkItemRefs` は lowercase 済みの commit message に対して `/\bstory-[a-z0-9][a-z0-9-]*/g` を当てていた。この正規表現は `story-` の後ろに1文字以上の英数字が続けば何でも一致するため、Story実体を指していない `story-<word>` 複合語をすべてwork-item idとして抽出していた。

`assessScope` は抽出結果のうち current Story id（および `-v\d+` 系の versioned lineage）以外をforeign work itemとして扱い、`multiple_commits_foreign_story_lineage` を `unsafe_for_atomic_override: true` で立てる。したがって誤抽出はそのままatomic scope拒否に直結していた。

実測（直近3000 commit）では、以下がすべて誤抽出されていた。

- 散文中の英語形容詞: `Story-local`、`Story-scoped`、`Story-level`（例: `レビュー予算のStory-local増枠`）
- ワークフロー語: `Story-Architecture-Spec`
- ソースモジュール名: `src/story-manager.js`
- placeholder / フィールド名: `<story-id>`、`story-kind`
- サブコマンド名: `story-derive`、`story-split`、`story-refactor`
- test glob の切れ端: `story-vibepro-vacuous-e2e-test-elimination-*.spec.ts`

実害として `story-vibepro-content-scoped-evidence-reuse-key` の `pr-prepare.json` / `split-plan.json` / `human-review.json` / `gate-dag.json` / `senior-gap-judgment.json` が「別work item story-local のlineageが含まれている」を根拠に `needs_clean_branch` / `split_recommended` を出し、`axis:scope_reviewability` の judgment-DAG が premise_correction サイクルを1周する原因になった。

## Acceptance Criteria

- `story-` トークンは、前後がUnicode文字・数字・`_`・`-` に接していない独立トークンである時だけwork-item参照として抽出される。
- `story-` トークンは、空セグメントと末尾ハイフンを持たない `story-<seg>-<seg>...` 形状である時だけwork-item参照として抽出される。
- 要求される最小セグメント数は慣習値3を上限として current Story id 自身のセグメント数から導出し、短いid規約のrepoでforeign参照が取りこぼされない。
- ディスク上にStory文書が存在しないidでも、id形状を満たす限りforeign lineageとして検出され続ける（cross-repo / 削除済みStory / spoofed versioned merge がfail-closedのまま）。
- `str`/`bfd`/`bug`/`inc` の数値系work-item参照の抽出は変更しない。
- foreign参照が消えても、commitが2件以上ある限り `multiple_commits_scope_contamination_risk` は立ち続ける。

## Non-goals

- 抽出結果をStory registry（`docs/management/stories/` や `.vibepro/config.json`）の存在チェックで絞り込まない。fail-openになるため。
- ASCII文脈に現れる3セグメント以上のソースモジュール名（`src/story-catalog-generator.js` 等）の除外は行わない。ファイル拡張子による除外は、Story文書パス参照という正当な参照も落とすため。
