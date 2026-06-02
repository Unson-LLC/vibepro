---
title: "VibePro Self-Dogfood Control Loop Spec"
status: draft
created_at: 2026-05-16
updated_at: 2026-05-16
related_architecture:
  - ../architecture/vibepro-self-dogfood-control-loop-architecture.md
related_stories:
  - story-vibepro-self-dogfood-audit-loop
  - story-vibepro-runtime-release-integrity
  - story-vibepro-worktree-pr-scope-isolation
  - story-vibepro-managed-worktree-execution-dag
  - story-vibepro-preset-boundary-governance
  - story-vibepro-completion-quality-loop
---

# VibePro Self-Dogfood Control Loop Spec

## Commands

### `vibepro audit codex-logs <repo>`

Purpose: Codex/VibeProの実行履歴を監査し、実行内容、価値、問題、残リスク、改善Story候補へ接続する。

Options:

| Option | Meaning |
|--------|---------|
| `--since <datetime>` | 監査開始時刻。未指定時は直近7日 |
| `--until <datetime>` | 監査終了時刻。未指定時は現在 |
| `--json` | JSONをstdoutへ出力する |
| `--out <dir>` | 監査結果の保存先。既定は `.vibepro/audits/codex-log/<run-id>/` |
| `--include-session-text` | ログ本文抜粋を保存する。既定はfalse |
| `--story-id <id>` | 監査結果を紐づけるVibePro Story |

Required behavior:

- `updated_at` またはJSONL mtimeを主な抽出基準にする
- SQLiteの行とJSONL実体を突合し、片方だけに存在するセッションをcoverageへ出す
- 監査対象外、読取失敗、形式不明を `coverage.unreadable_sessions` に残す
- coverageが完了していない場合、Markdownサマリで「全件確認済み」と表現しない
- audit outputはatomic writeで保存し、既存valid JSONを壊さない

### `vibepro doctor`

Additional output:

| Field | Meaning |
|-------|---------|
| `runtime.cli_path` | 実際に呼ばれたCLI path |
| `runtime.package_root` | CLIが解決したVibePro package root |
| `runtime.git_head` | package rootのHEAD |
| `runtime.origin_main` | package rootのorigin/main |
| `runtime.is_origin_main_current` | HEADがorigin/mainへ追随しているか |
| `skills.status` | installed / stale / missing / unmanaged |

Required behavior:

- CLI symlink、package root、git HEADを明示する
- expected repoと実行repoが違う場合、warningではなく `runtime_mismatch` として構造化する
- Skill driftはVibePro本体のPR対象差分と混ぜず、配布状態として表示する

### `vibepro pr prepare`

Required behavior:

- `--base` と `--head` が両方明示された場合、`git.changed_files` は `base..head` のcommitted diffだけにする
- dirty / staged / untrackedは `git.dirty_files`, `git.staged_files`, `git.untracked_files` へ分離する
- explicit head modeでは、dirty fileだけを理由に `needs_clean_branch` を出さない
- working copy modeでは、従来どおりdirty fileをPR対象候補に含めてよい
- `git status --porcelain` は先頭2文字のstatus columnを保持して解析する

## Output Schema

### Audit Summary

```json
{
  "schema_version": 1,
  "run_id": "2026-05-16T12-00-00+09-00",
  "repo": "/Users/ksato/workspace/code/vibepro",
  "period": {
    "since": "2026-05-09T00:00:00+09:00",
    "until": "2026-05-16T12:00:00+09:00"
  },
  "coverage": {
    "complete": false,
    "sessions_expected": 0,
    "sessions_examined": 0,
    "unreadable_sessions": []
  },
  "outcomes": [],
  "repeated_issues": [],
  "story_candidates": []
}
```

### Outcome

```json
{
  "session_id": "...",
  "updated_at": "...",
  "repo": "...",
  "story_id": "...",
  "summary": "...",
  "changed_files": [],
  "tests": [
    {
      "command": "node --test test/vibepro-cli.test.js",
      "status": "passed"
    }
  ],
  "value": [
    "PR evidenceの競合耐性が上がった"
  ],
  "problems": [
    "human-review証跡が不足"
  ],
  "remaining_risks": [
    "UI E2E未確認"
  ],
  "next_story_candidates": [
    "story-vibepro-completion-quality-loop"
  ]
}
```

## Anti-Leak Fixtures

Generic diagnosis/story generation must pass fixtures for at least:

- empty Next.js app
- example dialog app-like AI chat app
- example outreach app-like B2B SaaS app

Forbidden generic leakage examples:

- example travel app
- hotel-specific operations
- shadow-call
- project-specific customer names

If a project preset intentionally includes these terms, the output must include `preset.source=project` and the selected preset name.

## Completion Quality Gate

For UI Stories, `pr prepare` must surface these evidence slots:

| Evidence | Required for Ready |
|----------|--------------------|
| E2E primary action | yes |
| E2E navigation | yes |
| Input/save/reload | yes when the Story includes persistence |
| Desktop screenshot | yes |
| Mobile screenshot | yes |
| Human review | yes when human review gate is enabled |
| Visual QA residual | no blocking residuals |

If any required slot is missing, `gate_status` must be `needs_evidence` or stricter.

## Tests

- Unit: Codex log source discovery with SQLite-only, JSONL-only, and mixed sources
- Unit: audit coverage does not claim complete when sessions are unreadable
- Unit: outcome analysis requires value, problem, remaining risk fields
- Unit: runtime provenance detects CLI package root mismatch
- Unit: explicit head PR prepare excludes unrelated dirty files from `changed_files`
- Unit: porcelain parser preserves leading status columns
- Unit: generic preset anti-leak fixtures reject project-specific terms
- Integration: audit output is written atomically and existing valid JSON survives process interruption
- Integration: UI Story without E2E evidence cannot become ready_to_merge
