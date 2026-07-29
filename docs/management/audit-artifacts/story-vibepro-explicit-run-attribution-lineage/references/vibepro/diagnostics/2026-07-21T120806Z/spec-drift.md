# Spec Drift

- Status: drift_detected
- Story: story-vibepro-explicit-run-attribution-lineage
- Evaluated at: 2026-07-21T12:09:51.271Z

| Axis | Count |
|------|-------|
| spec_code_drift | 2 |
| spec_test_drift | 3 |
| code_test_drift | 0 |
| spec_pr_drift | 0 |

## Items

### DRIFT-BH4M4S [low] (spec_test)
- Clause: INV-001
- Title: INV-001 を機械検証する test_pattern が宣言されていない
- Detail: 不変条件は test_pattern を持つことを推奨
- Suggested action: clause "INV-001" に verifiable_by.test_pattern を追加

### DRIFT-8BGVCN [medium] (spec_code)
- Clause: INV-002
- Title: INV-002 の anchor が src/agent-runtime-adapter.js に見つからない
- Detail: anchor "Legacy callers may not yet expose" が src/agent-runtime-adapter.js に存在しない (リネーム/削除の可能性)
- Suggested action: clause "INV-002" の anchor を更新するか、Spec を再生成する

### DRIFT-GE3JRV [low] (spec_test)
- Clause: INV-002
- Title: INV-002 を機械検証する test_pattern が宣言されていない
- Detail: 不変条件は test_pattern を持つことを推奨
- Suggested action: clause "INV-002" に verifiable_by.test_pattern を追加

### DRIFT-LRFPPV [medium] (spec_code)
- Clause: INV-003
- Title: INV-003 の anchor が src/session-efficiency-audit.js に見つからない
- Detail: anchor "import { resolveRunAttribution, validateRunLineageEnvelope }" が src/session-efficiency-audit.js に存在しない (リネーム/削除の可能性)
- Suggested action: clause "INV-003" の anchor を更新するか、Spec を再生成する

### DRIFT-RNDW9G [low] (spec_test)
- Clause: INV-003
- Title: INV-003 を機械検証する test_pattern が宣言されていない
- Detail: 不変条件は test_pattern を持つことを推奨
- Suggested action: clause "INV-003" に verifiable_by.test_pattern を追加
