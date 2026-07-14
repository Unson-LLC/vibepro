---
story_id: story-vibepro-pr-body-path-links
title: GitHub PR本文のファイルパスをクリック可能にする
status: active
parent_design: vibepro-pr-body-path-links
architecture_docs:
  - docs/architecture/vibepro-pr-body-path-links.md
spec_docs:
  - docs/specs/vibepro-pr-body-path-links.md
---

# Story: GitHub PR本文のファイルパスをクリック可能にする

> `.vibepro/` の公開リンク扱いは `story-vibepro-pr-body-published-evidence-integrity` により置換された。GitHub公開用repo path allowlistに一致する相対パスをリンク化し、ローカルworkbench artifactはinline codeで表示する。formatterはfilesystem/Gitの存在確認を行わず、構造化入力の存在・追跡状態はGit差分・Story分類側が保証する。

## Background

VibeProが生成するGitHub PR本文には、Story正本、設計/Story、実装、テスト、確認証跡、詳細artifactへのリポジトリ相対パスが複数並ぶ。現状はプレーンテキストなので、レビュアーは対象ファイルへ移動するたびにパスをコピーする必要がある。

PR本文は判断ブリーフでありながら、詳細確認への入口でもある。本文内のリポジトリ相対パスはGitHub上でクリックできるMarkdownリンクとして出す。

## Acceptance Criteria

- PR本文のStory正本、設計/Story、実装、テストなどrepo path allowlistに一致する相対パスはMarkdownリンクで出力される。
- `.vibepro/pr/<story-id>/`、verification evidence、最終E2Eなどローカルworkbench artifactはinline codeで出力され、GitHubリンクにはしない。
- Next.js動的ルートのように `[` `]` を含むパスでも、Markdownリンクのラベルとhrefが壊れない。
- 外部URL、絶対パス、`Story未検出` などリポジトリ相対パスではない値はリンク化しない。
- PR本文の短い判断ブリーフ構造、Gate判定、PR作成/merge経路は変えない。

## Non-goals

- GitHub APIからowner/repo/base SHAを解決するURL生成は行わない。
- PR本文を全文artifact索引へ戻さない。
- `.vibepro` artifact生成やGate DAGロジックは変更しない。
