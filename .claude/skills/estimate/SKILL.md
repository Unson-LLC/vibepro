---
name: estimate
description: 診断結果ファイル（results/*.md）をもとに、お客様提出用の見積書を作成する。規模判定（ライト/スタンダード/エンタープライズ）と価格算出を行い、診断・商用化・運用保守の費用を提示。
---

# 見積もり作成

診断結果ファイル（`results/*.md`）をもとに、お客様提出用の見積書を作成する。

## 入力

- `results/` ディレクトリ内の診断結果ファイル
  - `*-site-check-result.md`
  - `deploy-plan.md`
  - `risk-register.md`

## 出力

- `results/estimate.md` - お客様提出用見積書

## 作成手順

1. `results/` 内の診断結果ファイルを読み込む
2. `results/risk-register.md` からリスク件数・深刻度を取得
3. 規模を判定（ライト/スタンダード/エンタープライズ）
4. [references/pricing.md](references/pricing.md) を参照して価格を決定
5. [references/template.md](references/template.md) の形式で見積書を作成
6. 結果を `results/estimate.md` に保存

## 規模判定・価格

[references/pricing.md](references/pricing.md) を参照。

- 規模判定基準（リスク件数、外部連携、認証機能）
- フェーズ別価格表（診断・商用化・MRR）
- リスク対応工数の目安
- オプション・割引条件

## 出力形式

[references/template.md](references/template.md) を参照。

## 完了時の出力

```
見積書を作成しました: results/estimate.md
- 判定規模: [ライト / スタンダード / エンタープライズ]
- 診断費用（実施済み）: ¥XXX,XXX
- 商用化費用: ¥XXX,XXX
- 運用保守（月額）: ¥XXX,XXX
- 初期費用合計: ¥XXX,XXX
```
