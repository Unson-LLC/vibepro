---
story_id: story-vibepro-automation-handoff-signal
title: automation auditでhandoff再現不能を安定検知する
view: dev
period: 2026-06
parent_design: vibepro-automation-handoff-signal
architecture_docs:
  - docs/architecture/vibepro-automation-handoff-signal.md
spec_docs:
  - docs/specs/vibepro-automation-handoff-signal.md
status: active
created_at: 2026-06-30
updated_at: 2026-06-30
---

# automation auditでhandoff再現不能を安定検知する

## 背景

canonical audit bundle自体には `handoff_replay_status` と unresolved references が残るが、
日次 automation が最初に読む `audit-index.json` / `automation_value_audit` はその状態を
安定した finding として持たない。これでは「別 engineer/agent が再構成できない」という
価値毀損が、汎用の residual risk や missing artifact に埋もれる。

## 受け入れ基準

- [ ] `audit-index.json` に `handoff_replay_status` と unresolved reference 件数が保存される
- [ ] compact canonical audit でも同じ handoff 状態が保持される
- [ ] replay bundle 圧縮が会計サマリを変えなくなった時点で反復を停止し、handoff signal がその安定後の値を使う
- [ ] `automation_value_audit.value_signal_inputs` が handoff replay 状態を含む
- [ ] handoff replay が blocked のとき `canonical_handoff_replay_blocked` finding が出る
- [ ] 回帰テストが blocked handoff を canonical bundle / audit index / automation value audit の各層で検証する
