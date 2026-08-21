---
story_id: story-vibepro-public-doc-contract-ci-repair
title: 公開説明文の意図を保ったまま、旧文言に固定されたCI契約を修復する
status: active
created_at: 2026-08-20
updated_at: 2026-08-20
artifact_profile: feature_packet
feature_slug: public-doc-contract-ci-repair
reason: >-
  代替案は (a) #476以前の公開文言へ戻す、(b) 現在の文言を旧テスト文字列へ寄せる、
  (c) #476で決定したプロダクト意図・人間の権限境界・最小コア境界を意味単位で検証するよう
  テスト契約を更新する、の3案。(c)を採用する。(a)(b)は公開設計を後退させる。
  compatibility impact: CLI、保存形式、公開API、実行時動作は変更せず、公開文書の契約テストだけを
  現行設計へ同期する。rollback plan: Story、Spec、対象テストの1コミットをrevertする。
  boundary and scope: #476後にmain CIで失敗している3 assertionと、それが検証する英日公開文書の
  意味境界に限定する。#477のJudgment DAG実装や公開文書本文は変更しない。
---

# 公開説明文とCI契約を同期する

## 背景

#476でVibeProの公開説明は「AI開発の文脈」から「プロダクト意図と実装のずれを追跡する」設計へ更新された。
一方、公開文書の契約テスト3件は旧文章の一部を完全一致で要求したままで、#476および後続の#477を含む
`main` のCIが失敗している。

## ユーザー価値

公開設計の改善を維持しながら、CIが文言の偶然ではなく、VibeProの現在の責務境界を検証する状態へ戻る。

## 受け入れ条件

- [x] DOC-CI-AC-001: 英語トップページの契約テストは、プロダクト意図からPR引き渡しまでの追跡可能性と、人間の判断・merge権限を検証する。 <!-- ac:DOC-CI-AC-001 -->
- [x] DOC-CI-AC-002: 英日READMEの契約テストは、現行最小コアと、旧Gate DAG等が削除済みである境界を検証する。 <!-- ac:DOC-CI-AC-002 -->
- [ ] DOC-CI-AC-003: 対象3テストおよび全テストスイートが成功し、#476で導入された公開説明文を戻さない。 <!-- ac:DOC-CI-AC-003 -->

## 対象外

- #477のDevelopment Judgment DAG実装、保存形式、CLI契約の変更
- README、公開マニュアル、プロダクト思想文書の再設計
- CI基盤やNode.jsマトリクスの変更
