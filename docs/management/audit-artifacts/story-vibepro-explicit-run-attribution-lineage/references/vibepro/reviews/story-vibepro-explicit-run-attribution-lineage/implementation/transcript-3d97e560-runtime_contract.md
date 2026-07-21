# runtime_contract review at 3d97e560

Status: needs_changes

The reviewer found that a malformed canonical Run state could fall through to another candidate root and silently switch authority. It also found that an expected provider identity run directory replaced by a file could be skipped on ENOTDIR. Both paths must fail closed with regression tests.

Agent: 019f8455-d92d-7060-b2b0-4886ca3314a9 (gpt-5.6-luna)
