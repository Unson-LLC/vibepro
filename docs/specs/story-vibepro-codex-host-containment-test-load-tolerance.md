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
- **S-004** (scenario): worker は spawn 直後・await より前に writeFileSync で codex-process.json を同期登録し、terminateWorkerTree は codexPid 不明のとき escalation 各段階と最終確認前に codex-process.json を再解決する（最終段階で遅れて判明した pid にも SIGKILL を送る）。未登録の detached codex 孤児を「封じ込め成功」と報告しない。位置づけ: inspection で発見した理論的レース窓の閉鎖（実測 flake の原因ではない）。
- **S-005** (scenario): テストフィクスチャの pid ファイル・シグナルマーカー書き込みは tmp+rename でアトミック化し、テスト側待機は「非空・正整数（>1）としてパースできるまで」を条件に含める。根拠: 実測された 300 秒 timeout の真因は、非アトミック書き込み中の 0 バイトファイルを `access()` ポーリングが検知し `readFile` が空文字 → `Number("")=0` → `process.kill(0,0)` 恒真、で post-shutdown 待機が構造的に充足不能になるフィクスチャレース（計測ハーネス 18 run / 2 leak、全て同一パターン）。production のシグナル送達は全 run で正常を確認。
- **INV-001** (invariant): production 変更は登録レース閉鎖に限定。terminateWorkerTree SIGTERM-to-SIGKILL escalation phases and sandbox EPERM fallback are unchanged/existing。
