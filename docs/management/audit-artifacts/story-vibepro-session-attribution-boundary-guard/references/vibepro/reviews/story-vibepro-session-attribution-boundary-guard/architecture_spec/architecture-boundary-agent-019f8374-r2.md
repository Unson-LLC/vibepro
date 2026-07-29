# Architecture Boundary Re-review

- HEAD: `a8f44f483523dac32ec9d18323ba612d3fe90639`
- Status: `needs_changes`

The prior semantic contradiction is resolved. `SAB-FAILURE-001` now separates unreadable JSONL from malformed rows correctly.

Remaining `P2 / SAB-FAILURE-001-TRACEABILITY`: the machine Spec uses `must_cover` phrases that do not occur in the test file. Use the two literal test-title fragments for unreadable JSONL and malformed-row preservation.

Judgment delta: runtime contract mismatch resolved; one machine-verification reference remains.
