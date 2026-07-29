# UX completion review — 0d55e3b6

- status: needs_changes
- finding: high `OCR-UX-PROVIDER-RECOVERY`

The persisted JSON stop correctly contains provider, missing capabilities,
required capabilities, and `resume_run`, but the human renderer prints only the
generic stop and a status command. It must render those actionable fields and
the exact same-Run resume command.

All other UX contracts passed: canonical command/defaults, bounded Human
Decision, managed worktree, unfinished-suffix resume, repair/re-review/rebind,
and explicit human-only PR, merge, waiver, deploy, publish, and material
external effects. Fresh focused tests: 30 passed.
