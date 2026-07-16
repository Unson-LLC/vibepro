# Spec Drift

- Status: drift_detected
- Story: story-vibepro-manual-control-plane-refresh
- Evaluated at: 2026-07-15T06:30:53.538Z

| Axis | Count |
|------|-------|
| spec_code_drift | 0 |
| spec_test_drift | 2 |
| code_test_drift | 0 |
| spec_pr_drift | 0 |

## Items

### DRIFT-MLRC58 [low] (spec_test)
- Clause: INV-001
- Title: INV-001 を機械検証する test_pattern が宣言されていない
- Detail: 不変条件は test_pattern を持つことを推奨
- Suggested action: clause "INV-001" に verifiable_by.test_pattern を追加

### DRIFT-WTGDT7 [low] (spec_test)
- Clause: INV-003
- Title: INV-003 を機械検証する test_pattern が宣言されていない
- Detail: 不変条件は test_pattern を持つことを推奨
- Suggested action: clause "INV-003" に verifiable_by.test_pattern を追加
