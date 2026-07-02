---
story_id: story-vibepro-agent-review-minimal-recovery-plan
title: "Agent Review Gateに最小回復計画を出す"
view: dev
period: 2026-07
parent_design:
  - vibepro-agent-review-minimal-recovery-plan
source:
  type: github_issue
  id: 270
  title: "Agent Review Gate should emit a minimal recovery plan for stale and timed-out review lifecycles"
architecture_docs:
  - docs/architecture/vibepro-agent-review-minimal-recovery-plan.md
spec_docs:
  - docs/specs/vibepro-agent-review-minimal-recovery-plan.md
status: active
created_at: 2026-07-02
updated_at: 2026-07-02
---

# Agent Review Gateに最小回復計画を出す

## User Story

**As a** VibeProでPR readinessを判断する開発者
**I want to** stale resultやtimed-out lifecycleが重なったAgent Review blockerから、次に実行する最小手順だけを見たい
**So that** dispatch batch、preflight、role、record、artifact freshnessの複数表示を手で解釈せず、現在stageの正しいreview recoveryに進める

## Scope

- `gate:agent_review` に `minimal_recovery_plan` を追加する
- 同じ `stage:role` の blocker を dedupe する
- timed-out lifecycle では agent/lifecycle id と close/replacement command を出す
- `gate_status` と first-look handoff にも plan を出す

## Acceptance Criteria

- [ ] Gate output includes a compact `minimal_recovery_plan`
- [ ] Plan deduplicates blocker messages that point to the same root review artifact
- [ ] Plan distinguishes current-stage work from later-stage blocked work
- [ ] Timed-out lifecycle recovery includes exact agent id/lifecycle id if known, plus close/replacement commands
- [ ] Tests cover stale fingerprint review results and timed-out lifecycle entries in a multi-stage review setup
