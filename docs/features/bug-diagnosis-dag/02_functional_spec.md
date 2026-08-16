<!-- vibepro-projection story_id=story-vibepro-bug-diagnosis-dag feature_slug=bug-diagnosis-dag ownership=generated profile=feature_packet source=.vibepro/spec/story-vibepro-bug-diagnosis-dag/spec.json source_sha256=1a3388cc4849fde3830192e9590416eae7aeb18d3fe4b240f0d7e8e1ec8a5959 renderer=functional_spec_markdown@1 direct_edit=false -->
- Canonical ownership: generated

# Functional Spec

- Story: story-vibepro-bug-diagnosis-dag
- Status: -
- Clauses: 6

## C-001

A bug Story diagnosis artifact records its Story id, run id, target HEAD, and all ordered node results in the durable process-record store. Derived Stories preserve their inferred bug contract type. Every accepted node must be bound to that target HEAD, and PR preparation rejects evidence for an older HEAD.

### Origin refs

- {"anchor":"STORY_SCOPED_RECORD_CLASSES","file":"src/process-record-store.js"}
- {"anchor":"contract_type","file":"src/story-manager.js"}
- {"anchor":"createBugDiagnosisEvidence","file":"src/bug-diagnosis-dag.js"}
- {"case":"a diagnosis accepted at an older HEAD becomes blocked before PR preparation","file":"test/integration/bug-diagnosis-pr-readiness.test.js"}
- {"case":"re-recording only one node at a newer HEAD cannot upgrade mixed-HEAD evidence","file":"test/bug-diagnosis-dag.test.js"}
- {"case":"records survive worktree deletion","file":"test/process-record-store.test.js"}
- {"case":"story derive creates a repo-wide story catalog","file":"test/vibepro-cli.test.js"}
- {"index":0,"kind":"acceptance_criteria","text_snippet":"BUG-DAG-AC-001"}

## C-002

The execution DAG connects every bug diagnosis node between implementation_started and implementation_complete before existing verification and review nodes.

### Origin refs

- {"anchor":"execution_dag","file":"src/pr-manager.js"}
- {"anchor":"implementationEdges","file":"src/managed-worktree.js"}
- {"case":"execution plan exposes the ordered diagnosis nodes","file":"test/bug-diagnosis-dag.test.js"}
- {"index":2,"kind":"acceptance_criteria","text_snippet":"BUG-DAG-AC-003"}

## C-003

A blocked diagnosis reports the first unmet node as return_to_node and provides a next action bound to the Story and run.

### Origin refs

- {"anchor":"return_to_node","file":"src/bug-diagnosis-dag.js"}
- {"case":"requires same-path reverification","file":"test/bug-diagnosis-dag.test.js"}
- {"index":4,"kind":"acceptance_criteria","text_snippet":"BUG-DAG-AC-005"}

## C-004

The deprecated verify-first command accepts only registered bug Stories and delegates to the same story diagnosis implementation without creating a second DAG.

### Origin refs

- {"anchor":"executeStoryDiagnosis","file":"src/cli.js"}
- {"case":"deprecated verify-first entry routes","file":"test/bug-diagnosis-dag.test.js"}
- {"index":5,"kind":"acceptance_criteria","text_snippet":"BUG-DAG-AC-006"}

## INV-001

A bug Story remains blocked until reproduction, root cause, regression proof or justified inapplicability, root fix, and same-path reverification are accepted in order.

### Origin refs

- {"anchor":"evaluateBugDiagnosisEvidence","file":"src/bug-diagnosis-dag.js"}
- {"case":"fails closed, selects only necessary analyses","file":"test/bug-diagnosis-dag.test.js"}
- {"index":1,"kind":"acceptance_criteria","text_snippet":"BUG-DAG-AC-002"}

## S-001

When unit verification passes but reproduction evidence is missing, pr prepare persists blocked and pr create refuses the PR.

### Origin refs

- {"anchor":"PR creation blocked","file":"src/pr-manager.js"}
- {"case":"passing unit test cannot make a bug Story PR-ready","file":"test/integration/bug-diagnosis-pr-readiness.test.js"}
- {"index":3,"kind":"acceptance_criteria","text_snippet":"BUG-DAG-AC-004"}

## Diagrams

### flow

flowchart LR
  Story[Bug Story] --> Diagnose[Diagnosis nodes]
  Diagnose --> Implementation[Implementation complete]
  Implementation --> Verify[Verification]
  Verify --> Review[Review]
  Review --> PR[PR create]
