---
story_id: story-vibepro-review-inspection-required-gate
title: 高リスクreviewではinspection evidenceを必須化する
view: dev
period: 2026-06
source:
  type: codex-log-audit
  id: VP-EJD-AUDIT-005
  title: "Inspection capture exists but is not enforced for high-risk review outcomes"
related_stories:
  - story-vibepro-review-inspection-first
architecture_docs:
  - ../../../architecture/vibepro-review-inspection-required-gate.md
spec_docs:
  - ../../../specs/vibepro-review-inspection-required-gate.md
status: active
created_at: 2026-06-04
updated_at: 2026-06-04
---

# 高リスクreviewではinspection evidenceを必須化する

## 背景

`story-vibepro-review-inspection-first` により、review recordはinspection summary/evidenceを記録できるようになっている。一方で同storyの非目標にもある通り、inspectionが空でもrecord自体は拒否されない。

直近ログではreview agentが実際に証跡を読んで有効な指摘を出していたが、これは運用上うまくいっただけで、VibeProが保証しているわけではない。熟練エンジニア判断をDAGにするなら、少なくとも高リスクroleやpass/block/needs_changesの根拠には読んだもの、実行したもの、見たartifactが残るべきである。

## User Story

**As a** VibeProでAgent Reviewを信頼してPR gateに使う開発者
**I want to** 高リスクreviewではinspection summary/evidenceがない結果をgate未完了として扱いたい
**So that** 実際には読んでいないpassや根拠の薄いblockをPR判断に混ぜない

## 方針

- `gate:review_inspection_required` をAgent Review Gateの前後に追加する。
- 対象role、変更route、risk surface、review outcomeに応じてinspection必須条件を決める。
- `pass` は特に厳しく扱い、high-risk変更でinspection evidenceなしのpassは `needs_inspection` にする。
- inspection evidenceにはfile path、command、artifact path、URL、query resultなどの具体refを要求する。

## 受け入れ基準

- [ ] high-risk routeのreview resultでinspection summaryが空の場合、review gateはpassしない
- [ ] high-risk routeのreview resultでinspection evidenceが空の場合、required actionに `vibepro review record --inspection-summary --inspection-evidence` が出る
- [ ] `pass` outcomeは、少なくとも関連ファイルまたは実行証跡のinspection evidenceを必要とする
- [ ] `needs_changes`/`block` outcomeも、指摘対象に対応するinspection evidenceを必要とする
- [ ] light/docs-only変更ではpolicyによりinspection必須を緩和できる
- [ ] `vibepro review status` はinspection不足をrole別に表示する
- [ ] 既存のinspection-first record formatと後方互換を保つ
- [ ] テストは、high-risk pass without inspection、high-risk pass with inspection、docs-only relaxed、block without evidenceを含む

## 非目標

- agent transcript全体を自動監査してinspection summaryを生成すること
- 人間レビューの自由裁量を完全に禁止すること
