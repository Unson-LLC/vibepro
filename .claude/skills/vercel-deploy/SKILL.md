---
name: vercel-deploy
description: Vercelへのデプロイ計画を作成する。target/内のNext.js・React・JAMstackアプリを分析し、デプロイに必要な設定・手順・注意点をまとめた計画書をresults/deploy-plan.mdに出力する。VibePro診断（/diagnose）実行後に使用することを想定。診断結果がある場合はそれを参照して計画に反映する。
---

# Vercel デプロイ計画

`target/` 内のコードを分析し、Vercelへのデプロイ計画を `results/deploy-plan.md` に出力する。

## 前提条件

- 診断結果（`results/summary.md`等）がある場合は参照する
- ない場合は独自にコードを分析する

## 実行手順

### Step 1: コード分析

`target/` ディレクトリを分析し以下を特定：

1. **フレームワーク検出**
   - Next.js / React / Vue / Nuxt / Astro / Svelte / 静的HTML等
   - package.json のdependencies確認

2. **ビルド設定確認**
   - ビルドコマンド（`npm run build` 等）
   - 出力ディレクトリ（`.next/`, `dist/`, `build/`, `out/` 等）
   - 環境変数の有無

3. **API/バックエンド確認**
   - API Routes / Route Handlers が存在するか
   - Server Components / Server Actions の使用
   - 外部APIへの依存（Supabase等）

### Step 2: 診断結果の参照（存在する場合）

`results/` 内の診断ファイルから以下を抽出：

- セキュリティ上の懸念（デプロイ前に修正すべき項目）
- 推奨規模（ライト/スタンダード/エンタープライズ）
- 重要なリスク項目

### Step 3: デプロイ計画の作成

`results/deploy-plan.md` に以下を出力：

```markdown
# Vercel デプロイ計画

作成日時: YYYY-MM-DD HH:MM
対象: target/

---

## プロジェクト概要

| 項目 | 内容 |
|------|------|
| フレームワーク | [検出されたフレームワーク] |
| ビルドコマンド | [npm run build 等] |
| 出力ディレクトリ | [.next 等] |
| API Routes | [あり/なし] |
| Server Components | [あり/なし] |

---

## デプロイ前チェックリスト

### 必須（デプロイ前に完了すること）

- [ ] [診断で検出されたCritical/High項目があれば記載]
- [ ] 環境変数の設定確認
- [ ] ビルドの成功確認（`npm run build`）
- [ ] .gitignore に node_modules, .env.local が含まれているか

### 推奨（デプロイ後でも可）

- [ ] [Medium項目があれば記載]

---

## Vercel 設定

### 1. プロジェクト作成

**Vercel CLI を使用する場合:**
```bash
npm install -g vercel
vercel login
vercel
```

**Dashboardを使用する場合:**
1. https://vercel.com/new にアクセス
2. Git連携（GitHub/GitLab/Bitbucket）を選択
3. リポジトリをインポート

### 2. ビルド設定

| 設定項目 | 値 |
|----------|-----|
| Framework Preset | [Next.js 等 - 自動検出] |
| Build Command | `[検出されたビルドコマンド]` |
| Output Directory | `[検出された出力ディレクトリ]` |
| Install Command | `npm install` または `pnpm install` |
| Node.js Version | `[package.jsonから推定]` |

### 3. 環境変数

以下の環境変数を Vercel の設定画面で登録：

| 変数名 | 説明 | Production | Preview | Development |
|--------|------|------------|---------|-------------|
| [検出された変数] | [説明] | 要設定 | 要設定 | 要設定 |

**設定方法:**
1. Dashboard > Settings > Environment Variables
2. または `vercel env add [変数名]`

**注意:**
- `NEXT_PUBLIC_` プレフィックスの変数はクライアントに公開される
- 秘密情報は `NEXT_PUBLIC_` を付けない

### 4. Serverless Functions / Edge Functions

[API Routes や Server Actions がある場合の設定を記載]

**リージョン設定（推奨）:**
```json
// vercel.json
{
  "regions": ["hnd1"]  // 東京リージョン
}
```

---

## デプロイ手順

### 方法1: Git連携（推奨）

1. GitHubにリポジトリをプッシュ
2. Vercel Dashboard で Git連携を設定
3. 自動デプロイが有効化される
   - main/master ブランチ → Production
   - その他のブランチ → Preview

### 方法2: Vercel CLI

```bash
# ビルド確認
npm run build

# デプロイ（プレビュー）
vercel

# デプロイ（本番）
vercel --prod
```

### 方法3: GitHub Actions

```yaml
# .github/workflows/deploy.yml
name: Deploy to Vercel
on:
  push:
    branches: [main]
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: amondnet/vercel-action@v25
        with:
          vercel-token: ${{ secrets.VERCEL_TOKEN }}
          vercel-org-id: ${{ secrets.VERCEL_ORG_ID }}
          vercel-project-id: ${{ secrets.VERCEL_PROJECT_ID }}
          vercel-args: '--prod'
```

---

## カスタムドメイン設定（オプション）

1. Dashboard > Settings > Domains
2. ドメインを追加
3. DNSレコードを設定

```
# Apex domain (@)
A  @  76.76.21.21

# www subdomain
CNAME  www  cname.vercel-dns.com
```

---

## Next.js 固有の設定

### next.config.js 推奨設定

```js
/** @type {import('next').NextConfig} */
const nextConfig = {
  // 画像最適化のドメイン許可
  images: {
    remotePatterns: [
      { hostname: 'example.com' },
    ],
  },
  // セキュリティヘッダー
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
        ],
      },
    ];
  },
};

module.exports = nextConfig;
```

---

## 注意事項

[コード分析や診断結果から得られた注意点を記載]

- [フレームワーク固有の注意点]
- [環境変数に関する注意点]
- [セキュリティに関する注意点]

---

## 参考リンク

- [Vercel Documentation](https://vercel.com/docs)
- [Next.js on Vercel](https://vercel.com/docs/frameworks/nextjs)
- [Environment Variables](https://vercel.com/docs/projects/environment-variables)
```

## 完了時の出力

```
デプロイ計画を作成しました。

生成されたファイル:
- results/deploy-plan.md

次のステップ:
1. デプロイ前チェックリストを確認
2. Vercel アカウントを準備
3. 計画に従ってデプロイを実行
```

## 参考: フレームワーク別設定

詳細は [references/api_reference.md](references/api_reference.md) を参照。
