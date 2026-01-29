---
name: diagnose
description: サイト種別に応じた診断をする
---

# 診断（総合）

指定したコードを分析し、サイト種別に応じた診断を実行する。

## 概要

以下の手順で診断を行う：

1. **事前分析** - コード規模・フレームワーク・規模を判定
2. **サイト種別判定** - 静的サイトか動的アプリケーションかを判定
3. **診断分岐** - 種別に応じた診断を実行

## 実行手順

### Step 1: 対象確認

```bash
ls -la target/
```

対象がなければユーザーに target ディレクトリの準備を促す。

---

### Step 2: 事前分析の実行

Task toolを使って `pre-analysis-runner` エージェント（subagent_type: `pre-analysis-runner`）を起動する。エージェント側で結果ファイルの存在チェックとスキップ判定を行う。完了を待ってから Step 3 へ進む。

---

### Step 3: サイト種別判定

`results/detect-framework.md` の「判定結果」セクションから種別を確認：

| 種別 | 次のアクション |
|------|---------------|
| **静的サイト（ビルド不要）** | → Step 4 へ進む |
| **静的サイト（ビルド必要）** | → Step 4 へ進む |
| **動的アプリケーション** | → 診断停止 |

---

### Step 4: 静的サイト診断の実行

サイト種別が「静的サイト」の場合のみ実行：

`/diagnose-static-site` を実行。

出力:
- `results/static-site-check-result.md`
- `results/deploy-plan.md`
- `results/risk-register.md`
- `results/estimate.md`
- `results/summary.md`

---

## 完了メッセージ

### 静的サイトの場合

```
診断が完了しました。

## サイト種別: 静的サイト（ビルド不要/ビルド必要）

## 事前分析結果
- results/count-lines-of-code.md（コード統計）
- results/detect-framework.md（フレームワーク検出）
- results/scale-assessment.md（規模判定）

## 静的サイト診断結果
- results/static-site-check-result.md（セキュリティチェック）
- results/deploy-plan.md（デプロイ計画）
- results/risk-register.md（リスク台帳）
- results/estimate.md（見積書）
- results/summary.md（診断サマリー）

## 次のステップ
1. summary.md で総合評価を確認
2. risk-register.md でリスク対応を検討
3. deploy-plan.md でデプロイ手順を確認
```

### 動的アプリケーションの場合

```
事前分析が完了しました。

## サイト種別: 動的アプリケーション

動的アプリケーションは現在の診断対象外です。

## 事前分析結果
- results/count-lines-of-code.md（コード統計）
- results/detect-framework.md（フレームワーク検出）
- results/scale-assessment.md（規模判定）

## 検出内容
- フレームワーク: [検出されたフレームワーク]
- 種別: 動的アプリケーション
- 理由: [サーバーサイド処理が必要な理由]

## 注意
VibePro の静的サイト診断（/diagnose-static-site）は静的サイト専用です。
動的アプリケーションの商用化支援については別途ご相談ください。
```

---

*VibePro 総合診断 (diagnose)*
