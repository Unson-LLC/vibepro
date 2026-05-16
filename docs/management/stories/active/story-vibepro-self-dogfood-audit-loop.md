---
story_id: story-vibepro-self-dogfood-audit-loop
title: "VibePro自己改善: Codexログ監査を改善Storyへ接続する"
source:
  type: codex-log-audit
  id: VP-SELF-001
  title: "VibePro実行履歴の確認漏れと価値分析不足"
architecture_docs:
  - ../../architecture/vibepro-self-dogfood-control-loop-architecture.md
spec_docs:
  - ../../specs/vibepro-self-dogfood-control-loop.md
status: active
created_at: 2026-05-16
updated_at: 2026-05-16
---

# Story: VibePro自己改善: Codexログ監査を改善Storyへ接続する

## User Story

**As a** VibeProの実行結果をプロダクト改善に使いたいユーザー
**I want to** Codexログを対象範囲つきで監査し、実行内容・価値・問題・改善Storyを構造化して確認できる
**So that** 「ログを見たつもり」や単なる作業列挙で終わらず、VibeProの未達を再現可能に改善できる

## Background

VibeProの実行結果確認では、初回に一部ログや成果物だけを見て「確認した」と言い切り、後から `state_5.sqlite`、`logs_2.sqlite`、`sessions/*.jsonl`、更新時刻基準の差分を改めて洗い直す流れになった。

また、成果物の有無を確認しても、何を修正したか、その修正がどんな価値を生んだか、問題が残っていないか、次に改善すべきことは何か、というプロダクト判断まで自動で接続できていなかった。

## Acceptance Criteria

- [ ] `vibepro audit codex-logs` が、対象リポジトリ、期間、更新時刻、取得元、未確認範囲を明示してCodexログを監査できる
- [ ] SQLiteのセッション一覧だけでなく、JSONLログ実体の更新時刻と内容を照合できる
- [ ] 各実行履歴について、実行内容、変更ファイル、検証結果、価値、未達、残リスク、次の改善Story候補を出力できる
- [ ] 「全件確認済み」と言う条件を coverage table として機械判定できる
- [ ] 同じ問題が複数ログで繰り返された場合、repeated_issue として集約し、原因仮説を残せる
- [ ] 監査結果は `.vibepro/audits/codex-log/<run-id>/` にJSONとMarkdownで残り、PR evidenceから参照できる

## Implementation Notes

- 対象候補: `src/doctor.js`, `src/pr-manager.js`, 新規 `src/codex-log-auditor.js`
- 入力候補: `~/.codex/state_*.sqlite`, `~/.codex/logs_*.sqlite`, `~/.codex/sessions/**/*.jsonl`
- 監査はローカル読取専用で行い、ログ本文を不用意にリポジトリへ保存しない
