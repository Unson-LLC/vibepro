# Post-merge docs clean-worktree architecture

After the deterministic projector commits release history, the deploy stage fast-forwards to `origin/main`, installs the dependencies declared by that final commit, and runs `docs:deploy`.

The versioned `.gitignore` excludes `node_modules/`, so dependency installation cannot introduce untracked files that violate the public-manual deployer's clean-source boundary. Keeping the post-pull install also prevents a concurrent main update from being built with stale dependencies. npm publication and GitHub Release reconciliation remain unchanged and independently leased.

Rollback is a one-line workflow revert. Runtime recovery remains visible in the GitHub job summary.
