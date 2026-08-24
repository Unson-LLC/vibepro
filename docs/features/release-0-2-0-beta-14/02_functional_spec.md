<!-- vibepro-projection story_id=story-vibepro-release-0-2-0-beta-14 feature_slug=release-0-2-0-beta-14 ownership=generated profile=feature_packet source=.vibepro/spec/story-vibepro-release-0-2-0-beta-14/spec.json source_sha256=e2d2677a8292052c7633da318a185c36f86ae5b2cdfe0e46f106ac56f03042d8 renderer=functional_spec_markdown@1 direct_edit=false -->
- Canonical ownership: generated

# Functional Spec

- Story: story-vibepro-release-0-2-0-beta-14
- Status: -
- Clauses: 4

## C-001

package.json and the root package in package-lock.json declare version 0.2.0-beta.14.

### Origin refs

- {"anchor":"0.2.0-beta.14","file":"package-lock.json"}
- {"anchor":"0.2.0-beta.14","file":"package.json"}
- {"case":"PCR-CON-006 rejects an existing version with another gitHead","file":"test/post-merge-release.test.js"}
- {"file":"docs/architecture/story-vibepro-release-0-2-0-beta-14.md","section":"境界"}
- {"index":0,"kind":"acceptance_criteria"}

## INV-001

The release change does not modify runtime source, dependencies, binaries, or the post-merge publishing workflow.

### Origin refs

- {"anchor":"Post-merge continuous release","file":".github/workflows/post-merge-release.yml"}
- {"case":"post-merge release uses immutable pre-merge base code for fork validation","file":"test/post-merge-release.test.js"}
- {"file":"docs/architecture/story-vibepro-release-0-2-0-beta-14.md","section":"境界"}
- {"index":1,"kind":"acceptance_criteria"}

## INV-002

Release completion requires registry, dist-tag, Git tag, GitHub prerelease, fresh-install runtime identity, and documentation readback; missing evidence remains partial.

### Origin refs

- {"anchor":"gitHead","file":"scripts/post-merge-release.mjs"}
- {"case":"GRC-S-2/GRC-S-3/GRC-S-6 create and edit converge prerelease and stable metadata","file":"test/github-release-convergence.test.js"}
- {"file":"docs/architecture/story-vibepro-release-0-2-0-beta-14.md","section":"完了判定"}
- {"index":3,"kind":"acceptance_criteria"}
- {"index":4,"kind":"acceptance_criteria"}

## S-001

After the release PR is merged, the existing post-merge workflow publishes npm, reconciles tags and the GitHub prerelease, and projects documentation.

### Origin refs

- {"anchor":"publish-npm","file":".github/workflows/post-merge-release.yml"}
- {"case":"post-merge release installs dependencies before unconditional docs projection","file":"test/post-merge-release.test.js"}
- {"file":"docs/architecture/story-vibepro-release-0-2-0-beta-14.md","section":"実行順序"}
- {"index":2,"kind":"acceptance_criteria"}

## Diagrams

### Release convergence

flowchart LR
  A[Exact HEAD CI] --> B[Merge]
  B --> C[Post-merge release]
  C --> D[npm and dist-tags]
  C --> E[Git tag and GitHub prerelease]
  C --> F[Docs projection]
  D --> G[Fresh install readback]
  E --> G
