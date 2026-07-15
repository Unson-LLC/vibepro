# Cloudflare Pages

Cloudflare Pages is the current hosting target for the public manual. It is not part of VibePro's product model.

Build:

```bash
npm run docs:build
```

Deploy from a clean worktree with the guarded command:

```bash
npm run docs:deploy
```

The deploy script rejects tracked or untracked changes before it builds, checks
again after the build, fixes `vibepro-source-commit` to that clean `HEAD`, checks
the generated metadata, and passes the exact full Git commit to Wrangler with
`--commit-hash`. Ambient `CF_PAGES_COMMIT_SHA` values cannot override this
binding. `--commit-dirty=false` records clean deployment metadata; it is not the
cleanliness guard. Local development builds still append `-dirty` to the
`vibepro-source-commit` metadata when source files differ from `HEAD`.

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

## Rollback

Rollback when required routes fail, internal material appears, discovery or
social metadata is missing, or `vibepro-source-commit` does not match the
intended release. In Cloudflare Dashboard, open **Workers & Pages → vibepro →
Deployments**, open the actions menu for the last known-good successful
production deployment, and select **Rollback to this deployment**. This path
remains available even when the target Git commit predates `docs:deploy`.

After rollback, verify the root, Japanese root, and a representative guide route;
`robots.txt`, `llms.txt`, and `sitemap.xml`; Hero, Open Graph, and Twitter images;
absence of every internal corpus listed in the build contract; and the restored
`vibepro-source-commit`. Keep the failed and restored deployment URLs, restored
commit, operator, timestamp, and verification result in the release record.
