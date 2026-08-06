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
//
// This is exposed as a has()-only facade rather than a Set: Object.freeze on a
// Set only freezes its own properties, not its internal slots, so .add()/
// .delete() would still mutate the one shared instance and silently change
// what all three consumers ignore. Every call site here only needs membership
// checks (`IGNORED_DIRS.has(name)`), so a frozen plain object with a has()
// method is a genuine (not just cosmetic) immutability guarantee -- freezing a
// plain object really does block adding/reassigning/deleting its properties --
// while leaving call sites unchanged.
const ignoredDirNames = new Set([
  '.claude',
  '.git',
  '.next',
  '.turbo',
  '.vibepro',
  '.worktrees',
  'coverage',
  'graphify-out',
  'node_modules'
]);

export const SCAN_IGNORED_DIRS = Object.freeze({
  has: (name) => ignoredDirNames.has(name)
});
