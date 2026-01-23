# リスク台帳作成

診断結果ファイル（`results/*.md`）をもとに、お客様提出用のリスク台帳を作成する。

## 入力

- `results/` ディレクトリ内の診断結果ファイル
  - `static-site-check-result.md`
  - `security.md`
  - `code-quality.md`
  - `architecture.md`
  - `operations.md`
  - その他診断結果

## 出力

- `results/risk-register.md` - お客様提出用リスク台帳

## 作成手順

1. `results/` 内の診断結果ファイルを読み込む
2. 検出された問題を抽出し、リスクとして整理
3. [references/template.md](references/template.md) の形式でリスク台帳を作成
4. [references/severity-guide.md](references/severity-guide.md) を参照して深刻度を判定
5. 結果を `results/risk-register.md` に保存

## リスク抽出ルール

診断結果から以下のパターンでリスクを抽出:

| 診断結果の記載 | リスクカテゴリ |
|----------------|----------------|
| 秘密情報検出 | セキュリティ |
| XSS脆弱性 | セキュリティ |
| npm脆弱性（high/critical） | セキュリティ |
| npm脆弱性（medium以下） | 技術的負債 |
| 外部リソース依存 | 可用性 |
| アーキテクチャ課題 | 保守性 |
| テスト不足 | 品質 |
| 監視未設定 | 運用 |

## 深刻度判定基準

| 深刻度 | 基準 |
|--------|------|
| Critical | 即時対応必須。情報漏洩・サービス停止に直結 |
| High | 商用化前に対応必須。重大なセキュリティリスク |
| Medium | 商用化後でも可。改善推奨 |
| Low | 対応任意。ベストプラクティス観点 |

## お客様向け表現ガイド

技術用語をビジネス観点に変換:

| 技術表現 | お客様向け表現 |
|----------|----------------|
| XSS脆弱性 | 悪意あるスクリプト実行のリスク |
| innerHTML | 動的HTML挿入処理 |
| npm脆弱性 | 利用ライブラリの既知の問題 |
| DoS攻撃 | サービス停止攻撃 |
| サニタイズ | 入力値の無害化処理 |

## 出力形式

[references/template.md](references/template.md) を参照。

## 完了時の出力

```
リスク台帳を作成しました: results/risk-register.md
- 検出リスク数: X件
- Critical: X件 / High: X件 / Medium: X件 / Low: X件
```
