# 静的サイト一括診断

`target/` 内の静的サイトに対して、セキュリティチェック・デプロイ計画・リスク台帳・見積もり作成を一括で実行する。

## 概要

以下の5つの診断を順番に実行し、結果をまとめる：

1. **静的サイトチェック** → `results/static-site-check-result.md`
2. **Cloudflare Pages デプロイ計画** → `results/deploy-plan.md`
3. **リスク台帳作成** → `results/risk-register.md`
4. **見積もり作成** → `results/estimate.md`
5. **診断サマリー** → `results/summary.md`

## 実行手順

### Step 1: 静的サイトチェック

[../static-site-check/SKILL.md](../static-site-check/SKILL.md) の内容を実行：

1. `target/` ディレクトリの構成確認
2. セキュリティチェック
   - 秘密情報混入チェック（APIキー、トークン等）
   - XSS脆弱性チェック（innerHTML、eval等）
   - 外部リソースチェック（CDN、サードパーティJS）
3. npm脆弱性チェック（package.jsonがある場合）
4. 結果を `results/static-site-check-result.md` に出力

### Step 2: Cloudflare Pages デプロイ計画

[../../commands/cloudflare-pages-deploy/SKILL.md](../../commands/cloudflare-pages-deploy/SKILL.md) の内容を実行：

1. フレームワーク検出
2. ビルド設定確認
3. デプロイ手順の作成
4. 結果を `results/deploy-plan.md` に出力

### Step 3: リスク台帳作成

[../risk-register/SKILL.md](../risk-register/SKILL.md) の内容を実行：

1. Step 1, 2 の結果からリスクを抽出
2. 深刻度を判定（Critical/High/Medium/Low）
3. お客様向け表現に変換
4. 結果を `results/risk-register.md` に出力

### Step 4: 見積もり作成

[../estimate/SKILL.md](../estimate/SKILL.md) の内容を実行：

1. リスク台帳からリスク件数・深刻度を取得
2. 規模を判定（ライト/スタンダード/エンタープライズ）
3. 価格マトリクスに基づいて費用を算出
4. 結果を `results/estimate.md` に出力

### Step 5: 診断サマリー作成

[references/summary-template.md](references/summary-template.md) の形式で `results/summary.md` を出力：

- 総合評価
- 検出リスク件数
- 見積もり概要
- 各診断結果へのリンク
- 推奨アクション

## チェック項目一覧

### セキュリティ

| チェック項目 | 検出パターン |
|--------------|--------------|
| 秘密情報混入 | `api[_-]?key`, `sk-`, `.env` 等 |
| XSS脆弱性 | `innerHTML=`, `eval(`, `document.write(` |
| 外部リソース | `<script src="https://`, `<link href="https://` |
| npm脆弱性 | `npm audit` / `pnpm audit` |

### 構成

| チェック項目 | 内容 |
|--------------|------|
| index.html | ルートに存在するか |
| 静的ファイルのみ | .php, .py 等がないか |
| 配信不要ファイル | node_modules, .env 等 |

## 出力ファイル

| ファイル | 内容 |
|----------|------|
| `results/static-site-check-result.md` | セキュリティ・構成チェック結果 |
| `results/deploy-plan.md` | Cloudflare Pages デプロイ手順 |
| `results/risk-register.md` | お客様提出用リスク台帳 |
| `results/estimate.md` | お客様提出用見積書 |
| `results/summary.md` | 診断サマリー |

## 完了時の出力

```
一括診断が完了しました。

## 総合評価: [商用化可 / 条件付き商用化可 / 商用化不可]

## 検出リスク
- Critical: X件
- High: X件
- Medium: X件
- Low: X件

## 見積もり概要
- 判定規模: [ライト / スタンダード / エンタープライズ]
- 診断費用（実施済み）: ¥XXX,XXX
- 商用化費用: ¥XXX,XXX
- 運用保守（月額）: ¥XXX,XXX

## 生成されたファイル
- results/static-site-check-result.md（セキュリティチェック）
- results/deploy-plan.md（デプロイ計画）
- results/risk-register.md（リスク台帳）
- results/estimate.md（見積書）
- results/summary.md（診断サマリー）

## 次のステップ
1. 見積書（estimate.md）の内容を確認
2. リスク台帳（risk-register.md）の内容を確認
3. 対応優先度に従って問題を修正
4. デプロイ計画（deploy-plan.md）に従ってデプロイ
```
