# release_risk review at 35ac2be8

Status: block

The reviewer blocked release because globally swallowing ENOTDIR could silently omit malformed audit evidence and because the persisted review and verification evidence was stale for the current HEAD. It required a compatibility-file-only fix and current-HEAD evidence.

Agent: 019f8447-ff48-7ca3-a44e-3b0eed889723 (gpt-5.6-luna)
