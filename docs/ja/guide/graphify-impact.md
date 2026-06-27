# Impact Context連携

VibeProは、PR準備の前に任意のコード構造文脈を読みます。2つのレンズは役割が違います。

| レンズ | 読み方 | 向いている用途 | 境界 |
| --- | --- | --- | --- |
| Graphify | `vibepro graph . --run-graphify` で明示実行、または `vibepro graph . --from <graphify-out>` でartifact取り込み | 既存graph artifact、視覚確認、広い依存関係の把握 | 自動ではなく、VibeProに同梱もしない |
| codebase-memory-mcp | `codebase-memory-mcp` が `PATH` 上にある場合、`vibepro pr prepare` が自動で読む | 関連ファイル、symbol、route、call path、変更ファイルのblast radius | 任意であり、正しさの証明にはならない |

## Graphify

```bash
PATH="$HOME/.local/bin:$PATH" vibepro graph . --run-graphify
vibepro graph . --from graphify-out
```

取り込まれたファイルは次の場所に保存されます。

```text
.vibepro/graphify/
  graph.json
  graph.html
  GRAPH_REPORT.md
```

## codebase-memory-mcp

インストールとindex後、`pr prepare` は読み取り専用の `detect_changes` query を実行し、正規化した結果を `pr_context.code_topology_context` に記録します。

```bash
export PATH="$HOME/.local/bin:$PATH"
codebase-memory-mcp cli index_repository '{"repo_path":"'"$(pwd)"'"}'
vibepro pr prepare . --id <story-id>
```

VibeProは現在の `codebase-memory-mcp` CLI挙動に合わせて、providerに `repo_path` と派生したproject名の両方を渡します。

正規化されたcontextには、availability、reason、matched files、related files、symbols、routes、call paths、risk hints、investigation files、`code_topology:*` signals が入ります。一致ファイルがある場合、VibeProはcommon judgment spineに `code_topology_impact_scope` を任意のmatched evidenceとして表示できます。

どちらのレンズも「変更が正しく動くこと」の証明には使いません。読むべきファイル、経路、テスト、reviewerを決める材料として使います。
