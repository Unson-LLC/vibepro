---
story_id: story-vibepro-check-packs
title: "VibePro診断パッケージCLI"
source:
  type: product-feedback
  id: VP-CHECK-001
  title: "ユーザー目的別に何を診断するかを明示する"
architecture_docs:
  - ../../architecture/vibepro-check-packs-architecture.md
spec_docs:
  - ../../specs/vibepro-check-packs.md
status: active
created_at: 2026-05-16
updated_at: 2026-05-16
---

# Story: VibePro診断パッケージCLI

## User Story

**As a** VibeProに「UIを見て」「セキュリティを見て」「リリースできるか見て」と依頼するユーザー
**I want to** 目的別の診断パッケージをCLIから明示実行できる
**So that** scanner名や内部実装を知らなくても、何を確認したのか、何が未達なのかを理解できる

## Background

VibeProにはUI、パフォーマンス、セキュリティ、Architecture、PR readinessなど複数の診断器がある。一方で、ユーザーが「VibeProで見て」と言った時に、どの診断が走るのか、どの証跡が出るのかが分かりにくかった。

診断器の名前ではなく、ユーザーの目的語に対応するパッケージとして `vibepro check <pack>` を提供する。

## Acceptance Criteria

- [ ] `vibepro check list` で利用可能な診断パッケージを確認できる
- [ ] `vibepro check ui <repo>` でUI体験関連の診断を実行できる
- [ ] `vibepro check security <repo>` でセキュリティ境界関連の診断を実行できる
- [ ] `vibepro check performance <repo>` でパフォーマンス準備関連の診断を実行できる
- [ ] `vibepro check pr-readiness <repo> --base <ref>` でPR準備Gateを目的別checkとして実行できる
- [ ] check結果は `.vibepro/checks/<pack>/<run-id>/check.json` と `check.md` に残る
- [ ] check結果は `pass / needs_review / needs_setup / fail` のいずれかで集約される

## Implementation Notes

- 対象: `src/check-packs.js`, `src/cli.js`
- 既存の `diagnose` は全体診断として維持する
- `check` はユーザー目的別の薄い編成レイヤーにする
