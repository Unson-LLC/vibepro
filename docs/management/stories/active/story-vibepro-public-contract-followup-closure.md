---
story_id: story-vibepro-public-contract-followup-closure
vibepro_story_id: story-vibepro-residual-risk-closure
title: Public contract follow-up closure
status: active
parent_design: vibepro-residual-risk-closure
architecture_docs:
  - docs/architecture/vibepro-residual-risk-closure.md
spec_docs:
  - docs/specs/vibepro-residual-risk-closure.md
---

# Public contract follow-up closure

## Background

Senior Gap Judgment must stop carrying a public contract accepted follow-up once the current PR has contract docs, compatibility or output tests, and current verification evidence.

This child Story keeps its own `story_id`; `vibepro_story_id` binds it to the shared residual-risk-closure PR execution Story.

## Acceptance Criteria

- [ ] A public_contract axis with complete required evidence resolves as passed instead of accepted_followup.
- [ ] A public_contract accepted decision without current verification still remains visible as accepted_followup.
- [ ] PR prepare keeps the public contract evidence refs reviewable in Gate DAG and Senior Gap artifacts.
