---
story_id: story-vibepro-codex-host-containment-test-load-tolerance
title: Codex host containment test load-tolerant waitFor specification
status: specified
parent_design:
  - vibepro-autonomy-roadmap-rebaseline
code_refs:
  - test/codex-subagent-host.test.js
test_refs:
  - test/codex-subagent-host.test.js
---

# Codex host containment test load-tolerant waitFor — Spec pointer

正本の Spec clauses は `.vibepro/spec/story-vibepro-codex-host-containment-test-load-tolerance/spec.json`（`vibepro spec write --final` 登録済み、4 clauses）にある。この文書は Design SSOT lineage 用のポインタ。

## Clause summary

- **S-001** (scenario): `waitFor` は options オブジェクト `{ timeoutMs }` でタイムアウトを呼び出し側指定でき、デフォルトは 10000ms 据え置きで既存呼び出し箇所の挙動を変えない。
- **S-002** (scenario): containment テスト 2 本（process group / sandbox boundary）の負荷感受性の高い 4 待機（spawn 後の pid ファイル出現、shutdown 後のプロセス消滅 / SIGTERM マーカー）は `timeoutMs: 300000` を渡す。根拠: レビュー実測で load average 120-155 の環境下、該当待機が ~63 秒に達したため、その約 4.7 倍のマージンを確保する。
- **S-003** (scenario): 旧フレークテストは単体実行と full suite の双方で pass し、current-head の検証証跡で裏付ける。
- **INV-001** (invariant): src/ 配下は不変。terminateWorkerTree SIGTERM-to-SIGKILL escalation is unchanged/existing（テスト側 deadline のみ変更）。
