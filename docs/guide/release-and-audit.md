# Release and Audit

## Published Package vs Current Main

| Surface | Meaning | How to verify |
| --- | --- | --- |
| npm `latest` / `beta` | Release target: `0.2.0-beta.0` | `npm view vibepro dist-tags --json` and `vibepro version` |
| GitHub `main` | Current source, including unreleased changes | `git rev-parse HEAD` and `CHANGELOG.md` → Unreleased |
| This manual build | The commit shown in the footer and `vibepro-source-commit` meta tag | Compare it with GitHub `main` |
| Local artifacts | Evidence for a specific repository, Story, and head | Inspect `.vibepro/` plus the Git head |

The package is an early beta. A reproducible install can be explicit:

```bash
npm install -g vibepro@beta
vibepro version
```

Do not assume that a command documented from current `main` exists in an older installed binary. The generated [CLI Reference](/reference/cli) matches the manual source commit; the running binary's `vibepro help` wins when they differ.

## PR, CI, and Merge Freshness

Evidence and reviews are head-bound. Finalize the tree, commit, record verification and independent review, then run `pr prepare` and `pr create`. After CI completes, import it, refresh preparation and the existing PR, then merge through `execute merge`.

## Canonical Audit and ROI

`audit replay` checks whether the shipped Story can be reconstructed from canonical artifacts. `usage report --gate-roi --subagent-roi` shows whether gates and independent reviews produced useful decisions relative to their cost. A blocked source remains blocked; it must not appear as zero activity.

Cloudflare Pages deployment details belong in the [hosting reference](/reference/cloudflare-pages), not in the product model.
