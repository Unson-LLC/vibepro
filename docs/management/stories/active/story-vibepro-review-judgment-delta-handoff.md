---
story_id: story-vibepro-review-judgment-delta-handoff
title: "review summaryにinspection inputsとjudgment deltaを残す"
view: dev
period: 2026-06
source:
  type: value-audit
  id: VP-VALUE-AUDIT-2026-06-10-REVIEW-HANDOFF
  title: "review pass/fail要約だけでは別engineerへのhandoffで再判断コストが残る"
related_stories:
  - story-vibepro-review-inspection-first
  - story-vibepro-review-inspection-required-gate
  - story-vibepro-parallel-agent-review-dispatch-gate
architecture_docs:
  - ../../../architecture/vibepro-review-judgment-delta-handoff.md
spec_docs:
  - ../../../specs/vibepro-review-judgment-delta-handoff.md
status: active
created_at: 2026-06-11
updated_at: 2026-06-11
---

# review summaryにinspection inputsとjudgment deltaを残す

## User Story

**As a** VibeProのAgent Review結果を引き継ぐengineer  
**I want to** reviewerが何を見て、どの懸念からどの結論へ判断を変えたかをreview summaryで見たい  
**So that** pass/fail要約だけを読み直して同じinspectionを繰り返さず、必要な再判断だけに集中できる

## 背景

`story-vibepro-review-inspection-first` と `story-vibepro-review-inspection-required-gate` により、review resultにはinspection summary/evidenceを残せるようになった。しかし監査では、別engineer/agentへのhandoff時に「実際に何を入力として見たのか」「判断がどう変わったのか」がsummaryから再構成しづらい問題が残っていた。

handoffに必要なのは、単なる `pass` や `needs_changes` ではなく、inspection inputsとjudgment deltaである。たとえば「generic evidenceだけでは怪しい」から「specific artifact replayを見たのでpass」へ変わった理由が残ると、次のreviewerは同じ読み直しを省ける。

## Scope

- `vibepro review record` に繰り返し指定できる `--inspection-input` と `--judgment-delta` を追加する
- review result JSON、review status JSON、review summary Markdownに新しいhandoff fieldsを表示する
- review requestとparallel dispatchに、subagentが `inspection_inputs` と `judgment_delta` を返すべきことを明記する
- 既存の `inspection.summary` / `inspection.evidence` と既存review artifactの読み取り互換性を保つ

## 受け入れ基準

- [ ] `review record` は `--inspection-input` を複数受け取り、trim/de-duplicateした `inspection.inputs[]` として保存する
- [ ] `review record` は `--judgment-delta` を複数受け取り、`judgment_delta[]` として保存する
- [ ] `review status --json` と stage `review-summary.json` は roleごとに `inspection.inputs[]` と `judgment_delta[]` を含む
- [ ] `review-summary.md` は role行に inspection inputs と judgment delta の短いhandoff要約を表示する
- [ ] `review prepare` の request / parallel-dispatch は subagentの結果形式に `inspection_inputs` と `judgment_delta` を含める
- [ ] 既存のinspection summary/evidenceだけを使うcallerは壊れない

## 非目標

- agent transcriptから自動でjudgment deltaを生成すること
- judgment deltaの品質をLLMで採点すること
- review gateのpass/fail条件をこのStoryで変更すること
