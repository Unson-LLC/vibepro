# Spec Drift

- Status: drift_detected
- Story: story-vibepro-codex-host-containment-test-load-tolerance
- Evaluated at: 2026-08-02T20:16:19.712Z

| Axis | Count |
|------|-------|
| spec_code_drift | 0 |
| spec_test_drift | 1 |
| code_test_drift | 0 |
| spec_pr_drift | 0 |

## Items

### DRIFT-D8UNG7 [low] (spec_test)
- Clause: INV-002
- Title: INV-002 を機械検証する test_pattern が宣言されていない
- Detail: 不変条件は test_pattern を持つことを推奨
- Suggested action: clause "INV-002" に verifiable_by.test_pattern を追加
