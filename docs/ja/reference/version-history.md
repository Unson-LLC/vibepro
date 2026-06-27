# バージョン履歴

正本のpackage versionは `package.json` です。このページではマニュアル利用者に見える変更をまとめます。

## 現在のパッケージバージョン

| 項目 | 値 |
| --- | --- |
| `package.json` | `0.1.0-beta.0` |
| 確認方法 | `vibepro version` または `vibepro --version` |

## `0.1.0-beta.0` 後のマニュアル更新

- Cloudflare Pagesの公開サイトを `main` から再ビルドできるよう、VitePress manual sourceを `docs/` に復元
- `vibepro pr prepare` の任意 `codebase-memory-mcp` topology supportを明記
- Graphifyとcode topologyは任意のimpact lensであり、correctness gateではないことを明記
- `pr_context.code_topology_context` と `code_topology_impact_scope` を生成物対応表に追加

## 初期公開準備

`0.1.0-alpha.0` では、OSS公開用のpackage形、phase checkpoint、Story/Spec review flow、public discovery documentationを追加しました。
