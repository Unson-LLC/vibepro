# インストールと初回実行

VibeProはnpm packageまたはローカルcheckoutから使います。

```bash
npm install -g vibepro
vibepro version
```

ローカルcheckoutで動かす場合:

```bash
npm install
npm link
vibepro version
```

対象リポジトリで最初の確認を実行します。

```bash
vibepro doctor .
vibepro story list .
vibepro pr prepare . --id <story-id>
```

## 任意: codebase-memory-mcp

`codebase-memory-mcp` は任意連携です。VibeProはこれを同梱、インストール、更新、設定変更しません。`codebase-memory-mcp` コマンドが `PATH` 上にある場合、`vibepro pr prepare` は現在の変更ファイルに対して、読み取り専用の topology query を1回だけbest-effortで実行します。

ローカル設定例:

```bash
curl -fsSL https://raw.githubusercontent.com/DeusData/codebase-memory-mcp/main/install.sh | bash -s -- --skip-config
export PATH="$HOME/.local/bin:$PATH"
codebase-memory-mcp --version
codebase-memory-mcp cli index_repository '{"repo_path":"'"$(pwd)"'"}'
codebase-memory-mcp cli list_projects '{}'
```

VibeProからCLIだけを使い、CodexやClaudeなどのMCP設定を自動変更したくない場合は `--skip-config` を使います。

この連携は、対象repoがindex済みのときに意味があります。未インストール、query失敗、clean worktree、変更ファイルとの一致なしは `pr_context.code_topology_context.available=false` として記録され、PR readinessを単独では止めません。
