# Spec Drift

- Status: drift_detected
- Story: story-vibepro-process-record-worktree-durability
- Evaluated at: 2026-07-30T12:59:27.827Z

| Axis | Count |
|------|-------|
| spec_code_drift | 0 |
| spec_test_drift | 1 |
| code_test_drift | 0 |
| spec_pr_drift | 0 |

## Items

### DRIFT-TAMNAB [high] (spec_test)
- Clause: S-002
- Title: S-002.test_pattern[0].must_cover が満たされていない
- Detail: must_cover "auto-snapshot" が test/process-record-store.test.js のテストで参照されていない
- Suggested action: テストを追加するか、clause の verifiable_by.test_pattern を見直す
