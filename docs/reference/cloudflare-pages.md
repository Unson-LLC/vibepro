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
again after the build, and passes the exact full Git commit to Wrangler with
`--commit-hash`. `--commit-dirty=false` records clean deployment metadata; it is
not the cleanliness guard. Local development builds still append `-dirty` to
the `vibepro-source-commit` metadata when source files differ from `HEAD`.

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
intended release. Check out or revert to the last known-good commit in a clean
worktree, then run `npm run docs:deploy`. After the deployment, verify the root,
Japanese root, a representative guide route, and the source-commit metadata.
Keep the failed deployment URL and the restored commit in the release record.
