---
story_id: story-vibepro-runtime-release-integrity
title: "実行経路ごとのVibePro runtime identityを保証する"
source:
  type: runtime-incident
  id: VP-SELF-002
architecture_docs:
  - ../../../architecture/vibepro-runtime-release-integrity.md
spec_docs:
  - ../../../specs/vibepro-runtime-release-integrity.md
status: active
created_at: 2026-05-16
updated_at: 2026-08-11
---

# Story: 実行経路ごとのVibePro runtime identityを保証する

## User Story

**As a** VibeProで証跡とPR判断を生成する利用者

**I want to** launcher、hook、CLI、証跡が同じimmutable runtimeのidentityを証明する
**So that** 古いcheckoutやdirtyな開発runtimeの結果を正規の判断として採用しない

## Incident

`~/.local/bin/vibepro` は265 commits behindかつ8 tracked files dirtyのdetached worktreeを参照し、Brainbase pre-pushは別の962 commits behind checkoutを絶対パス参照していた。旧doctorはこのbehind+dirtyを警告せず、Overall pass / exit 0としていた。

## Acceptance Criteria

- AC-1: `runtime identity` とdoctorが exact version、resolved entrypoint、package root、source kind、Git SHA/dirty/origin relation、identity digestを返す。
- AC-2: 通常モードはrelease manifest付きnpm packageだけを信頼し、Git checkoutは明示的development観測に限定する。
- AC-3: behindまたはdivergedのGit runtimeはdirtyでも `stale_runtime` で非0終了し、doctor fix・verify・PR artifactを変更しない。
- AC-4: verify run artifact、verification evidenceの各command、PR prepare/createへruntime identityを記録し、identity欠落または不正な既存証跡をPR判断に使わない。
- AC-5: npm tarballへsource commitを含むrelease manifestを同梱し、公開後はexact versionと`dist.integrity`を照合する。
- AC-6: canonical launcherとBrainbase pre-pushは同じ公開済みexact npm runtimeを解決する。
- AC-7: 旧dirty差分を復元可能なpatch/bundle/tarとして保全し、reset・削除・上書きしない。

## Tasks

- TSK-1 Runtime policy: `src/runtime-info.js` と `test/runtime-info.test.js`。
- TSK-2 Evidence propagation: doctor、verification、PR managerと対象テスト。
- TSK-3 Release provenance: `scripts/runtime-manifest.mjs`、package metadata、pack/install smoke。
- TSK-4 Consumer convergence: Brainbase hookとcanonical launcherを公開済みexact versionへ切り替える。
- TSK-5 Release verification: npm exact version、gitHead、dist.integrity、dist.shasumと証跡smokeを記録する。

## Boundaries

- VibePro自己開発はplain git flowを使い、source checkoutを下流runtimeとして配布しない。
- `.vibepro/` と旧audit artifactsはread-only archiveのため、本Story/Architecture/Spec/Taskを正本とする。
- Skill driftはruntime integrityとは別Storyで扱う。
