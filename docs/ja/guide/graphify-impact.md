# Impact Context連携

PR準備前のコード構造の調査には、次の2つのツールを使えます。VibeProへの接続方法は異なります。

| レンズ | 読み方 | 向いている用途 | 境界 |
| --- | --- | --- | --- |
| Graphify | `vibepro graph . --run-graphify` で明示実行、または `vibepro graph . --from <graphify-out>` でartifact取り込み | 既存graph artifact、視覚確認、広い依存関係の把握 | 自動ではなく、VibeProに同梱もしない |
| codebase-memory-mcp | index後に外部CLIまたはMCP toolを手動で使う | 関連ファイル、symbol、route、call path、変更ファイルのblast radius | 任意の外部context。VibeProは自動実行せず、証明にも使わない |

## Graphify

```bash
PATH="$HOME/.local/bin:$PATH" vibepro graph . --run-graphify
vibepro graph . --from graphify-out
```

取り込まれたファイルは次の場所に保存されます。

```text
.vibepro/graphify/
  graph.json
  GRAPH_REPORT.md
  graph.html  （Graphifyから提供された場合）
```

## codebase-memory-mcp

`codebase-memory-mcp` は任意の外部ツールです。VibeProは `pr prepare` から自動実行せず、その結果を `pr_context` へ自動記録もしません。利用できる環境では、リポジトリを手動でindex・queryし、返されたfile、symbol、route、call pathを人間またはAIのreview contextとして使います。

```bash
export PATH="$HOME/.local/bin:$PATH"
codebase-memory-mcp cli index_repository '{"repo_path":"'"$(pwd)"'"}'
# providerのqueryを手動で実行し、結果を確認する
```

どちらのレンズも「変更が正しく動くこと」の証明には使いません。読むべきファイル、経路、テスト、reviewerを決める材料として使います。
