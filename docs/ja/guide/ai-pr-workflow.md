# AI PRの進め方

PR本文だけが正本になる前にVibeProを実行します。

```bash
vibepro story list .
vibepro check pr-readiness . --story-id <story-id> --base main
vibepro pr prepare . --story-id <story-id> --summary-json
```

`pr prepare` が集めるもの:

- Story、Spec、Architectureの文脈
- 変更ファイルとリスク面
- `.vibepro/graphify/graph.json` がある場合のGraphify文脈
- `codebase-memory-mcp` コマンドがあり、repoがindex済みの場合のcode topology文脈
- 検証、レビュー、判断記録
- Gate DAGと人間が読めるreview artifact

GitHub PR本文は簡潔に保ちます。詳細証跡は `.vibepro/pr/<story-id>/` に置きます。特に `pr-prepare.json`、`gate-dag.html`、`review-cockpit.html`、`split-plan.html` を確認します。

`gate_status` がreadyなら `vibepro pr create`、CI完了後は `verify import-ci` と `pr prepare` / `pr create` refreshを行い、`vibepro execute merge` で完了します。完全な順序は[制御ループ](/ja/guide/control-loop)を参照してください。

`code_topology_context.available=false` の場合は `reason` を見ます。未インストール、clean worktree、またはindex済みprojectに変更ファイルが一致しないだけの場合があります。
