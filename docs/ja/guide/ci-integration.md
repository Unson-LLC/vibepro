# CI連携

このURLは古いリンクのために残しています。以前の `vibepro gate check` と Gate DAGのCIワークフローは最小コアから廃止されているため、新しいパイプラインには追加しないでください。

現行のリポジトリでは、変更に応じたチェックをリポジトリ自身のCIで実行します。VibeProは結果を記録し、通常のPRレビューに渡すコンテキストを準備できます。

```bash
vibepro verify run /path/to/repo --id story-example --kind unit -- npm test
vibepro pr prepare /path/to/repo --story-id story-example --base main --json
```

外部CIシステムが生成した結果を使う場合は `vibepro verify record` を使います。生成された `.vibepro/pr/<story-id>/pr-prepare.json` と `pr-body.md` を確認してください。これらは引き継ぎ用の要約であり、CIゲート、安全性の証明、マージ判断ではありません。

リポジトリの通常のGitHubワークフローと、権限を持つ人によるレビューを続けてください。現在のプロダクトの範囲は[機能マップ](/ja/guide/feature-map)、対応している流れは[開発ループ](/ja/guide/control-loop)を参照してください。
