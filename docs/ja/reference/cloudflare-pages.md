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
  --commit-dirty=false
```

デプロイはclean treeからのみ実行します。ローカルビルド時にtrackedまたは
untrackedのsource fileが `HEAD` と異なる場合、`vibepro-source-commit` metadataへ
`-dirty` が付き、上記のWranglerコマンドもデプロイを拒否します。

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
