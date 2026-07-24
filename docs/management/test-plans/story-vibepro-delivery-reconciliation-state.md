# Test Plan: Delivery事実と再調整状態を分離する

| Clause | Test | Expected |
|---|---|---|
| DRS-S-1 / DRS-CONTRACT-001 | external merge artifact schema | delivery/reconciliationが独立して永続化される |
| DRS-S-2 / DRS-CONTRACT-002 / DRS-SCENARIO-003 | merge commit not on origin/base + `--delete-branch` | blocked、delivery unverified、branchを保持する |
| DRS-S-3 / DRS-CONTRACT-003 | merged PR + gate/worktree/HEAD/check/review drift | 5理由を保存し、delivery observed、exit 2 |
| DRS-S-4 / DRS-CONTRACT-004 | merged PR + expected closed/base topology | reconciliation理由に含めない |
| DRS-S-5 / DRS-CONTRACT-005 | execution reconciliation | delivery lifecycleはmerged、follow-up actionは残り、未解消ならexit 2 |
| DRS-S-6 / DRS-CONTRACT-006 / DRS-SCENARIO-004 | managed/external merge regression | clean pathは両軸とexecution stateがreconciled |
| DRS-CONTRACT-007 | status/reconcile再構築 + source conflict | reconciliation欠落をfail closedし、current-HEAD localを優先する |
| DRS-CONTRACT-007 / DRS-VERIFY-003 | human/HTML/canonical/usage projections | 全派生surfaceが二軸、理由、PR selector、non-main base、復旧command、対応要否を表示・保存する |
| DRS-SCENARIO-005 / DRS-SCENARIO-006 | canonical persistence / execution-state sync failure | observed delivery resultを保持しつつ非0終了と実行可能なretry guidanceを返す |
| DRS-SCENARIO-008 | sync failure recovery projection equivalence | text/HTML/local usage/compact canonicalが同一のexecute-reconcile actionだけを返す |
| DRS-SCENARIO-009 | persisted sync recovery execution | exact base/PRでsync失敗だけを消費して収束し、省略/不一致identityはfail closed、別reasonは保持、local/canonical/manifest途中失敗は元artifactへrollbackする |
| DRS-CONTRACT-007 / DRS-SCENARIO-009 | compound rollback + concurrent writer + caller wiring | real artifact sync後のcommit-last失敗で全authorityを復元し、source artifactのinterleaveとnewer follow-upをownership/CASで保持、reconcile初回writeは既存値と未作成の双方をCASする。linked-only観測値は正常baselineとして収束し、linked authorityの並行更新はmutation前に拒否する。sync消費後とmerge-state成功経路も最終write前CASでnewer stateを保持し、public execute JSONはnested causeとauthority別restore errorsを分離する |
| DRS-CONTRACT-007 / lock ownership | staged generation + paused initializer + stale transition + concurrent takeover | owner初期化をatomic publishし、停止initializerはsuccessorを上書きせず、releaseは隔離前に現行tokenを検証する。successor置換後にlock directoryのrename eventが発生しないことをhook非依存で確認し、dead/stale transitionだけを検証後に隔離し、live/unknown ownerはfail closedにする |
| DRS-CONTRACT-007 / artifact ownership rollback | per-write ownership + canonical/linked source concurrent replacement | 各実write直後に個別path ownershipを記録し、同pathのoperator更新、同directoryの無関係file、ownership未報告のpartial outputをrollbackしない |
| DRS-CONTRACT-007 / public JSON E2E | shipped `bin/vibepro.js execute merge --json` selector failure + observed-delivery sync failure + dispatcher failure projection + real transaction test | 実entrypointでselector failureとobserved delivery後のsync failureを独立実行し、exit 1、immutable delivery、単一reconcile command、可視診断、永続follow-upを証明する。dispatcher/real transaction testがnested cause details、authority別restore errors、per-artifact rollbackを補完する |
| DRS-CONTRACT-007 / custom PR route E2E | shipped `bin/vibepro.js execute merge --json` sync failure + `execute reconcile` under configured `artifact_routing.artifacts.pr.canonical` | routed JSON/HTMLだけが更新され、legacy `.vibepro/pr`を作らず、exit 1から単一reconcile commandでexit 0・`merged_externally`・`reconciled`へ収束し、canonical auditと一致する |
| DRS-CONTRACT-007 / custom PR route linked-source rollback | configured PR route + linked managed/source roots + commit-last failure | managed rootのrouted artifactだけをsource rootのrouted authorityへ同期し、legacy decoyを参照せず、失敗時はrouted artifactと全execution-state authorityを元へ戻す |

## Commands

```bash
node --test test/cli-status-honesty.test.js test/delivery-reconciliation-state.test.js test/execution-state.test.js
node --test test/story-transaction-lock.test.js
node --test test/traceability-usage-report.test.js test/canonical-audit-self-contained.test.js
node --test test/e2e/story-vibepro-delivery-reconciliation-state-main.spec.ts
node --test --test-name-pattern='CAA-VERIFY-001 execute merge|execute merge deletes the remote branch' test/vibepro-cli.test.js
node --test --test-name-pattern='DRS-SCENARIO-007 provider command and JSON failures persist blocked delivery evidence|DRS-CONTRACT-007 execute merge preserves observed delivery across execution-state synchronization failure|DRS-S-5 execute reconcile returns nonzero for canonical persistence failure|DRS-CONTRACT-007 execute reconcile --all-merged exits non-zero for legacy delivery without reconciliation|DRS-CONTRACT-007 execute reconcile --all-merged uses current local delivery over stale canonical conflict' test/vibepro-cli.test.js
```
