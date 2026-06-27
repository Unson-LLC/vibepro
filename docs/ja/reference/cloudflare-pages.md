# Cloudflare Pages

Cloudflare Pagesは、公開マニュアルの現在のホスティング先です。VibeProのプロダクト概念そのものには含めません。

ビルド:

```bash
npm run docs:build
```

デプロイ:

```bash
npx wrangler pages deploy docs/.vitepress/dist \
  --project-name vibepro \
  --branch main \
  --commit-dirty=true
```

デプロイ前にaccountとPages権限を確認します。

```bash
npx wrangler whoami
npx wrangler pages project list
```

公開後に確認するURL:

- `https://vibepro.pages.dev/`
- `https://vibepro.pages.dev/ja/`
- `https://vibepro.pages.dev/ja/guide/graphify-impact`

security headerとredirectは `docs/public/` に置きます。
