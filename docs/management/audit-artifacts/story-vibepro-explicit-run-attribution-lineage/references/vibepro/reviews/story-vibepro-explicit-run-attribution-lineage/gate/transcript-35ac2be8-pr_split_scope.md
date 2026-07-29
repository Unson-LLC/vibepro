# pr_split_scope review at 35ac2be8

Status: needs_changes

The reviewer accepted keeping the canonical-audit compatibility fix in the same PR, but found that globally swallowing ENOTDIR could silently hide malformed expected audit directories. The fix must be limited to compatibility files directly under the review root and covered by a fail-closed regression test.

Agent: 019f8447-f916-7782-bcb6-f344757c3f36 (gpt-5.6-luna)
