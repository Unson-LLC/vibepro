---
title: "VibePro Self-Dogfood Control Loop Architecture"
status: draft
created_at: 2026-05-16
updated_at: 2026-05-16
related_stories:
  - story-vibepro-self-dogfood-audit-loop
  - story-vibepro-runtime-release-integrity
  - story-vibepro-worktree-pr-scope-isolation
  - story-vibepro-preset-boundary-governance
  - story-vibepro-completion-quality-loop
---

# VibePro Self-Dogfood Control Loop Architecture

## Intent

VibePro自身の実行履歴を、単なるログ確認ではなく、Story / Architecture / Spec / Gate を改善する制御ループへ接続する。

このArchitectureは、過去のCodex/VibePro運用で繰り返された確認漏れ、版ズレ、dirty混入、generic診断への固有情報混入、E2E品質未達を、VibePro本体の責務境界として扱う。

## Control Loop

```text
Codex / VibePro execution logs
  -> Codex Log Audit
  -> Outcome / Value / Risk Analysis
  -> Repeated Issue Detection
  -> VibePro Story Backlog
  -> Architecture / Spec Update
  -> Implementation / Test / PR Evidence
  -> Verified Runtime / Skill Distribution
```

## Boundaries

| Boundary | Responsibility | Must Not Do |
|----------|----------------|-------------|
| Codex Log Audit | ログの所在、範囲、更新時刻、対象セッション、未確認範囲を確定する | 一部ログだけで全確認済みと断言する |
| Outcome Analysis | 実行内容、価値、問題、残リスク、改善Storyを構造化する | 成果物の有無だけで成功扱いにする |
| Runtime Provenance | 実際に呼ばれたCLI、checkout、HEAD、origin/main、Skill同期状態を検証する | 修正済みcheckoutと実行checkoutを同一視する |
| PR Scope Isolation | committed diff、dirty、staged、untracked、generated artifactsを分離する | dirty fileをPR対象差分やsplit laneへ混ぜる |
| Preset Governance | generic presetとproject presetの境界を守る | 過去プロジェクト固有の語彙をgeneric出力へ漏らす |
| Completion Quality | E2E、human review、visual QA、操作証跡を完了判定へ接続する | テスト通過やAI自己申告だけでShipped/Verifiedにする |

## Data Model

### CodexLogAudit

```json
{
  "run_id": "2026-05-16T12-00-00+09-00",
  "repo": "/Users/ksato/workspace/code/vibepro",
  "since": "2026-05-09T00:00:00+09:00",
  "sources": [
    {
      "type": "sqlite",
      "path": "~/.codex/state_5.sqlite",
      "rows_examined": 54,
      "updated_at_range": ["...", "..."]
    },
    {
      "type": "jsonl",
      "path_glob": "~/.codex/sessions/**/*.jsonl",
      "files_examined": 54,
      "mtime_range": ["...", "..."]
    }
  ],
  "coverage": {
    "sessions_expected": 54,
    "sessions_examined": 54,
    "unreadable_sessions": []
  }
}
```

### ExecutionOutcome

```json
{
  "session_id": "...",
  "story_id": "story-vibepro-self-dogfood-audit-loop",
  "changed_files": [],
  "commands": [],
  "tests": [],
  "value": [],
  "problems": [],
  "remaining_risks": [],
  "next_story_candidates": []
}
```

### RepeatedIssue

```json
{
  "issue_key": "runtime-version-drift",
  "sessions": ["..."],
  "symptom": "修正済みと思ったVibeProが実行環境へ反映されない",
  "root_cause_hypothesis": "CLI symlink / checkout / origin/main / Skill配布の版確認がPR gateに入っていない",
  "owning_story_id": "story-vibepro-runtime-release-integrity"
}
```

## Evidence Outputs

VibePro自身の監査結果は、repoへ常時保存するログ本文ではなく、監査サマリと証跡参照として扱う。

```text
.vibepro/audits/codex-log/<run-id>/
  audit.json
  audit.md
  repeated-issues.json
  story-candidates.json
```

PR evidenceは、必要に応じてこのaudit runを参照する。

```json
{
  "audit_refs": [
    ".vibepro/audits/codex-log/2026-05-16T12-00-00+09-00/audit.json"
  ]
}
```

## Gate Policy

- coverageが不足している監査は、`complete_audit=false` として扱う
- runtime provenanceが不一致の場合、VibePro自身のPRは `ready_to_merge` にしない
- explicit `--head` のPR prepareでは、dirty fileはwarningであり、PR対象の主判定ではない
- generic preset anti-leak testが失敗した場合、diagnosis/story generationの変更はmerge不可
- UI StoryでE2E / visual / human review証跡が不足する場合、ShippedではなくBlockedまたはNeeds Evidenceに戻す

## Rollout

1. Story / Architecture / SpecをVibePro自身のbacklogへ追加する
2. `vibepro audit codex-logs` の最小版で、既存ログを構造化して再監査する
3. repeated issueをStory候補へ変換する
4. runtime provenanceとPR scope isolationをPR gateへ接続する
5. completion quality gateをUI Storyの標準完了条件へ昇格する
