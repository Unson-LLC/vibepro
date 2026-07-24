# runtime_contract independent review

- reviewed_head: `639360c81283a7993f9ef736a554a1c309dd5269`
- lifecycle_id: `45b25272-a21e-4a1b-bcad-93f12b03eb02`
- agent_id: `/root/ocr_runtime_639_final`
- verdict: `needs_changes`

The main runtime contract was sound, but `applyControllerEscape` always persisted
the legacy-only `pr_prepare` resume node. Under the canonical autonomous action
profile, resolving the advertised Human Decision therefore resumed into
`invalid_resume_node`.

Required repair:

- select a resume node that belongs to the active action profile;
- preserve legacy `pr_prepare` behavior;
- add canonical autonomous no-progress escape, Human Decision resolution, and
  resumed orchestration regression coverage.

The repair was implemented in commit `d8383707` by selecting `diagnose` for the
autonomous profile while preserving `pr_prepare` for legacy, with a focused
regression in `test/guarded-run-session.test.js`.
