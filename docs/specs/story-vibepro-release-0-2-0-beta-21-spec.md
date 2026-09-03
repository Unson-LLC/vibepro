# 0.2.0-beta.21 Release Spec

## Version contract

`package.json`、root lockfile、lockfile root package、CLI `--version`を`0.2.0-beta.21`へ揃える。

## Verification

- `test/vibepro-cli.test.js`のrelease metadata testで4つのversion surfaceを固定する。
- `npm run typecheck`を実行する。
- `npm pack --dry-run`で公開対象ファイルとpackage metadataを確認する。

## Production readback

post-merge workflow完了後にnpm registryのversion、`gitHead`、dist-tagを読み、GitHub Release/tagのtarget commitと照合する。さらに一時ディレクトリへexact versionをfresh installし、CLI versionとruntime identityを読戻す。
