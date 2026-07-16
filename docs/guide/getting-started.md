# Install and First Run

Install the published early beta or use a local checkout of current `main`.

```bash
npm install -g vibepro@beta
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
vibepro story diagnose . --id <story-id> --pre-architecture --run-graphify
vibepro pr prepare . --story-id <story-id> --base origin/main --summary-json
```

The npm package and this manual may represent different commits. The installed
binary's `vibepro help` is authoritative for its command contract; see
[Release and Audit](/guide/release-and-audit) for the version boundary.

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
