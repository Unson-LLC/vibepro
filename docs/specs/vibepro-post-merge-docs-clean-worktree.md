---
story_id: story-vibepro-post-merge-docs-clean-worktree
status: final
parent_design: vibepro-post-merge-docs-clean-worktree
code_refs:
  - .github/workflows/post-merge-release.yml
test_refs:
  - test/post-merge-release.test.js
---

# Post-merge docs clean-worktree specification

## PMDCW-001 Clean deploy source

Given the post-merge projector has committed release history to main, when the VitePress deploy step starts, then it must fast-forward from main, install that commit's dependencies, and invoke `npm run docs:deploy`.

## PMDCW-002 Clean dependency boundary

The versioned repository ignore rules must exclude `node_modules/` so dependency installation does not dirty the deploy source.

## PMDCW-003 Recovery contract

Deployment failure continues to write recovery state to the GitHub job summary and must not roll back or republish an already immutable npm version.
