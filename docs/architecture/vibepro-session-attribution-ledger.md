---
title: Session Attribution Ledger Architecture
story_id: story-vibepro-session-attribution-ledger
status: active
created_at: 2026-07-01
updated_at: 2026-07-01
related_stories:
  - story-vibepro-session-attribution-ledger
---

# Session Attribution Ledger Architecture

## Goal

VibePro参照sessionを、clean attributionとmixed/unattributed developmentに分ける。

## Decision

- `buildEvidenceReuse` が `session_attribution_ledger` を生成する
- PR prepareに明示session情報がない場合は欠落を明示する
- senior gap judgmentは欠落をresidual riskとして扱い、追加subagentより先にcost attributionを促す

## Non-goals

- Codex JSONL全体の自動探索
- downstream repo採用の自動断定
