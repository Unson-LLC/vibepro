<!-- vibepro-projection story_id=story-vibepro-release-0-2-0-beta-6 feature_slug=release-0-2-0-beta-6 ownership=generated profile=feature_packet source=.vibepro/spec/story-vibepro-release-0-2-0-beta-6/spec.json source_sha256=fea21dbeea9b536cefe361c291e73d9585691af6eaf83eb4ec59b01363378042 renderer=functional_spec_markdown@1 direct_edit=false -->
- Canonical ownership: generated

# Functional Spec

- Story: story-vibepro-release-0-2-0-beta-6
- Status: -
- Clauses: 4

## C-001

package.json and the package-lock root package declare 0.2.0-beta.6, and the CLI version output resolves to the same value.

### Origin refs

- {"anchor":"\"version\": \"0.2.0-beta.6\"","file":"package-lock.json"}
- {"anchor":"\"version\": \"0.2.0-beta.6\"","file":"package.json"}
- {"kind":"acceptance_criteria"}

## INV-001

The release change is metadata and release evidence only; it does not change src, bin, dependencies, or publication workflow behavior.

### Origin refs

- {"anchor":"## 境界","file":"docs/architecture/story-vibepro-release-0-2-0-beta-6.md"}
- {"kind":"acceptance_criteria"}

## INV-002

Release completion requires npm gitHead, beta and latest dist-tags, and the GitHub Release target to identify the same release merge commit; rollback deprecates beta.6 and restores both tags without unpublishing.

### Origin refs

- {"anchor":"## 可観測性","file":"docs/architecture/story-vibepro-release-0-2-0-beta-6.md"}
- {"anchor":"assertGitHead","file":"scripts/post-merge-release.mjs"}
- {"kind":"acceptance_criteria"}

## S-001

When the version-bump PR merges, post-merge release validates the exact merge commit with typecheck, the full test suite, and npm pack dry-run before publishing npm and the GitHub prerelease.

### Origin refs

- {"anchor":"publish-npm","file":".github/workflows/post-merge-release.yml"}
- {"kind":"acceptance_criteria"}

## Diagrams

### Immutable beta publication

flowchart LR
  PR[Version bump PR] --> Merge[Exact merge commit]
  Merge --> Validate[Typecheck + full tests + pack]
  Validate --> Npm[npm 0.2.0-beta.6]
  Validate --> Release[GitHub prerelease]
  Npm --> Verify[gitHead + beta/latest verification]
  Release --> Verify
