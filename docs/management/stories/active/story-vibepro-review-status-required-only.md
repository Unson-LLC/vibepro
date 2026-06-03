---
story_id: story-vibepro-review-status-required-only
title: "review statusを必須レビュー中心にしてAgent Review Gateの摩擦を下げる"
source:
  type: local-analysis
  id: VP-VALUE-004
  title: "review statusが古いroleやoptional roleも見せ、blocking理由が分かりにくい"
architecture_docs:
  - docs/architecture/vibepro-agent-review-lifecycle-control.md
spec_docs:
  - docs/specs/vibepro-agent-review-lifecycle-control.md
status: active
created_at: 2026-06-02
updated_at: 2026-06-02
---

# Story: review statusを必須レビュー中心にしてAgent Review Gateの摩擦を下げる

## ユーザーストーリー

- ユーザー: VibeProのAgent Review Gateを解消する人
- したいこと: `vibepro review status` で、今PR作成を止めている必須roleだけをまず見たい
- 目的: optional、古いstage、履歴上のroleに引きずられて、何を解消すればPRへ進めるのか分からなくなることを防ぐ

## 背景

Agent Review GateはVibeProの価値が高い領域だが、status出力が広すぎると運用負荷になる。ログ上でも、実際に `pr prepare` が要求しているroleと、`review status` で目立つroleがずれて見える場面があった。

## 受け入れ基準

- [x] `vibepro review status` のデフォルト出力はrequired/current blocking roleを先頭に出す
- [x] optional role、過去round、置換済みlifecycle、古いstageは `--all` または `--history` で表示する
- [x] JSONには `required_current`, `optional`, `history`, `blocking_summary` を分けて出す
- [x] `pr prepare` が要求しているAgent Review roleと `review status` のblocking summaryが一致する
- [x] timed_out / replaced / closed / stale の理由を、PR作成を止めるものと監査履歴だけのものに分ける
- [x] 出力の先頭に次に実行すべき `review prepare` / `review record` / `pr prepare` コマンドを1-3件で表示する

## 実装メモ

- 対象候補: `src/agent-review.js`, `src/pr-manager.js`, `test/vibepro-cli.test.js`
- 既存のlifecycle制御は維持し、表示とsummaryの責務を整理する
- Gate判定ロジックはPR側の正本を使い、review status側で別の合否判定を作らない
