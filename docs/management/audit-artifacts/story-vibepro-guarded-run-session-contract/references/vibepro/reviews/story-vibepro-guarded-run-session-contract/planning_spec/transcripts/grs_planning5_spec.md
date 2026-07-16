# spec_consistency review

```json
{
  "status": "needs_changes",
  "summary": "主要整合性は修正済みだが、既存 legacy execution が unavailable managed worktree を記録している場合の execute run 解決規則が未定義。",
  "inspection_summary": "Story、Architecture、Spec、test plan、Design SSOT、current PR artifact、既存 startExecution/managed-worktree read path を照合した。",
  "inspection_inputs": [
    ".vibepro/reviews/story-vibepro-guarded-run-session-contract/planning_spec/review-request-spec_consistency.md",
    ".vibepro/pr/story-vibepro-guarded-run-session-contract/pr-prepare.json",
    "docs/management/stories/active/story-vibepro-guarded-run-session-contract.md",
    "docs/architecture/story-vibepro-guarded-run-session-contract.md",
    ".vibepro/spec/story-vibepro-guarded-run-session-contract/spec.json",
    "docs/management/test-plans/story-vibepro-guarded-run-session-contract.md",
    "design-ssot.json",
    "src/execution-state.js",
    "src/managed-worktree.js"
  ],
  "judgment_delta": [
    "authority binding、authority loss、cancel no-op、creation repair、resume、legacy status、typed failures、threat model は整合済み",
    "pre-existing unavailable legacy binding の分岐だけ未定義"
  ],
  "findings": [
    {
      "severity": "medium",
      "id": "path-surface-existing-unavailable-legacy-execution",
      "detail": "既存 legacy execution が managed_worktree.status=unavailable を記録済みの場合の authority 解決と Run 未作成を明文化し、その fixture を test plan に追加する必要がある。"
    }
  ]
}
```
