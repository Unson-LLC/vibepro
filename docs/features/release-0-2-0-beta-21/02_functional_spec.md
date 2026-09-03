<!-- vibepro-projection story_id=story-vibepro-release-0-2-0-beta-21 feature_slug=release-0-2-0-beta-21 ownership=generated profile=feature_packet source=.vibepro/spec/story-vibepro-release-0-2-0-beta-21/spec.json source_sha256=67e9583fcabb800a734bbac2aaaf16a6bcfaab849e336d95f45932f150a55b41 renderer=functional_spec_markdown@1 direct_edit=false -->
- Canonical ownership: generated

# Functional Spec

- Story: story-vibepro-release-0-2-0-beta-21
- Status: -
- Clauses: 3

## C-001

package.json, package-lock.json, and CLI version declare 0.2.0-beta.21.

### Origin refs

- {"ac_id":"REL21-AC-001","kind":"acceptance_criteria"}
- {"anchor":"0.2.0-beta.21","file":"package-lock.json"}
- {"anchor":"0.2.0-beta.21","file":"package.json"}
- {"case":"beta.21 release metadata and CLI report the exact candidate version","file":"test/vibepro-cli.test.js"}
- {"file":"docs/architecture/story-vibepro-release-0-2-0-beta-21.md","section":"境界"}

## C-002

Candidate tests, typecheck, and npm pack dry-run pass before merge.

### Origin refs

- {"ac_id":"REL21-AC-002","kind":"acceptance_criteria"}
- {"anchor":"prepack","file":"package.json"}
- {"case":"beta.21 release metadata and CLI report the exact candidate version","file":"test/vibepro-cli.test.js"}
- {"file":"docs/architecture/story-vibepro-release-0-2-0-beta-21.md","section":"実行順序"}

## S-001

After merge, npm, GitHub release and fresh install converge on one source SHA.

### Origin refs

- {"ac_id":"REL21-AC-003","kind":"acceptance_criteria"}
- {"anchor":"gitHead","file":"scripts/post-merge-release.mjs"}
- {"case":"GRC-S-2/GRC-S-3/GRC-S-6 create and edit converge prerelease and stable metadata","file":"test/github-release-convergence.test.js"}
- {"file":"docs/architecture/story-vibepro-release-0-2-0-beta-21.md","section":"完了判定"}

## Diagrams

- none
