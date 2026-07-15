# Cloudflare Pages

Cloudflare Pagesは、公開マニュアルの現在のホスティング先です。VibeProのプロダクト概念そのものには含めません。

ビルド:

```bash
npm run docs:build
```

clean worktreeからガード付きコマンドでデプロイします。

```bash
npm run docs:deploy
```

deploy scriptはbuild前にtracked/untrackedの変更を拒否し、build後にも再確認して、
完全なGit commitを `--commit-hash` でWranglerへ渡します。
`--commit-dirty=false` はclean deployment metadataを記録する指定であり、cleanliness
guardそのものではありません。ローカル開発buildではsource fileが `HEAD` と異なると
`vibepro-source-commit` metadataへ引き続き `-dirty` が付きます。

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

## ロールバック

必須routeが失敗した、内部資料が公開された、discovery/social metadataが欠けた、または
`vibepro-source-commit` が意図したreleaseと一致しない場合にrollbackします。clean
worktreeで直近の既知正常commitをcheckoutまたはrevertし、`npm run docs:deploy` を実行します。
復旧後はroot、日本語root、代表guide route、source-commit metadataを確認し、失敗した
deployment URLと復旧commitをrelease recordへ残します。
