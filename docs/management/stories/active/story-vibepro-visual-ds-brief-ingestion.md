---
story_id: story-vibepro-visual-ds-brief-ingestion
title: Visual DS briefをVibePro-native DSへ取り込む
status: active
github_issue: 80
architecture_docs:
  - ../../../architecture/vibepro-visual-ds-brief-ingestion.md
specs:
  - ../../../specs/vibepro-visual-ds-brief-ingestion.md
---

# Visual DS briefをVibePro-native DSへ取り込む

## 背景

VibePro-native Design Systemは既存コード、Graphify evidence、route evidence、component responsibilityを正本化できる。一方で、外部で作ったvisual DS briefの色、密度、typography、component feel、composition、native CTA languageは手作業でコピーする必要がある。

## 目的

外部visual DS briefを、実装権限を持たない参照情報としてVibePro-native DSに取り込む。current code、graph evidence、implementation mapping、Gate DAGが実装判断の正であることは維持する。

## 受け入れ基準

- `vibepro design-system derive --brief-file <path>` が `visual-foundations.json` と `visual-foundations.md` を生成する
- `vibepro design-system ingest-brief --id <ds-id> --brief-file <path>` が既存native DSへvisual foundationsを追記する
- `design-system.json` と `design-system.md` がvisual foundationsの参照とauthority boundaryを含む
- `design-modernize plan` がVibePro-native DS bundle内のvisual foundationsを参照できる
- VibePro-native DSをreference bundleとして渡してもtoken/component summaryが0にならない
- CTA抽出ノイズがnative CTA policyへ昇格しない
