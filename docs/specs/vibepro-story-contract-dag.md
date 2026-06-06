---
story_id: story-vibepro-story-contract-dag
title: VibePro Story Contract DAG Spec
---

# Spec

## Required Behavior

- `story derive` MUST attach `derived.story_contract` to every derived/configured story.
- `derived.story_contract` MUST include:
  - `schema_version: '0.1.0'`
  - `story_type`: one of `new_capability`, `enhancement`, `bug_fix`, `regression_fix`, `refactor`, `operational_change`, `docs_policy_change`, `quality_hardening`, `architecture_decision`, `story_contract_review`
  - `status`: `ready` or `needs_clarification`
  - `checks`: ordered check rows with `id`, `status`, `reason`, and optional `evidence`
  - `open_questions`: unresolved questions with `field` names beginning with `story_contract_`
  - `developer_boundary_hypothesis`
  - `risk_surface_hypothesis`
  - `verification_strategy`
- The Story Contract MUST be deterministic and derived from local catalog inputs only: story id/title/category/source, source paths, docs, repo profile, preset mode, story definition, business context, and existing planning questions.
- The Story Contract MUST NOT suppress stories that are explicitly backed by document evidence; it SHOULD mark weak source-role cases as `needs_clarification` instead.

## Checks

- `story_type_fit`: confirms the story is classified into a development-relevant type.
- `source_role_integrity`: confirms source evidence is being used in the right role. In particular, if a product template story is generated from document-only evidence in a repo whose profile is not product-surface-applicable and no preset was explicitly selected, the check MUST be `needs_clarification`.
- `business_intent`: confirms who/problem/outcome or equivalent intent exists.
- `developer_boundary`: confirms there is enough code/spec/architecture/doc evidence to form a boundary hypothesis.
- `acceptance_examples`: confirms acceptance focus or explicit examples exist.
- `verification_strategy`: confirms VibePro can name a verification approach before implementation.

## Story Plan Integration

- `story plan` MUST prioritize stories with unresolved Story Contract questions.
- `story plan.source_alignment_findings` MUST include a high-severity finding for `story_contract_source_role`.
- `story plan.task_candidates` MUST include a `story-contract-recovery` candidate when the contract is unresolved.
- Existing source recovery, Graphify, spec, and architecture findings MUST remain intact.

## Invariants

- `INV-SC-1`: Story Contract is advisory planning evidence. It MUST NOT mutate repository files or mark gates as failed by itself.
- `INV-SC-2`: Explicit preset selection remains an opt-in to product template stories, but Story Contract may still expose missing business/verification evidence.
- `INV-SC-3`: Document evidence remains usable. The new behavior distinguishes "document explicitly says product requirement" from "document merely contains product-like vocabulary".
- `INV-SC-4`: JSON output must remain backward compatible; existing fields are preserved.
- `INV-SC-5`: Existing architecture-profile story derivation for `profile.has_auth` and `views.security.auth_boundaries` MUST remain inherited behavior; this story does not change how `story-security-auth-boundary` is derived from auth/security architecture signals.
- `INV-SC-6`: Existing Story Manager signature-helper handling for `hasSignatureHelper` MUST remain inherited behavior; this story does not change auth/webhook signature helper detection or the `!hasSignatureHelper` fallback path.

## Non Goals

- Replacing Story/Spec/Architecture documents.
- Introducing external LLM calls in `story derive`.
- Changing PR creation readiness.
- Changing architecture-profile auth/security story derivation.
- Changing Story Manager signature helper or webhook signature review behavior.
