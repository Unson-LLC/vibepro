---
name: vibepro-meeting-minutes-editor
description: Use when generating, reviewing, or repairing Japanese business meeting minutes from transcripts, Slack attachments, recordings, or Meeting Pack inputs.
---

# VibePro Meeting Minutes Editor

## Purpose

Use this Skill to turn meeting source material into an edited business document, not a shallow transcript summary. The output should read like a usable executive meeting note: it explains the strategic context, the stakes, the real decisions, and the next moves in language that someone absent from the meeting can act on.

## When to Use

Use this Skill when the user asks for 議事録, meeting notes, Meeting Pack output, transcript summarization, Slack-attached meeting material, or a quality review of generated minutes.

Use it especially when the user provides exemplar minutes and expects the agent to reverse-engineer the writing standard instead of forcing the output into a fixed package template.

## Required Workflow

1. Confirm source completeness before writing.
   - Check whether the transcript, attached files, recording-derived text, chat context, and referenced Slack thread are actually available.
   - If transcript or attachment retrieval failed, mark the note as blocked or incomplete. Do not fill the gap with generic topics or task candidates.
2. Infer the meeting type before choosing structure.
   - Strategy / negotiation / sales / project governance / marketing operations / technical planning each need different sectioning.
   - Do not force every meeting into `Core Synopsis`, `Action Items`, or any single package shape.
3. Write the opening as an edited synopsis.
   - Explain what the meeting was trying to settle, why it matters, what direction emerged, and which dependencies or risks remain.
   - Prefer concrete business nouns over process filler such as "議論しました" or "確認しました".
4. Organize the body by issue, not by chronology.
   - Each major section should have a meaningful title that names the actual strategic or operational issue.
   - Within each section, explain background, the competing views or constraints, the practical decision, and implications.
5. Preserve the meeting's reasoning.
   - Include why a decision makes sense, what tradeoff was accepted, and what uncertainty remains.
   - Do not reduce the note to a list of tasks, labels, or isolated facts.
6. Extract action items after the narrative is coherent.
   - Group by owner only when owners are present in the source.
   - Use `[TBD]` for unknown due dates instead of inventing dates.
   - Do not invent owners to satisfy a table format.
7. Derive decisions, risks, and follow-ups from the finished note.
   - Task/Decision candidates are downstream artifacts. They must not be the primary shape of the minutes.

## Writing Standard

- Use Japanese business prose with enough density for a decision maker.
- Make the first paragraph useful even when read alone.
- Use section headings that would still make sense in a board memo or client delivery note.
- Keep speaker names only when attribution changes responsibility, commitment, or risk.
- Translate transcript fragments into clear business language, while preserving factual limits.
- When the source is thin, say what is missing and avoid polished-looking hallucination.

## Output Patterns

Choose the pattern that matches the source:

- Strategic meeting: `Core Synopsis` followed by issue-based sections and `次の打ち手`.
- Operational meeting: narrative overview followed by concrete workstream sections and owner-grouped action items.
- Client / sales meeting: commercial context, client need, proposed value, blockers, next contact points.
- Governance / project meeting: mandate, data sources, operating model, risks, execution structure, next actions.

These are patterns, not mandatory templates. A good note may omit `Core Synopsis` when a natural title and opening paragraph work better.

## Common Rationalizations

- "The quality gate passed, so the minutes are acceptable." Reject this; gate status does not prove the prose is a usable meeting document.
- "Tasks and decisions were extracted, so the minutes are done." Tasks are downstream. The main note must first explain the meeting's substance.
- "The transcript was unavailable, but Slack context is enough." Missing transcript or attachments must stay visible unless the user explicitly accepts a partial note.
- "Every output should use the same existing package." Exemplars define a writing standard; they do not require one fixed template.
- "Speaker 1 / Speaker 2 is fine." Keep generic speaker labels only when the source has no reliable identity and attribution is still necessary.

## Red Flags

- The note starts with generic process language and does not say what was actually at stake.
- Headings are generic, chronological, or package-driven instead of issue-driven.
- The output contains plausible business themes not present in the source.
- Action items have invented owners or dates.
- Slack attachments, audio transcripts, or linked documents failed to load but the output does not disclose that.
- The note reads like candidate tasks for Mac Companion rather than like a meeting note for a human reader.

## Verification

Before presenting or approving generated minutes, check:

- Source completeness: transcript and attachments were retrieved, or missing inputs are explicitly marked.
- Narrative quality: the opening identifies the core topic, stakes, direction, and unresolved dependencies.
- Structural fit: sections reflect the meeting's real issues rather than a fixed template.
- Evidence boundary: every concrete claim can be traced to transcript, attachment, Slack context, or user-provided exemplar.
- Action item integrity: owners and due dates are source-backed, otherwise left unknown.
- Downstream extraction: task/decision candidates are derived from the final minutes, not used as a substitute for them.
