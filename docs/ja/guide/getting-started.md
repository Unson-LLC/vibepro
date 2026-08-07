# インストールと初回実行

VibeProはNode.js 20以上が必要です。公開packageは現在betaです。

```bash
npx vibepro@beta --help
# または
npm install -g vibepro@beta
vibepro --help
```

対象リポジトリを初期化します。

```bash
vibepro init /path/to/repo \
  --story-id story-example \
  --title "変更内容" \
  --language ja
```

対象リポジトリに `.vibepro/` が作られます。これは文脈と証跡のワークスペースであり、アプリケーション本体ではありません。

導入状態とリポジトリ状態を確認します。

```bash
vibepro doctor /path/to/repo --json
vibepro status /path/to/repo --json
vibepro story list /path/to/repo --all
```

次は[最小コアの流れ](/ja/guide/control-loop)へ進みます。manualとinstalled packageが異なる場合は、`vibepro help --language ja` を優先してください。
