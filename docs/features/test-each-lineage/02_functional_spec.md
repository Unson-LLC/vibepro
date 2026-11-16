<!-- vibepro-projection story_id=story-vibepro-test-each-lineage feature_slug=test-each-lineage ownership=generated profile=feature_packet source=.vibepro/spec/story-vibepro-test-each-lineage/spec.json source_sha256=73aa9322885614352c7f3d26c97791902a8201af96158a506b03a25a1e5899d3 renderer=functional_spec_markdown@1 direct_edit=false -->
- Canonical ownership: generated

# Functional Spec

- Story: story-vibepro-test-each-lineage
- Status: -
- Clauses: 8

## INV-001

test.each(dataset)(caseName, ...) resolves only an exact caseName in the target HEAD test blob.

### Origin refs

- {"ac_id":"TELA-AC-001","kind":"acceptance_criteria"}
- {"anchor":"parameterizedCall","file":"src/traceability.js"}
- {"case":"Issue #462 resolves test.each and it.each cases without weakening exact case matching","file":"test/accepted-spec-traceability.test.js"}

## INV-002

it.each(dataset)(caseName, ...) resolves only an exact caseName in the target HEAD test blob.

### Origin refs

- {"ac_id":"TELA-AC-002","kind":"acceptance_criteria"}
- {"anchor":"parameterizedCall","file":"src/traceability.js"}
- {"case":"Issue #462 resolves test.each and it.each cases without weakening exact case matching","file":"test/accepted-spec-traceability.test.js"}

## INV-003

A different template name remains unresolved with test_case_missing.

### Origin refs

- {"ac_id":"TELA-AC-003","kind":"acceptance_criteria"}
- {"anchor":"nodeTestCaseExists","file":"src/traceability.js"}
- {"case":"Issue #462 resolves test.each and it.each cases without weakening exact case matching","file":"test/accepted-spec-traceability.test.js"}

## INV-004

Ordinary test(caseName, ...) and it(caseName, ...) retain exact-match behavior.

### Origin refs

- {"ac_id":"TELA-AC-004","kind":"acceptance_criteria"}
- {"anchor":"directCall","file":"src/traceability.js"}
- {"case":"Issue #462 resolves test.each and it.each cases without weakening exact case matching","file":"test/accepted-spec-traceability.test.js"}

## INV-005

Accepted Spec test refs remain bound to the target HEAD file blob and preserve SHA and blob OID provenance.

### Origin refs

- {"ac_id":"TELA-AC-005","kind":"acceptance_criteria"}
- {"anchor":"cachedGitBlob","file":"src/traceability.js"}
- {"case":"Issue #454 projects 12 accepted-spec clauses and provenance identically to all PR artifacts","file":"test/accepted-spec-traceability.test.js"}

## INV-006

Targeted and related Node 22 regression tests, repository consistency checks, and document mirror checks pass.

### Origin refs

- {"ac_id":"TELA-AC-006","kind":"acceptance_criteria"}
- {"anchor":"nodeTestCaseExists","file":"src/traceability.js"}
- {"case":"Issue #462 resolves test.each and it.each cases without weakening exact case matching","file":"test/accepted-spec-traceability.test.js"}

## S-001

The frozen Zeims2 HEAD is re-evaluated without consumer changes and reports 7 of 7 Accepted Spec clauses resolved.

### Origin refs

- {"ac_id":"TELA-AC-007","kind":"acceptance_criteria"}
- {"anchor":"buildAcceptedSpecClauseMap","file":"src/traceability.js"}
- {"case":"Zeims2の固定HEADとAccepted Spec lineage集計を維持する","file":"scripts/validation/issue-462-zeims2-lineage.integration.test.mjs"}

## S-002

After implementation review, CI, and merge, the fix is published as a new immutable VibePro version through a separate release Story.

### Origin refs

- {"ac_id":"TELA-AC-008","kind":"acceptance_criteria"}
- {"anchor":"nodeTestCaseExists","file":"src/traceability.js"}
- {"case":"Issue #462 resolves test.each and it.each cases without weakening exact case matching","file":"test/accepted-spec-traceability.test.js"}

## Diagrams

- none
