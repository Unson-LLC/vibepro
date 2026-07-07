---
story_id: story-vibepro-pr-body-limit-guard
title: PR Body Limit Guard Spec
parent_design: vibepro-pr-body-limit-guard
---

# Spec: PR Body Limit Guard

## Invariants

- `PBL-INV-001`: `vibepro pr create` MUST NOT pass a body file over 65,536 characters to GitHub PR create or edit commands.
- `PBL-INV-002`: Generated `pr-body.md` remains the audit artifact even when GitHub receives a compressed body.
- `PBL-INV-003`: `pr-create.json` records both generated and posted body paths and their character and byte counts.
- `PBL-INV-004`: Body limit handling MUST NOT change Gate DAG readiness, gate override semantics, push behavior, or existing PR refresh head matching.

## Contracts

- `PBL-CONTRACT-001`: If generated body length is within `limit_characters`, `execution.body_file` equals `execution.generated_body_file`.
- `PBL-CONTRACT-002`: If generated body length exceeds `limit_characters`, `execution.body_file` points to `.vibepro/pr/<story-id>/pr-body.github.md`.
- `PBL-CONTRACT-003`: The posted body includes artifact references for `pr-body.md`, `pr-prepare.json`, `decision-index.json`, and `gate-dag.json`.
- `PBL-CONTRACT-004`: `execution.pr_body_limit.status` is `within_limit` or `truncated`, never inferred from command failure text.

## Scenarios

- `PBL-SCENARIO-001`: Given a generated PR body over 65,536 characters, when `vibepro pr create --dry-run` runs, then the planned `gh pr create` command uses `pr-body.github.md`, the posted body is under the limit, and `pr-create.json` records truncation metadata.
- `PBL-SCENARIO-002`: Given a normal generated PR body under 65,536 characters, when `vibepro pr create` runs, then the existing `pr-body.md` path is used and metadata reports `within_limit`.
- `PBL-SCENARIO-003`: Given an existing open PR refresh path, when body compression is required, then `gh pr edit --body-file` uses the same compressed body file selected before the initial create attempt.

## Anti-patterns

- `PBL-AP-001`: Retrying failed GitHub commands and guessing body-limit failure from stderr instead of preflighting the local body file.
- `PBL-AP-002`: Deleting or replacing the generated audit `pr-body.md` with a lossy body.
- `PBL-AP-003`: Expanding Gate DAG, Agent Review, or audit logs directly into the GitHub body when artifact links are sufficient.

## Verification

- `PBL-VERIFY-001`: A CLI regression test creates a body over the GitHub limit and asserts `pr_body_limit.status=truncated`, posted character count <= 65,536, and `body_file=pr-body.github.md`.
- `PBL-VERIFY-002`: Existing PR create and existing PR refresh tests continue to assert the command timeline and artifact freshness behavior.
