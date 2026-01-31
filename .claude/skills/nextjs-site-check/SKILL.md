---
name: nextjs-site-check
description: Next.js ウェブアプリ（App Router）の公開前セキュリティチェック。Next.js + Supabase + better-auth 構成のアプリケーションを対象とし、セキュリティ・構成・認証設定を診断。
---

# Next.js アプリ公開チェック

Next.js（App Router）ウェブアプリの公開前セキュリティチェックを実行し、点数制で結果を報告する。
**チェックのみ行い、コードの修正は行わない。**

## 対象範囲

- Next.js（App Router）アプリケーション
- 想定技術スタック: Next.js / React / TypeScript / Supabase / better-auth
- Server Components / API Routes を含むフルスタックアプリ

## チェック手順

1. [references/checklist.md](references/checklist.md) を読み込む
2. 各カテゴリのリファレンスを参照し、検出パターンに基づいて検査
3. 検出された問題に応じて減点を計算
4. 評価軸ごとのスコアを算出
5. 総合判定を決定
6. 結果を `results/nextjs-site-check-result.md` に保存

## 出力形式

**出力ファイル: `results/nextjs-site-check-result.md`**（1ファイルのみ）

```markdown
# Next.js アプリ診断結果

診断日時: YYYY-MM-DD HH:MM
対象: [対象ディレクトリパス]

---

## スコアサマリー

| 評価軸 | スコア | 判定 |
|--------|--------|------|
| セキュリティ | XX/100 | A/B/C/D |
| 設定品質 | XX/100 | A/B/C/D |
| **総合** | **XX/100** | **A/B/C/D** |

## カテゴリ別スコア

### セキュリティ

| カテゴリ | 深刻度 | スコア | 状態 |
|----------|--------|--------|------|
| 環境変数管理 | Critical | XX/20 | OK/NG |
| Server Components秘密漏洩 | Critical | XX/15 | OK/NG |
| Supabase RLS | Critical | XX/20 | OK/NG/要確認 |
| SQLインジェクション | Critical | XX/15 | OK/NG |
| API Routes認証 | High | XX/15 | OK/NG |
| better-auth実装 | High | XX/10 | OK/NG |
| XSS対策 | High | XX/5 | OK/NG |

### 設定品質

| カテゴリ | 深刻度 | スコア | 状態 |
|----------|--------|--------|------|
| npm脆弱性 | Medium〜Critical | XX/40 | OK/NG |
| TypeScript設定 | Medium | XX/30 | OK/NG |
| next.config設定 | Medium | XX/30 | OK/NG |

## 要改善項目

（スコア80%未満のカテゴリのみ詳細記載）

### [カテゴリ名]（XX/YY点）

**減点項目:**
- 項目名: -N点
  - 検出: 具体的な問題箇所

## 手動確認が必要な項目

- [ ] Supabase RLS ポリシー: 全テーブルで RLS 有効か確認
- [ ] ...

---

## 判定基準

- A (90-100): 商用リリース可能
- B (70-89): 軽微な修正で商用化可能
- C (50-69): 重要な修正が必要
- D (0-49): 根本的な見直しが必要
```

## 完了時の出力

チェック完了後、以下のメッセージを表示:

```
診断が完了しました。
結果: results/nextjs-site-check-result.md
```
