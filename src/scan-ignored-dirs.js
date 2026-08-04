// Shared ignore set for the repo-walking scanners (architecture-profiler,
// code-quality-scanner, database-access-scanner). Keeping this in one place
// stops the per-scanner literals from drifting apart, which is how `.worktrees`
// ended up ignored by only one of the three.
//
// `.claude` and `.worktrees` hold session/managed worktree stores (Claude Code
// session worktrees under `.claude/worktrees`, and other managed worktree
// checkouts under `.worktrees`) rather than repository source. A real checkout
// can accumulate hundreds of thousands of files there; walking them is pure
// scan cost with nothing to detect.
export const SCAN_IGNORED_DIRS = Object.freeze(new Set([
  '.claude',
  '.git',
  '.next',
  '.turbo',
  '.vibepro',
  '.worktrees',
  'coverage',
  'graphify-out',
  'node_modules'
]));
