<!-- vibepro-projection story_id=story-vibepro-accepted-spec-traceability feature_slug=accepted-spec-traceability ownership=generated profile=feature_packet source=.vibepro/spec/story-vibepro-accepted-spec-traceability/spec.json source_sha256=a3d57ea82985dad7059cceeaf759a8745455ef0d338351465b32563c6373aaf5 renderer=functional_spec_markdown@1 direct_edit=false -->
- Canonical ownership: generated

# Functional Spec

- Story: story-vibepro-accepted-spec-traceability
- Status: -
- Clauses: 12

## INV-001

Canonical accepted-spec authority is resolved from the target HEAD tree and records HEAD SHA, path, and blob OID.

### Origin refs

- {"ac_id":"ASTR-AC-001","kind":"acceptance_criteria"}
- {"anchor":"buildAcceptedSpecClauseMap","file":"src/traceability.js"}
- {"case":"Issue #454 projects 12 accepted-spec clauses and provenance identically to all PR artifacts","file":"test/accepted-spec-traceability.test.js"}

## INV-002

Story identity and stable AC ids resolve only by exact identity.

### Origin refs

- {"ac_id":"ASTR-AC-002","kind":"acceptance_criteria"}
- {"anchor":"stableStoryRefId","file":"src/traceability.js"}
- {"case":"Issue #454 lineage resolver fails closed with explicit reasons and keeps verification separate","file":"test/accepted-spec-traceability.test.js"}

## INV-003

Test file and case resolve against the named test blob at target HEAD.

### Origin refs

- {"ac_id":"ASTR-AC-003","kind":"acceptance_criteria"}
- {"anchor":"nodeTestCaseExists","file":"src/traceability.js"}
- {"case":"Issue #454 lineage resolver fails closed with explicit reasons and keeps verification separate","file":"test/accepted-spec-traceability.test.js"}

## INV-004

Invariant test patterns are evaluated from target HEAD blobs and failed patterns never map.

### Origin refs

- {"ac_id":"ASTR-AC-004","kind":"acceptance_criteria"}
- {"anchor":"testPatternMatchesHead","file":"src/traceability.js"}
- {"case":"Issue #454 lineage resolver fails closed with explicit reasons and keeps verification separate","file":"test/accepted-spec-traceability.test.js"}

## INV-005

A scenario with an exact test reference remains eligible without a test_pattern.

### Origin refs

- {"ac_id":"ASTR-AC-005","kind":"acceptance_criteria"}
- {"anchor":"buildAcceptedSpecClauseMap","file":"src/traceability.js"}
- {"case":"Issue #454 projects 12 accepted-spec clauses and provenance identically to all PR artifacts","file":"test/accepted-spec-traceability.test.js"}

## INV-006

The regression fixture proves twelve one-to-one accepted-spec mappings, with nine invariant patterns and three patternless scenarios.

### Origin refs

- {"ac_id":"ASTR-AC-006","kind":"acceptance_criteria"}
- {"case":"Issue #454 projects 12 accepted-spec clauses and provenance identically to all PR artifacts","file":"test/accepted-spec-traceability.test.js"}

## INV-007

PR prepare, canonical traceability, and PR body consume the same clause map and provenance.

### Origin refs

- {"ac_id":"ASTR-AC-007","kind":"acceptance_criteria"}
- {"anchor":"recordTraceabilityForPrepare","file":"src/pr-manager.js"}
- {"case":"Issue #454 projects 12 accepted-spec clauses and provenance identically to all PR artifacts","file":"test/accepted-spec-traceability.test.js"}

## INV-008

Unknown AC, missing test file, missing test case, and failed pattern produce explicit fail-closed reasons.

### Origin refs

- {"ac_id":"ASTR-AC-008","kind":"acceptance_criteria"}
- {"case":"Issue #454 lineage resolver fails closed with explicit reasons and keeps verification separate","file":"test/accepted-spec-traceability.test.js"}

## INV-009

A worktree accepted-spec that differs from or is absent from target HEAD fails closed.

### Origin refs

- {"ac_id":"ASTR-AC-009","kind":"acceptance_criteria"}
- {"case":"Issue #454 lineage resolver fails closed with explicit reasons and keeps verification separate","file":"test/accepted-spec-traceability.test.js"}

## S-001

Lineage status remains resolved while untrusted verification receives its own untrusted status and reason.

### Origin refs

- {"ac_id":"ASTR-AC-010","kind":"acceptance_criteria"}
- {"case":"Issue #454 lineage resolver fails closed with explicit reasons and keeps verification separate","file":"test/accepted-spec-traceability.test.js"}

## S-002

Legacy mapped_tests string arrays and absent-spec heuristic behavior remain compatible.

### Origin refs

- {"ac_id":"ASTR-AC-011","kind":"acceptance_criteria"}
- {"case":"Issue #454 keeps legacy heuristic behavior when accepted-spec is absent","file":"test/accepted-spec-traceability.test.js"}

## S-003

Node 22 focused and related regression checks plus repository integrity checks pass.

### Origin refs

- {"ac_id":"ASTR-AC-012","kind":"acceptance_criteria"}
- {"anchor":"runVerificationCommand","file":"src/verification-runner.js"}
- {"anchor":"CALLER_FORBIDDEN_OBSERVATION_KEYS","file":"src/verification-evidence.js"}
- {"case":"Issue #454 projects 12 accepted-spec clauses and provenance identically to all PR artifacts","file":"test/accepted-spec-traceability.test.js"}
- {"case":"verify run records the executed outcome without accepting agent status input","file":"test/verification-runner.test.js"}

## Diagrams

### Target HEAD lineage resolution

flowchart LR
  Spec[HEAD canonical accepted-spec blob] --> AC[HEAD Story AC ids]
  Spec --> Test[HEAD test file and case blobs]
  AC --> Map[Authoritative clause map]
  Test --> Map
  Map --> Prepare[pr-prepare.json]
  Map --> Trace[traceability.json]
  Map --> Body[pr-body.md]
