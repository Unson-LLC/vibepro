---
story_id: story-vibepro-meeting-minutes-editor-prompt
title: Meeting Minutes Editor Skill Spec
parent_design: vibepro-meeting-minutes-editor-prompt
diagrams:
  - kind: flow
    title: Meeting minutes generation contract
    mermaid: |
      flowchart TD
        Inputs["Meeting sources"] --> Complete{"Transcript and attachments available?"}
        Complete -->|No| Block["Disclose missing inputs / block full minutes"]
        Complete -->|Yes| Type["Infer meeting type"]
        Type --> Synopsis["Write edited synopsis"]
        Synopsis --> Sections["Issue-based sections"]
        Sections --> Actions["Source-backed actions"]
        Sections --> Downstream["Task / Decision extraction"]
    rationale: "Flow diagram for the boundary between source retrieval, edited meeting note generation, and downstream extraction."
---

# Spec

## Invariants

- `MME-INV-1`: The skill MUST treat meeting minutes as an edited business document, not as a transcript summary or task candidate list.
- `MME-INV-2`: The skill MUST require source completeness checks for transcripts, Slack attachments, recordings, and referenced documents before generating a full note.
- `MME-INV-3`: The skill MUST NOT force every meeting into one fixed package or heading set.
- `MME-INV-4`: The skill MUST keep task and decision extraction downstream of the coherent meeting note.
- `MME-INV-5`: Missing owner or due-date information MUST remain unknown rather than being invented.

## Contracts

- `MME-CONTRACT-1`: `vibepro-meeting-minutes-editor` MUST include frontmatter `name` and `description`.
- `MME-CONTRACT-2`: `vibepro-meeting-minutes-editor` MUST include `When to Use`, a process section, `Common Rationalizations`, `Red Flags`, and `Verification`.
- `MME-CONTRACT-3`: The skill MUST include guidance for exemplar-driven prompt reverse engineering.
- `MME-CONTRACT-4`: The skill MUST call out Slack attachment and transcript retrieval failures as user-visible blockers or partial-input conditions.
- `MME-CONTRACT-5`: Public README files MUST mention the bundled skill in the AI Agent Setup list.

## Scenarios

- `MME-S-1`: Given bundled skills are listed, when `vibepro skills list` runs, then `vibepro-meeting-minutes-editor` appears.
- `MME-S-2`: Given an empty target repo, when `vibepro skills install <repo>` runs, then `.claude/skills/vibepro-meeting-minutes-editor/SKILL.md` is installed.
- `MME-S-3`: Given bundled skills are linted, when `vibepro skills lint <repo>` runs, then the new skill passes the Agent Skill Contract.
- `MME-S-4`: Given meeting sources are incomplete, when the skill is followed, then the output discloses missing transcripts or attachments instead of producing polished generic minutes.
- `MME-S-5`: Given exemplar minutes are supplied, when the skill is followed, then the agent infers writing standards and meeting type before choosing structure.

## Anti-patterns

- `MME-AP-1`: Do not write a VibePro runtime meeting generator without owning the source-ingestion boundary.
- `MME-AP-2`: Do not use quality-gate pass status as a substitute for prose quality.
- `MME-AP-3`: Do not generate owners, due dates, or strategic claims that are absent from source material.
- `MME-AP-4`: Do not make `Core Synopsis` mandatory for every meeting.

## Verification

- `MME-V-1`: Focused CLI test covers skills list/install/verify behavior for `vibepro-meeting-minutes-editor`.
- `MME-V-2`: `vibepro skills lint . --json` passes with the new bundled skill.
- `MME-V-3`: `npm run typecheck` verifies changed JavaScript syntax remains valid.
- `MME-V-4`: `npm run docs:build` validates README-linked documentation build compatibility.
