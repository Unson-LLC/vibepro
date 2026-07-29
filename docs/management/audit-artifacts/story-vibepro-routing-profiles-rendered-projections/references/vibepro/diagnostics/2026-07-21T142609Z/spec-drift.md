# Spec Drift

- Status: drift_detected
- Story: story-vibepro-routing-profiles-rendered-projections
- Evaluated at: 2026-07-21T14:26:14.157Z

| Axis | Count |
|------|-------|
| spec_code_drift | 0 |
| spec_test_drift | 1 |
| code_test_drift | 0 |
| spec_pr_drift | 0 |

## Items

### DRIFT-4YSLQL [low] (spec_test)
- Clause: INV-003
- Title: INV-003 を機械検証する test_pattern が宣言されていない
- Detail: 不変条件は test_pattern を持つことを推奨
- Suggested action: clause "INV-003" に verifiable_by.test_pattern を追加
