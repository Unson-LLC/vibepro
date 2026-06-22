---
story_id: story-vibepro-traceability-ac-to-code-map
title: Traceability AC-to-code Map Spec
---

# Spec

## Required Behavior

- `TACTM-001`: `traceability.json` MUST include `acceptance_criteria[]`.
- `TACTM-002`: each AC item MUST include source text, source location when available, status, mapped files, mapped tests, and mapped evidence.
- `TACTM-003`: scenario clauses MUST be represented with the same mapping shape when available.
- `TACTM-004`: ACs with only broad or generic verification MUST be `weakly_mapped`, not `mapped`.
- `TACTM-005`: ACs without changed file, test, or evidence binding MUST be `unmapped`.
- `TACTM-006`: PR body, Gate DAG, and usage report MUST show unmapped and weakly mapped counts.

## Scenarios

- `S-001`: Given a Story has ACs and only PR artifact presence, when traceability is generated, then ACs are not treated as mapped.
- `S-002`: Given a test file references an AC and verification evidence targets that test, when traceability is generated, then the AC is mapped with current-bound evidence.
- `S-003`: Given a scenario clause has no test or verification binding, when Gate DAG renders traceability, then the scenario appears as missing or weakly covered.
