# Install and First Run

Install VibePro from the package or from a local checkout.

```bash
npm install -g vibepro
vibepro version
```

For a local checkout:

```bash
npm install
npm link
vibepro version
```

Run a first health check in the target repository:

```bash
vibepro doctor .
vibepro story list .
vibepro pr prepare . --id <story-id>
```

## Optional: codebase-memory-mcp

`codebase-memory-mcp` is optional. VibePro does not bundle, install, update, or configure it. When the `codebase-memory-mcp` command is available on `PATH`, `vibepro pr prepare` performs one best-effort read-only topology query for the current changed files.

Typical local setup:

```bash
curl -fsSL https://raw.githubusercontent.com/DeusData/codebase-memory-mcp/main/install.sh | bash -s -- --skip-config
export PATH="$HOME/.local/bin:$PATH"
codebase-memory-mcp --version
codebase-memory-mcp cli index_repository '{"repo_path":"'"$(pwd)"'"}'
codebase-memory-mcp cli list_projects '{}'
```

Use `--skip-config` when VibePro should use only the CLI command and should not modify MCP settings for Codex, Claude, or other agents.

The provider is useful only after the repository has been indexed. A missing provider, failed query, clean worktree, or no changed-file match is recorded as `pr_context.code_topology_context.available=false` and does not block readiness by itself.
