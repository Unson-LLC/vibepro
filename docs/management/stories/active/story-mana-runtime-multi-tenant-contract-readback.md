---
story_id: story-mana-runtime-multi-tenant-contract-readback
title: "mana-runtimeでテナント境界を実行証拠からreadbackする"
status: proposed
view: dev
period: 2026-08
category: quality
source:
  type: downstream_handoff
  title: "Issue #466 Phase 3 downstream readback候補"
  url: "https://github.com/Unson-LLC/vibepro/issues/466"
related_stories:
  - story-vibepro-multi-tenant-rollout-dogfood
created_at: 2026-08-16
updated_at: 2026-08-16
---

# mana-runtimeでテナント境界を実行証拠からreadbackする

## 状態

これはVibePro Issue #466の完了へ実環境成功を混入させないための、未着手のdownstream Story候補である。mana-runtimeの実装・配備・本番データはこの変更では操作しない。

## Acceptance Criteria

- [ ] canonical tenant identityと解決元を実行時readbackで確認する。
- [ ] tenant別の接続先とconnection modeを確認する。
- [ ] tenant別credential scopeとcross-tenant fallback不存在を確認する。
- [ ] queue、durable state、sandboxのpartition keyとresidue policyを確認する。
- [ ] cross-tenant候補をdeny-and-auditしたreceiptを確認する。
- [ ] HTTP成功、認証成功、secret bindingだけをE2E成功として扱わない。
- [ ] 未確認、製品固有不具合、operator actionを別々に報告する。
