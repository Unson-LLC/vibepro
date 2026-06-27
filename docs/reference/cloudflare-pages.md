# Cloudflare Pages

Cloudflare Pages is the current hosting target for the public manual. It is not part of VibePro's product model.

Build:

```bash
npm run docs:build
```

Deploy:

```bash
npx wrangler pages deploy docs/.vitepress/dist \
  --project-name vibepro \
  --branch main \
  --commit-dirty=true
```

Before deploying, verify the account and Pages permission:

```bash
npx wrangler whoami
npx wrangler pages project list
```

The published manual should be checked at:

- `https://vibepro.pages.dev/`
- `https://vibepro.pages.dev/ja/`
- `https://vibepro.pages.dev/ja/guide/graphify-impact`

Security headers and redirects are stored in `docs/public/`.
