---
name: detect-framework
description: フレームワークを検出する
---

# フレームワーク検出

指定したコードで使用されているフレームワーク・ライブラリを検出し、技術スタックを報告します。

## 実行手順

### Step 1: 対象確認

```bash
ls -la target/
```

対象がなければuserにtargetディレクトリの準備をしてもらうよう報告

### Step 2: 検出実行

以下の順序でフレームワークを検出:

#### 2.0 サイト種別判定

以下の3種別に分類する:

| 種別 | 説明 | ビルド | サーバー |
|------|------|--------|----------|
| **静的サイト（ビルド不要）** | HTML/CSS/JSをそのまま配信 | 不要 | 不要 |
| **静的サイト（ビルド必要）** | SSG/ビルドツールで生成後に配信 | 必要 | 不要 |
| **動的アプリケーション** | サーバーサイド処理が必要 | 必要 | 必要 |

---

**A. 静的サイト（ビルド不要）の条件**:

以下をすべて満たす場合:
1. `index.html` が存在する
2. `package.json` が存在しない、または `build` スクリプトがない
3. サーバーサイドコードが存在しない
4. SSG/フレームワーク設定ファイルがない

---

**B. 静的サイト（ビルド必要）の条件**:

以下のいずれかに該当する場合:

**B-1. 静的サイトジェネレーター（SSG）**

| ツール | 検出方法 | 設定ファイル |
|--------|----------|-------------|
| Next.js (Export) | `next` + `output: 'export'` in config | `next.config.js` / `.mjs` / `.ts` |
| Nuxt.js (Generate) | `nuxt` + `ssr: false` or `nuxt generate` | `nuxt.config.js` / `.ts` |
| Astro | `astro` in package.json | `astro.config.mjs` |
| Gatsby | `gatsby` in package.json | `gatsby-config.js` |
| 11ty (Eleventy) | `@11ty/eleventy` in package.json | `.eleventy.js` / `eleventy.config.js` |
| VitePress | `vitepress` in package.json | `.vitepress/config.js` |
| Docusaurus | `@docusaurus/core` in package.json | `docusaurus.config.js` |
| Hugo | `hugo.toml` / `hugo.yaml` / `config.toml` | - |
| Jekyll | `_config.yml` + `Gemfile` with `jekyll` | - |
| Hexo | `hexo` in package.json | `_config.yml` |
| Zola | `config.toml` + `templates/` | - |
| Pelican | `pelicanconf.py` | - |

**Next.js Export Mode の検出方法**:

1. `next.config.js` / `next.config.mjs` / `next.config.ts` を確認
2. 以下のいずれかがあれば Export Mode:
   ```js
   output: 'export'
   ```
3. かつ、以下が**存在しない**ことを確認:
   - `app/api/` または `pages/api/` ディレクトリ
   - `getServerSideProps` の使用
   - ミドルウェア（`middleware.ts`）

**B-2. ビルドツールのみ使用（フレームワークなし）**

| ツール | 検出方法 | 特徴 |
|--------|----------|------|
| Vite (vanilla) | `vite` in package.json, no framework | `vite.config.js` |
| Parcel | `parcel` in package.json | - |
| Rollup | `rollup` in package.json | `rollup.config.js` |
| esbuild | `esbuild` in package.json | - |
| Webpack (static) | `webpack` in package.json, no server | `webpack.config.js` |

**B-3. CSSビルドのみ必要**

| ツール | 検出方法 |
|--------|----------|
| Tailwind CSS | `tailwindcss` in package.json + `tailwind.config.*` |
| Sass/SCSS | `sass` in package.json / `.scss` files |
| PostCSS | `postcss` in package.json + `postcss.config.js` |
| Less | `less` in package.json / `.less` files |

---

**C. 動的アプリケーションの条件**:

以下のいずれかに該当する場合:

| 種類 | 検出方法 |
|------|----------|
| Next.js (SSR/ISR) | `next` + `output: 'export'` がない（詳細は下記） |
| Nuxt.js (SSR) | `nuxt` + `ssr: false` がない + server middleware |
| SvelteKit (SSR) | `@sveltejs/kit` + server routes |
| Remix | `@remix-run/*` in package.json |
| Express / Fastify / Hono | バックエンドフレームワーク検出 |
| PHP | `.php` ファイル存在 |
| Python (Django/Flask/FastAPI) | サーバーサイドフレームワーク検出 |
| Ruby (Rails/Sinatra) | サーバーサイドフレームワーク検出 |

**Next.js 動的モードの検出方法**:

以下のいずれかがあれば動的アプリケーション:
- `output: 'export'` が設定されていない（デフォルトはSSR）
- `app/api/` または `pages/api/` ディレクトリが存在
- `getServerSideProps` を使用しているファイルがある
- `middleware.ts` / `middleware.js` が存在
- `revalidate` を使った ISR を使用

---

**静的ファイルの拡張子**:
| 拡張子 | 種類 |
|--------|------|
| .html | HTML |
| .css | CSS |
| .js | JavaScript |
| .json | データファイル |
| .png / .jpg / .gif / .svg / .webp / .ico | 画像 |
| .woff / .woff2 / .ttf / .eot | フォント |
| .mp4 / .webm / .mp3 | メディア |

---

#### 2.1 package.json からの検出（存在する場合）

```bash
cat target/package.json 2>/dev/null
```

dependencies / devDependencies から以下を検出:

| パッケージ名 | フレームワーク | カテゴリ |
|-------------|---------------|---------|
| react | React | フロントエンド |
| react-dom | React | フロントエンド |
| next | Next.js | フルスタック |
| vue | Vue.js | フロントエンド |
| nuxt | Nuxt.js | フルスタック |
| @angular/core | Angular | フロントエンド |
| svelte | Svelte | フロントエンド |
| @sveltejs/kit | SvelteKit | フルスタック |
| express | Express | バックエンド |
| fastify | Fastify | バックエンド |
| hono | Hono | バックエンド |
| koa | Koa | バックエンド |
| nest | NestJS | バックエンド |
| @nestjs/core | NestJS | バックエンド |
| django | Django | バックエンド |
| flask | Flask | バックエンド |
| fastapi | FastAPI | バックエンド |
| tailwindcss | Tailwind CSS | CSS |
| bootstrap | Bootstrap | CSS |
| @mui/material | Material UI | UIライブラリ |
| @chakra-ui/react | Chakra UI | UIライブラリ |
| antd | Ant Design | UIライブラリ |
| shadcn | shadcn/ui | UIライブラリ |
| typescript | TypeScript | 言語 |
| vite | Vite | ビルドツール |
| webpack | Webpack | ビルドツール |
| esbuild | esbuild | ビルドツール |
| prisma | Prisma | ORM |
| drizzle-orm | Drizzle | ORM |
| mongoose | Mongoose | ORM |
| sequelize | Sequelize | ORM |
| jest | Jest | テスト |
| vitest | Vitest | テスト |
| playwright | Playwright | テスト |
| cypress | Cypress | テスト |

#### 2.2 設定ファイルからの検出

以下のファイルの存在を確認:

| ファイル | フレームワーク |
|---------|---------------|
| next.config.js / next.config.mjs / next.config.ts | Next.js |
| nuxt.config.js / nuxt.config.ts | Nuxt.js |
| angular.json | Angular |
| vue.config.js / vite.config.ts | Vue.js / Vite |
| svelte.config.js | SvelteKit |
| tailwind.config.js / tailwind.config.ts | Tailwind CSS |
| tsconfig.json | TypeScript |
| webpack.config.js | Webpack |
| vite.config.js / vite.config.ts | Vite |
| requirements.txt | Python |
| pyproject.toml | Python |
| Gemfile | Ruby |
| go.mod | Go |
| Cargo.toml | Rust |
| composer.json | PHP |
| pom.xml | Java (Maven) |
| build.gradle | Java/Kotlin (Gradle) |

#### 2.3 Python の場合（requirements.txt / pyproject.toml）

```bash
cat target/requirements.txt 2>/dev/null
cat target/pyproject.toml 2>/dev/null
```

| パッケージ名 | フレームワーク |
|-------------|---------------|
| django | Django |
| flask | Flask |
| fastapi | FastAPI |
| streamlit | Streamlit |
| gradio | Gradio |

### Step 3: 結果出力

結果を `results/detect-framework.md` に保存:

## 出力形式

### A. 静的サイト（ビルド不要）の場合

```markdown
# フレームワーク検出レポート

診断日時: YYYY-MM-DD HH:MM
対象: target/

---

## 判定結果

| 項目 | 値 |
|------|-----|
| **種別** | 静的サイト（ビルド不要） |
| **ビルド** | 不要 |
| **サーバー** | 不要 |
| **デプロイ** | 静的ホスティング対応 |

そのまま配信可能な静的ファイルのみで構成されています。

---

## 技術スタック概要

**種別**: 静的サイト（ビルド不要）
**マークアップ**: HTML5
**スタイル**: CSS3 + Bootstrap
**スクリプト**: JavaScript (jQuery)
**ビルド**: 不要
**推奨デプロイ先**: Cloudflare Pages / Netlify / GitHub Pages / Vercel

---

*VibePro フレームワーク検出 (detect-framework)*
```

### B. 静的サイト（ビルド必要）の場合

```markdown
# フレームワーク検出レポート

診断日時: YYYY-MM-DD HH:MM
対象: target/

---

## 判定結果

| 項目 | 値 |
|------|-----|
| **種別** | 静的サイト（ビルド必要） |
| **ビルド** | 必要 |
| **サーバー** | 不要（ビルド後は静的ファイルのみ） |
| **デプロイ** | 静的ホスティング対応 |

SSG（静的サイトジェネレーター）を使用。ビルド後は静的ファイルとして配信可能。

---

## 検出結果

### 静的サイトジェネレーター
| ツール | バージョン | カテゴリ |
|--------|-----------|---------|
| Astro | 4.5.0 | SSG |

### フレームワーク
| フレームワーク | バージョン | 用途 |
|---------------|-----------|------|
| React | 18.2.0 | UIコンポーネント |

### スタイル
| ライブラリ | バージョン |
|-----------|-----------|
| Tailwind CSS | 3.4.0 |

### 検出された設定ファイル
- astro.config.mjs
- tailwind.config.mjs
- tsconfig.json

### ビルドコマンド
```bash
npm run build
# 出力先: dist/
```

---

## 技術スタック概要

**種別**: 静的サイト（ビルド必要）
**SSG**: Astro
**フレームワーク**: React（アイランド）
**スタイル**: Tailwind CSS
**言語**: TypeScript
**ビルド**: 必要（`npm run build`）
**出力**: `dist/` ディレクトリ
**推奨デプロイ先**: Cloudflare Pages / Netlify / Vercel

---

*VibePro フレームワーク検出 (detect-framework)*
```

### C. 動的アプリケーションの場合

```markdown
# フレームワーク検出レポート

診断日時: YYYY-MM-DD HH:MM
対象: target/

---

## 判定結果

| 項目 | 値 |
|------|-----|
| **種別** | 動的アプリケーション |
| **ビルド** | 必要 |
| **サーバー** | 必要 |
| **デプロイ** | サーバー/コンテナ/サーバーレス |

サーバーサイド処理が必要なアプリケーションです。

---

## 検出結果

### メインフレームワーク
| フレームワーク | バージョン | カテゴリ |
|---------------|-----------|---------|
| Next.js | 14.0.0 | フルスタック |
| React | 18.2.0 | フロントエンド |

### UIライブラリ
| ライブラリ | バージョン |
|-----------|-----------|
| Tailwind CSS | 3.4.0 |
| shadcn/ui | - |

### ビルドツール・その他
| ツール | バージョン | 用途 |
|--------|-----------|------|
| TypeScript | 5.3.0 | 言語 |
| Prisma | 5.0.0 | ORM |

### 検出された設定ファイル
- next.config.mjs
- tailwind.config.ts
- tsconfig.json

---

## 技術スタック概要

**種別**: 動的アプリケーション
**フロントエンド**: Next.js (React) + Tailwind CSS
**バックエンド**: Next.js API Routes
**言語**: TypeScript
**データベース**: Prisma ORM
**ビルド**: 必要（`npm run build`）
**推奨デプロイ先**: Vercel / AWS / GCP / Azure / Cloudflare Workers

---

*VibePro フレームワーク検出 (detect-framework)*
```

## 完了メッセージ

```
フレームワーク検出が完了しました。結果: results/detect-framework.md
```
