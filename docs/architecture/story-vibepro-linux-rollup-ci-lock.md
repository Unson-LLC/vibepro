# Linux Rollup CI lock architecture

The package root explicitly owns the platform-specific Rollup binary required by the GitHub-hosted Linux x64 GNU runner. npm keeps it optional and applies the package's `os` and `cpu` constraints, while the lockfile carries its immutable tarball resolution for reproducible `npm ci` installs.

This closes the gap between Rollup's transitive optional-dependency declaration and npm's macOS-generated lockfile. It does not change the release state machine, public CLI, or Cloudflare deployment boundary. A package metadata revert is the complete rollback.

The release-note projector also resolves repository-relative `docs/...` markdown targets to the canonical GitHub repository. Public VitePress pages therefore link to source-only management documents without treating them as local manual routes.
