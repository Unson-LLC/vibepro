# 環境変数セキュリティチェック

Next.js アプリケーションにおける環境変数の安全な管理を確認・報告する。

## 深刻度: Critical

## 出力先: `results/nextjs-check-env-variables.md`

環境変数の漏洩は、APIキー不正利用・データベース侵害・課金被害に直結する最重要チェック項目。

## 検出パターン

```
# クライアント公開変数に秘密情報（Next.js は NEXT_PUBLIC_ のみ対象）
NEXT_PUBLIC_.*(SECRET|KEY|TOKEN|PASSWORD|PRIVATE|CREDENTIAL)

# .envファイル
\.env$|\.env\.|\.env\.local|\.env\.production

# ハードコード認証情報
(api[_-]?key|api[_-]?secret|access[_-]?token|auth[_-]?token)\s*[:=]\s*['"][^'"]+['"]
sk-[a-zA-Z0-9]{20,}
(password|secret)\s*[:=]\s*['"][^'"]+['"]
```

## リスク

- **APIキー漏洩**: 不正利用による課金、サービス停止
- **データベース認証情報漏洩**: データ侵害、改ざん
- **秘密鍵漏洩**: なりすまし、署名偽造
- **Git履歴に残ると削除困難**: 一度コミットすると完全削除が難しい

## チェック項目

### 1. NEXT_PUBLIC_ 変数の確認

**検出対象**:
- `NEXT_PUBLIC_` で始まる変数名に SECRET/KEY/TOKEN/PASSWORD/PRIVATE を含む
- 例: `NEXT_PUBLIC_API_SECRET`, `NEXT_PUBLIC_STRIPE_KEY`

**報告内容**:
- 変数名
- 定義ファイル（.env, .env.local 等）
- 推定される種類（APIキー/トークン等）

**注意**: `NEXT_PUBLIC_` 変数はクライアントJSにバンドルされ、誰でも閲覧可能

### 2. .env ファイルの管理

**検出対象**:
- `.env` / `.env.local` / `.env.production` 等の存在
- `.gitignore` に含まれているか確認

**報告内容**:
- 検出されたファイル
- .gitignore への記載有無
- Git追跡状態（`git ls-files` で確認）

**確認方法（例）**:
```bash
git ls-files .env* --stage
```

### 3. ハードコードされた認証情報

**検出対象**:
- ソースコード内の文字列リテラルに含まれる認証情報パターン
- `apiKey: "sk-xxxxx"` のような直接記述

**報告内容**:
- 検出箇所（ファイル名:行番号）
- 検出パターン（マスク表示、先頭4文字+末尾4文字のみ）
- 推定される種類
- 誤検知の可能性がある場合は **要確認** と記載

### 4. 環境変数の型定義

**検出対象**:
- `env.d.ts` や型定義ファイルに秘密情報の型が NEXT_PUBLIC_ で定義されている

**報告内容**:
- 検出箇所
- 変数名

**追加確認（推奨）**:
- `process.env` を直接参照している箇所がある場合、実行時バリデーション（zod 等）で検証しているか

## 安全な環境変数の使い分け

```
# サーバーサイドのみ（安全）
DATABASE_URL=postgresql://...
SUPABASE_SERVICE_ROLE_KEY=eyJ...
BETTER_AUTH_SECRET=xxx

# クライアントに公開される（注意が必要）
NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
```

**注意**:
- `SUPABASE_SERVICE_ROLE_KEY` は **絶対に** `NEXT_PUBLIC_` で公開しない
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` は公開前提だが、RLS が必須

## チェック結果の記載例

```markdown
## 環境変数セキュリティ

### 検出結果
- NEXT_PUBLIC_秘密情報: 1件（Critical）
- .env管理不備: 0件
- ハードコード認証情報: 2件（Critical）

### NEXT_PUBLIC_ に秘密情報

| 変数名 | ファイル | 問題 |
|--------|----------|------|
| NEXT_PUBLIC_API_SECRET | .env.local | 秘密情報がクライアントに公開される |

### ハードコードされた認証情報

| ファイル | 行 | 検出内容 | 種類（推定） |
|----------|-----|----------|--------------|
| lib/api.ts | 12 | sk-xxxx... | OpenAI API Key |
| config.ts | 8 | AIzaSy... | Google API Key |

### .env ファイル管理

| ファイル | .gitignore | Git追跡 |
|----------|------------|---------|
| .env.local | あり | なし（OK） |
| .env.production | なし | あり（NG） |

### 推奨対応

1. `NEXT_PUBLIC_API_SECRET` を `API_SECRET` に変更し、Server Components/API Routes でのみ使用
2. ハードコードされた認証情報を環境変数に移行
3. `.env.production` を `.gitignore` に追加し、Git履歴から削除
```

## 参考: 環境変数ベストプラクティス

1. **秘密情報は `NEXT_PUBLIC_` を付けない**
2. **本番環境はホスティング側の環境変数機能を使用**（Vercel, Cloudflare 等。手動確認）
3. **`.env.example` は値を空にしてコミット**
4. **定期的な認証情報のローテーション**

## 補足: BETTER_AUTH_SECRET の強度目安

- 32文字以上のランダム文字列を推奨
- 短い/推測可能な値は **NG**
