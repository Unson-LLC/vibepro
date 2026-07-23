---
story_id: story-vibepro-production-runtime-connectors
parent_design: vibepro-autonomous-implementation-closure-roadmap
vibepro_story_id: story-vibepro-autonomous-implementation-closure-roadmap
title: Agent Runtime Adapterへproduction connectorを接続する
status: completed
view: dev
period: 2026-07
category: platform
related_stories:
  - story-vibepro-autonomous-action-dag
  - story-vibepro-agent-runtime-adapters
  - story-vibepro-managed-worktree-execution-dag
reason: "selected provider-neutral built-in connectors with capability probes instead of hard-coding provider behavior into Guarded Run. compatibility: the existing injected adapter contract and fake adapters remain valid. rollback: remove connector registration while retaining the adapter core. boundary: process transport, identity, capability and result normalization only."
created_at: 2026-07-21
updated_at: 2026-07-23
---

# Agent Runtime Adapterへproduction connectorを接続する

## User Story

**As a** Guarded Run coordinator
**I want** 利用可能な実装・Review runtimeを実際に起動したい
**So that** 抽象adapterではなくproduction agentへ安全に委譲できる

## Acceptance Criteria

- [x] PRC-S-1: 少なくともCodex CLIのproduction connectorがprobe/start/status/result/cancelを実装する。
- [x] PRC-S-2: Claude Codeを利用可能な場合も同じcontractで選択でき、未設定時は明示的にunavailableになる。
- [x] PRC-S-3: auth、capability、sandbox、quota、timeout、costが型付き結果へ正規化される。
- [x] PRC-S-4: 実装はmanaged worktree write、Reviewはread-onlyかつ別sessionに制限される。
- [x] PRC-S-5: provider fallbackは明示policy順で行い、silent downgradeしない。
- [x] PRC-S-6: fake conformance testとproduction smoke testがある。
- [x] PRC-S-7: connectorは既存Coordinatorへ登録され、Guarded Run composition以外のGate・worktree・Review lifecycleを直接変更しない。

## Completion Evidence

- PR: https://github.com/Unson-LLC/vibepro/pull/377
- Merge commit: `0c11f4fb9081407bb57ac59c3f6ca696faefa21f`
- Merged at: `2026-07-22T02:42:19Z`
- GitHub checks: Node 20/22 CI、CodeQL、post-merge releaseはいずれもsuccess。
- この最終Storyはconnector実装を再作成せず、merge済みcontractをcomposition rootから再利用する。

## Non Goals

- providerへGate passやReview verdictを決めさせること。
- provider credentialをartifactへ保存すること。
