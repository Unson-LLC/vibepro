# Story Run Portfolio Controller Test Plan

| Scenario | Evidence |
|---|---|
| Six Story sequential progression | `SRP-S-3` focused test |
| Mid-Story blocker and no implicit next start | `SRP-S-4` focused test |
| Process restart and explicit typed skip | `SRP-S-4` focused test |
| Digest-bound promotion and transcript rejection | `SRP-S-5` focused test |
| Per-Story time, cost, suite, reuse, interruption summary | `SRP-S-6` focused test |
| Story/Run/worktree/branch/review/session contamination | `SRP-S-7` focused test |
| Concurrent mutation exclusion and duplicate child prevention | `SRP-S-3 concurrent mutation` focused test |
| Digest mismatch, missing artifact, and repository symlink escape | `SRP-S-5` focused test |
| Internal transcript symlink rejection | `SRP-S-5` focused test |
| Concurrent create, recovery-mutex serialized dead-owner recovery, and exception lock release | Portfolio lock focused test |
| Owner-token change cannot delete another mutation lock | Portfolio owner-token focused test |
| Pre-create crash rejects historical Run adoption; publish-gap retry reconciles only the creation-request-bound child | Portfolio creation identity focused tests |
| Stopped human summary provides typed next action | `SRP-S-7` focused test |
| Unproved parallel execution rejection | `SRP-S-8` focused test |
| CLI create/status/advance/decide/promote, JSON and human surfaces | CLI integration focused tests |
