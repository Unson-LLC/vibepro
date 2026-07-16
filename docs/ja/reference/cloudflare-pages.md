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

deploy scriptはbuild前にtracked/untrackedの変更を拒否し、build後にも再確認します。
さらに `vibepro-source-commit` をcleanな `HEAD` に固定して生成metadataを照合し、
完全なGit commitを `--commit-hash` でWranglerへ渡します。環境に残った
`CF_PAGES_COMMIT_SHA` がこのbindingを上書きすることはありません。
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
`vibepro-source-commit` が意図したreleaseと一致しない場合にrollbackします。Cloudflare
Dashboardで **Workers & Pages → vibepro → Deployments** を開き、直近の既知正常なproduction
deploymentのactions menuから **Rollback to this deployment** を選びます。この経路なら、
対象Git commitが `docs:deploy` 導入前でもrollbackできます。

復旧後はroot、日本語root、代表guide route、`robots.txt`、`llms.txt`、`sitemap.xml`、
Hero/OG/Twitter image、build contractに列挙した内部corpusが存在しないこと、復旧した
`vibepro-source-commit` を確認します。失敗・復旧deployment URL、復旧commit、operator、
timestamp、検証結果をrelease recordへ残します。
