---
title: VibePro Agent Skill Contract Spec
status: draft
created_at: 2026-06-24
updated_at: 2026-06-24
related_stories:
  - story-vibepro-agent-skill-contract
---

# VibePro Agent Skill Contract Spec

## CLI

`vibepro skills lint [repo] [--json]`

The command validates bundled VibePro skills and returns:

- `mode: "lint"`
- `overall_status: "pass" | "fail"`
- `skills[]` with `name`, `status`, `issues[]`, and section coverage
- `summary` counts by status and issue severity

## Required Skill Structure

Every bundled Skill MUST include:

- YAML frontmatter with `name` and `description`
- `## When to Use`
- at least one workflow/process section
- `## Common Rationalizations`
- `## Red Flags`
- `## Verification`

`Common Rationalizations` MUST name shortcuts or excuses the agent should reject.

`Red Flags` MUST name observable conditions that should trigger a finding, blocker, added evidence, split, or waiver decision.

`Verification` MUST describe the evidence that proves the Skill was applied correctly.

## Agent Harness

`vibepro check agent-harness` MUST include the lint result as `skills_contract`. If lint fails, the check status becomes at least `needs_review` and emits `vibepro_skill_contract_failed` findings.

## Agent Review Prompt

Generated review requests and parallel dispatch instructions MUST include an Agent Skill Discipline section with:

- common rationalizations to reject
- red flags to treat as findings
- required evidence shape

The reviewer MUST not return `pass` when a required evidence input is missing, a red flag remains unresolved, or the verdict only relies on generic confidence.

## Definition of Done Gate

`gate:definition_of_done` MUST be in the PR Gate DAG.

The gate is required when source or test files changed. It is not required for docs-only changes.

Required gate pass conditions:

- at least one current-head passing verification command or observation exists
- required Agent Review is not unresolved
- the gate records rejected common rationalizations and red flags

When missing evidence exists, the gate status MUST be `needs_evidence` and `gate_status.next_required_actions` MUST include an action for Definition of Done closure.

## Non-goals

- Do not vendor external agent-skills content into bundled VibePro skills.
- Do not treat skill lint pass as implementation verification.
- Do not allow manual review records to satisfy required parallel subagent review.
