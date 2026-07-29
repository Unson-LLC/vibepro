---
story_id: story-vibepro-release-0-2-0-beta-2
title: 0.2.0-beta.2 を npm へ出荷する
status: active
view: dev
period: 2026-07
category: release
source:
  type: operator_feedback
  title: "runner-direct evidence (PR #395) を含む #356〜#395 の約20PR分が npm 未公開のまま main に滞留している"
reason: "alternatives considered: (a) 次の機能Storyに bump を同乗させて待つ — Unreleased に breaking な入力契約の絞り込みが2件含まれており、npm 利用者への開示が機能開発の都合で遅れるのは不当。(b) npm-publish workflow を手動 dispatch — 現行 version 0.2.0-beta.1 は公開済みのため必ず失敗し、bump なしの公開経路は存在しない。(c) version bump + CHANGELOG 移動だけの最小リリースPRを切る — これを採用。post-merge 自動リリース (PR #349) の設計どおり、semver が上がった PR の merge が公開のトリガーになる。compatibility impact: パッケージ内容のコードは main と同一で、変更は version 文字列と CHANGELOG のみ。npm 利用者にとっては beta.1 以降の全変更（verify run 追加、--observed 26キー拒否という breaking、読み取り時分類の狭まり、typecheck の全ファイル検査化）が初めて届くリリースであり、それらの開示は CHANGELOG 0.2.0-beta.2 節に列挙した。rollback plan: npm publish 後の取り消しは deprecate で行う（unpublish は 72時間制約と下流破壊のため使わない）。merge 前なら PR を閉じるだけで公開は起きない。boundary and scope: version 文字列と CHANGELOG の節移動・追記のみ。コード・テスト・依存の変更は含まない。"
created_at: 2026-07-29
updated_at: 2026-07-29
---

# 0.2.0-beta.2 を npm へ出荷する

## Background

PR #349 の継続的リリース設計では、merge された PR が package.json の semver を上げて
いる場合にのみ post-merge workflow が npm publish と GitHub Release を実行する。
PR #395（runner-direct evidence）を含む #356〜#395 は version を上げていないため、
npm は 0.2.0-beta.1（7月18日）のまま止まっている。Unreleased には npm 利用者に
影響する breaking な入力契約の絞り込みが含まれており、公開が必要。

## User Story

**As a** vibepro を npm から利用する開発者
**I want** main に merge 済みの変更が version 付きで npm に公開されてほしい
**So that** breaking change の開示と新機能（verify run）を install で受け取れる

## Acceptance Criteria

- [ ] REL-1: package.json の version が 0.2.0-beta.2 になっている。
- [ ] REL-2: CHANGELOG に `## 0.2.0-beta.2 - 2026-07-29` 節があり、beta.1 以降の
      利用者影響（verify run 追加、--observed の26キー拒否、読み取り時分類の狭まり、
      typecheck の全ファイル検査化、validation sequencing、content-surface binding、
      task-scoped acceptance）が列挙されている。Unreleased 節は空で残る。
- [ ] REL-3: 本PRの変更は package.json の version 文字列と CHANGELOG と本Story文書
      （および catalog 登録）のみで、src / test / bin / 依存の変更を含まない。

## Non Goals

- npm publish の手動実行。公開は post-merge workflow の責務。
- beta.1 以降の個別変更の再説明。正本は各Storyと docs/releases。
