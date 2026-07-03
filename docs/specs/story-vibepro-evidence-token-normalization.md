---
story_id: story-vibepro-evidence-token-normalization
title: Evidence Token Normalization Spec
parent_design: vibepro-evidence-token-normalization
diagrams:
  - kind: classifier_flow
    mermaid: |
      flowchart LR
        Record["verify record observation"] --> Text["targets + scenarios + observed key/value"]
        Text --> Normalize["canonical token normalization"]
        Normalize --> Judgment["judgment evidence kinds"]
        Normalize --> FailureMode["failure-mode coverage"]
        Judgment --> Gate["Gate DAG feedback"]
        FailureMode --> Gate
---

# Spec

## Contracts

### ETN-CONTRACT-001: Canonical token allowlist

The classifier MUST normalize these evidence concepts across underscore, hyphen, and
space variants:

- `negative_path`
- `boundary_condition`
- `parse_failure`
- `auth_denied`
- `permission_denied`

### ETN-CONTRACT-002: Consistent observation field coverage

Normalization MUST apply to the search text assembled from observation targets,
observation scenarios, observed keys, and observed values.

### ETN-CONTRACT-003: Existing natural-language matching

Existing natural-language regex matches such as `negative`, `boundary`, `forbidden`,
`unauthorized`, `parse`, and `malformed` MUST continue to classify evidence as before.

### ETN-CONTRACT-004: Failure-mode coverage

Failure-mode scoring MUST treat canonical token variants as the mode id for supported
failure modes. Evidence containing `parse-failure` or `parse failure` MUST cover the
`parse_failure` mode.

### ETN-CONTRACT-005: Feedback guidance

When failure-mode evidence is missing, Gate feedback MUST expose accepted canonical
evidence terms so the next `verify record` command can use stable vocabulary.

## Test Requirements

- Regression tests classify `negative_path`, `negative-path`, and `negative path` as `negative_path`.
- Regression tests classify `boundary_condition`, `boundary-condition`, and `boundary condition` as `boundary_condition`.
- Regression tests show `parse_failure`, `parse-failure`, or `parse failure` covers the `parse_failure` failure mode.
- Regression tests prove observation key/value, scenario, and target fields share the same normalization path.
