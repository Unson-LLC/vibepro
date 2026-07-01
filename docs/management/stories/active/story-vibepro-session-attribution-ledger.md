---
story_id: story-vibepro-session-attribution-ledger
title: Codex session帰属を未確認のまま価値扱いしない
view: dev
period: 2026-07
parent_design: vibepro-session-attribution-ledger
architecture_docs:
  - docs/architecture/vibepro-session-attribution-ledger.md
spec_docs:
  - docs/specs/vibepro-session-attribution-ledger.md
status: active
created_at: 2026-07-01
updated_at: 2026-07-01
---

# Codex session帰属を未確認のまま価値扱いしない

## 背景

downstream repoの日次監査では、session本文にstory名が出るだけでVibeProが使われたように見える。
実際にはcwd、story、artifact、token windowが混線し、clean attributionできないsessionが多い。

## 受け入れ基準

- [ ] `session_attribution_ledger` が明示入力あり/なしを区別する
- [ ] PR prepareでsession帰属がない場合は `not_collected_in_pr_prepare` として残る
- [ ] senior gap judgmentがsession帰属欠落をresidual riskに出す
- [ ] usage reportがsession帰属状態を集計する
