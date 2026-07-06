# Spec Drift

- Status: drift_detected
- Story: story-vibepro-design-input-judgment
- Evaluated at: 2026-07-04T19:37:26.682Z

| Axis | Count |
|------|-------|
| spec_code_drift | 0 |
| spec_test_drift | 1 |
| code_test_drift | 0 |
| spec_pr_drift | 0 |

## Items

### DRIFT-HTVT45 [low] (spec_test)
- Clause: INV-001
- Title: INV-001 を機械検証する test_pattern が宣言されていない
- Detail: 不変条件は test_pattern を持つことを推奨
- Suggested action: clause "INV-001" に verifiable_by.test_pattern を追加
