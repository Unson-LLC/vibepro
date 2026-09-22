# インストールと初回実行

VibeProはNode.js 20以上が必要です。公開パッケージは現在betaです。以下の手順ではグローバルにインストールします。

```bash
npm install -g vibepro@beta
vibepro --help
```

グローバルにインストールせず確認する場合は、`npx vibepro@beta --help` を使えます。その場合、以降の例の `vibepro` も `npx vibepro@beta` に置き換えてください。

Gitリポジトリで、試す変更をひとつ選びます。`/path/to/repo`、StoryのID、タイトルを実際の値に置き換えて初期化します。

```bash
vibepro init /path/to/repo \
  --story-id story-example \
  --title "変更内容" \
  --language ja
```

対象リポジトリに `.vibepro/` が作られます。Story、Spec、確認結果を保存する場所であり、アプリケーション本体ではありません。初期化しただけでは、必要な振る舞いの記述や変更の検証は完了しません。

導入状態とリポジトリ状態を確認します。

```bash
vibepro doctor /path/to/repo --json
vibepro status /path/to/repo --json
vibepro story list /path/to/repo --all
```

次は、期待する振る舞いを書き、[ひとつの変更からPR準備まで](/ja/guide/control-loop)を進めます。マニュアルとインストールした版が異なる場合は、`vibepro help --language ja` を優先してください。
