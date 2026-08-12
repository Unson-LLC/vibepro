<!-- vibepro-projection story_id=story-vibepro-release-0-2-0-beta-7 feature_slug=release-0-2-0-beta-7 ownership=generated profile=feature_packet source=.vibepro/spec/story-vibepro-release-0-2-0-beta-7/spec.json source_sha256=bb80638d5f1dfc228c53f1febf59ca38ff1f7ff8e2b7738cb3d9d7d5aa0d9772 renderer=functional_spec_markdown@1 direct_edit=false -->
- Canonical ownership: generated

# Functional Spec

- Story: story-vibepro-release-0-2-0-beta-7
- Status: -
- Clauses: 4

## C-001

package.json and the package-lock root package declare 0.2.0-beta.7, and the CLI version output resolves to the same value.

### Origin refs

- {"ac_id":"REL7-AC-001","kind":"acceptance_criteria"}
- {"anchor":"\"version\": \"0.2.0-beta.7\"","file":"package-lock.json"}
- {"anchor":"\"version\": \"0.2.0-beta.7\"","file":"package.json"}
- {"case":"--version prints the package version","file":"test/vibepro-cli.test.js"}

## INV-001

The release change is metadata and release evidence only; it does not change src, bin, dependencies, or publication workflow behavior.

### Origin refs

- {"ac_id":"REL7-AC-002","kind":"acceptance_criteria"}
- {"anchor":"## 境界","file":"docs/architecture/story-vibepro-release-0-2-0-beta-7.md"}
- {"case":"post-merge release uses the trusted default-branch workflow for fork merges","file":"test/post-merge-release.test.js"}

## INV-002

Release completion requires npm gitHead, beta and latest dist-tags, and the GitHub Release target to identify the same release merge commit; rollback deprecates beta.7 and restores both tags without unpublishing.

### Origin refs

- {"ac_id":"REL7-AC-004","kind":"acceptance_criteria"}
- {"anchor":"## 可観測性","file":"docs/architecture/story-vibepro-release-0-2-0-beta-7.md"}
- {"anchor":"assertGitHead","file":"scripts/post-merge-release.mjs"}
- {"case":"PCR-CON-006 rejects an existing version with another gitHead","file":"test/post-merge-release.test.js"}

## S-001

When the version-bump PR merges, post-merge release validates the exact merge commit with typecheck, the full test suite, and npm pack dry-run before publishing npm and the GitHub prerelease.

### Origin refs

- {"ac_id":"REL7-AC-003","kind":"acceptance_criteria"}
- {"anchor":"publish-npm","file":".github/workflows/post-merge-release.yml"}
- {"case":"post-merge release uses the trusted default-branch workflow for fork merges","file":"test/post-merge-release.test.js"}

## Diagrams

### Immutable beta publication

flowchart LR
  PR[Version bump PR] --> Merge[Exact merge commit]
  Merge --> Validate[Typecheck + full tests + pack]
  Validate --> Npm[npm 0.2.0-beta.7]
  Validate --> Release[GitHub prerelease]
  Npm --> Verify[gitHead + beta/latest verification]
  Release --> Verify
