---
story_id: story-vibepro-engineering-judgment-activation-precision
title: Engineering Judgment axis activationをbroad keyword依存からprecision監査へ寄せる
status: active
architecture_reason: axis activationの根拠表現と閾値を厳格化する変更であり、既存のjudgment axisやPR artifact schemaを拡張するが新しい外部依存は導入しない
source:
  type: value_audit_followup
  id: engineering-judgment-activation-precision
architecture_docs:
  - docs/architecture/vibepro-engineering-judgment-activation-precision.md
spec_docs:
  - docs/specs/vibepro-engineering-judgment-activation-precision.md
---

# Story

現状の Engineering Judgment axis activation は `review`, `workflow`, `artifact` のような
broad keyword にかなり依存している。そのため senior engineer なら inactive にする diff でも、
Story 文面や docs にそれっぽい単語が入っているだけで `execution_topology` や `release_ops`
が active になりうる。

本当に欲しいのは「なぜ active になったか」を後から監査できることと、
text-only の弱い signal では active にしない conservative な first scan である。
VibePro は axis ごとに activation candidate を残しつつ、
非 text の corroboration がある時だけ active に進める必要がある。

## Acceptance Criteria

- `judgment_axes[]` は各 axis について `activation_candidates[]`, `activation_signals[]`,
  `activation_precision.status`, `activation_precision.reason` を持つ。
- `text:*` signal だけでは `execution_topology`, `rollback_sensitive`, `release_ops`,
  `security_boundary`, `data_state`, `ux_surface`, `performance_semantic` は active にならない。
- 上記 axis は、changed path / risk surface / route / docs / network contract / scope など
  non-text corroboration が入った時だけ active になる。
- `public_contract` も text-only では active にせず、少なくとも `pr_route:*`,
  `file_group:*`, `network_contract:*`, `changed_path:*` のいずれかを必要とする。
- inactive に落とした axis でも candidate signal は artifact に残るため、
  false positive / false negative の tuning を後から再構成できる。
- PR body / Gate DAG reasoning から、人間が「候補はあったが precision filter で落ちた」
  ことを読める。

## Non Goals

- 各 axis の required evidence や blocker 条件そのものを全面的に作り替えること。
- Graphify を必須化すること。
- すべての activation を learned model や外部 classifier に置き換えること。
