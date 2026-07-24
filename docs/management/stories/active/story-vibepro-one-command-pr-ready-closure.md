---
story_id: story-vibepro-one-command-pr-ready-closure
parent_design: vibepro-autonomous-implementation-closure-roadmap
vibepro_story_id: story-vibepro-autonomous-implementation-closure-roadmap
title: 1コマンド自律実装を実Runtime E2Eで閉じる
status: completed
view: dev
period: 2026-07
category: quality
architecture_docs:
  - docs/architecture/story-vibepro-one-command-pr-ready-closure.md
spec_docs:
  - docs/specs/story-vibepro-one-command-pr-ready-closure.vibepro.json
  - docs/specs/story-vibepro-one-command-pr-ready-closure-test-plan.md
related_stories:
  - story-vibepro-autonomous-action-dag
  - story-vibepro-production-runtime-connectors
  - story-vibepro-independent-review-orchestration
  - story-vibepro-guarded-autonomy-hardening
reason: "selected a real mutation-and-repair closure test instead of declaring completion from unit composition. compatibility: pr prepare Gate DAG remains the only PR-ready authority and merge remains explicit. rollback: keep the new actions behind the expanded DAG feature switch. boundary: final integration, operator UX and proof; component behavior stays owned by prior Stories."
created_at: 2026-07-21
updated_at: 2026-07-23
---

# 1コマンド自律実装を実Runtime E2Eで閉じる

## Acceptance Criteria

- [x] OCR-S-1: 公開CLIはagentを起動しないという旧説明を削除し、guarded実行範囲と停止境界を正確に示す。
- [x] OCR-S-2: 必要capabilityを持つproviderでは、1コマンドでworktree作成、不足artifact準備、実装commit、検証、独立Review、修正commit、再検証、再Review、final prepareを実行する。このavailable-pathは公開CLIが選ぶ同じproduction action ownerを使うproduction-shaped E2Eで実証し、実providerがcapabilityを欠く環境ではOCR-S-6のpre-mutation typed stopを正規terminalとして扱う。
- [x] OCR-S-3: current HEADの`pr-prepare.json`が`ready_for_pr_create=true`の場合だけRunが`pr_ready`になる。
- [x] OCR-S-4: merge、critical waiver、external side effectは実行せずHuman Checkpointまたは明示操作へ残す。
- [x] OCR-S-5: success、resume、human decision、verification failure、repair convergence、no-progress、quota、timeout、CI pending、cancelのE2E matrixがpassする。
- [x] OCR-S-6: production connector smokeは、runtimeが必要capabilityを提供する場合は実commitと独立Review identityを証明し、提供しない場合はmutation前に不足capability、provider、再開条件を型付き停止として同じRunへ永続化する。available-pathのcommit/review契約はproduction-shaped E2Eで回帰保証する。
- [x] OCR-S-7: self-dogfoodでこのStory自身または専用fixture StoryがTrusted PR-readyまたは契約どおりの型付き停止へ到達する。
- [x] OCR-S-8: pre-PR acceptanceは、merge済みPR #372、#377、#382を先行3 Storyの正本証跡として参照し、その実装を二重化しないこと、および最終Storyと親roadmapをPR作成時点では`active`のまま保つstaged closure protocolだけを証明する。PR作成、CI import、focused closure commit、再検証、再Review、再CI import、明示的な`execute merge`は下記Post-PR Delivery Closure Recordで追跡し、pre-PR Gate条件に含めない。

## Non Goals

- PRの自動createまたはmerge。
- 実Runtimeを使わないmock-only証跡によるロードマップ完了宣言。

## Implementation Tasks

1. `[ARCH]` Architecture、canonical Spec、test planを確定する。
   - `docs/architecture/story-vibepro-one-command-pr-ready-closure.md`、`docs/specs/story-vibepro-one-command-pr-ready-closure.vibepro.json`、`docs/specs/story-vibepro-one-command-pr-ready-closure-test-plan.md`がOCR-S-1..8、run-session callback注入、既存connector/review再利用、human authority境界を固定し、Design SSOTで整合する。
2. `[FOUNDATION]` Story scope、Task projection、run-session所属を正本へ登録する。
   - `.vibepro/config.json`、`design-ssot.json`、`src/task-manager.js`、`test/scope-boundary-gate.test.js`、`docs/architecture/target-model.json`、`src/safe-action-orchestrator.js`、`test/safe-action-orchestrator.test.js`がcurrent Story、全変更pathのexact Task target、repair後のverify/review suffix再実行、新ownerのrun-session所属、legacy profile互換を固定する。review継続専用の一時budget amendmentは最終PR surfaceから除去する。
3. `[CORE]` production action ownerとrepair convergenceを実装する。
   - `src/one-command-pr-ready-closure.js`、`src/guarded-run-session.js`、`src/agent-runtime-adapter.js`、`src/agent-runtime-connectors.js`、`src/independent-review-orchestrator.js`が実装objective、current-HEAD rebind、typed stop/resume、repair後のfresh review dispatchを閉じ、新ownerからCLIへの依存を作らない。
4. `[UX]` 1コマンドの公開契約を固定する。
   - `src/cli.js`、`test/one-command-pr-ready-closure.test.js`、`test/guarded-run-session.test.js`が省略時autonomousと`codex,claude-code` provider順、explicit legacy、disable fallback、英日help、dry-run、JSON/human、status/resumeを証明する。
5. `[VERIFY]` acceptance matrixとarchitecture conformanceを記録する。
   - `test/one-command-pr-ready-closure.test.js`、`test/e2e/story-vibepro-one-command-pr-ready-closure-runtime.spec.ts`、`test/guarded-run-session.test.js`、`test/independent-review-orchestrator.test.js`がOCR-T-1..4、workflow-heavy E2E replay、repair後の旧HEAD checkpoint無効化、既存公開help回帰を実装し、focused/full testsと最新main比target architecture conformanceをcurrent HEADへ記録する。
6. `[QA/DOGFOOD]` production connectorとVibePro lifecycleを実証する。
   - `docs/specs/story-vibepro-one-command-pr-ready-closure-test-plan.md`のOCR-T-5を、利用可能runtimeでは実commitと別identity review lifecycle、利用不能runtimeではmutation前の型付きcapability停止として実証する。後者はavailable-pathのproduction-shaped E2Eとcurrent-HEAD Gateを組み合わせてpre-PR acceptanceを閉じる。
   - `docs/management/stories/active/story-vibepro-autonomous-action-dag.md`をmerge済みPR #372、Production Runtime ConnectorsをPR #377、Independent Review OrchestrationをPR #382の証跡で完了へ更新する。先行コードは二重実装しない。
   - このStoryと親roadmapはpre-PR acceptance完了時も`active`を維持し、後続処理を下記Post-PR Delivery Closure Recordへ引き渡す。

## Post-PR Delivery Closure Record

これはOCR-S-8のpre-PR acceptanceではなく、delivery closureの運用記録である。VibeProでPR #385を作成し、pre-closure HEAD `926227f945878299770448a03966c17dfa70158d` のNode 20/22 CI成功を`verify import-ci`で取り込んだ。同一branchのこのfocused closure commitでStoryと親roadmapを`completed`へ更新し、AIC-S-1..5をPR #372、#377、#382、#385へ追跡可能にした。このcommitをcurrent HEADへ再bindし、Gate再検証、独立再Review、CI再importを完了してから、明示的な`vibepro execute merge`でmergeする。最終結果は`pr-merge.json`、canonical audit、merge SHAをpost-merge confirmationとする。

## Completion Evidence

- Real CLI dogfood: `run-20260723T121501Z-793c40ad`。managed worktreeで7-action DAGを開始し、利用可能runtimeの`workspace_write`不足を`runtime_unavailable`として型付き永続化した。
- Targeted run-session regression: current-HEAD strict bindingで155/155 pass。
- Public CLI production-owner E2E: current-HEAD strict bindingで4/4 pass。4件はいずれもproduction-shapedな実動作シナリオであり、実装commit、独立Reviewの`needs_changes`、修復commit、再検証、別review lifecycleのpass、final prepare、typed stop/resume matrix、公開CLI、先行Story境界を検証する。
- Independent preflight review: current HEADへ再bindしてから判定する。確認対象はrun-sessionからCLIへの逆依存、先行connector/reviewの二重実装、human authority越境。
- Pre-PR PR-readyの最終権威はcurrent-HEAD `pr-prepare.json`とし、CI import以降はPost-PR Delivery Closure Recordの同じStory監査へ記録する。
- Delivery PR: https://github.com/Unson-LLC/vibepro/pull/385。pre-closure HEADのCIはNode 20/22とも成功し、`npm test`のfull-suite coverageとしてVibeProへimport済み。
