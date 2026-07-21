---
story_id: story-vibepro-managed-worktree-policy-resync
title: Managed worktreeのポリシーconfigを凍結させず親repoから再同期する
status: active
view: dev
period: 2026-07
category: quality
related_stories:
  - story-vibepro-trusted-delivery-efficiency-guardrail
  - story-vibepro-content-scoped-evidence-reuse-key
reason: "managed worktreeは作成時にcopyWorkspaceControlFiles()で.vibepro/config.jsonをコピーするが、refreshManagedWorktree()が再同期しないため、コピーが凍結スナップショットになる。親repoにbudgets.delivery_efficiency（PR #370のトークン/subagent予算enforcement）等のポリシーを配布しても既存worktreeへ永遠に届かず、予算enforcementが古い値のまま実行される。修正はrefresh時のポリシーセクション（budgets/execution/artifact_routing/output）の再同期に限定し、story catalog等のスナップショットセクションは凍結のまま維持する。rollback: refreshManagedWorktree内の同期呼び出しをrevertすれば従来の凍結挙動へ戻る。"
created_at: 2026-07-21
updated_at: 2026-07-21
---

# Managed worktreeのポリシーconfigを凍結させず親repoから再同期する

## User Value

親repoの.vibepro/config.jsonで配布したポリシー（budgets.delivery_efficiency等のトークン/subagent予算enforcement）が、既存のmanaged worktreeにもrefresh時点で確実に反映され、worktreeごとに古い予算・実行ポリシーで動き続けることがなくなる。

## Background（コード事実）

- `src/managed-worktree.js` の `ensureManagedWorktree()` は作成/再利用時に `copyWorkspaceControlFiles()` で親repoの `.vibepro/config.json` と manifest をworktreeへ全量コピーする。
- 一方、保護コマンド経路（`evaluateManagedWorktreeCommandContext` / `buildManagedWorktreeGate` / `execution-state.js`）から毎回呼ばれる `refreshManagedWorktree()` は、status・branch・HEAD・dirty fingerprintを再計算するだけで、configの再同期を一切行わない。
- このためworktree作成後に親repoへ配布されたポリシー変更（例: PR #370で導入予定の `budgets.delivery_efficiency`。`agent-review` は `budgets.delivery_efficiency` 欠如時にreview authorizeをエラーにする）は、既存worktreeのconfigコピーには届かない。
- worktreeのconfigコピーは `ensureManagedWorktreeGitExclude()` でgit管理外（info/exclude）のため、gitの仕組みでも更新されない。

## Acceptance Criteria

- [ ] MWPR-S-1: `refreshManagedWorktree()` は、worktreeが存在する場合に親repo（`managed_worktree.source_repo`、なければ引数repoRoot）の `.vibepro/config.json` からポリシーセクション（`budgets` / `execution` / `artifact_routing` / `output`）をworktreeのconfigコピーへ再同期する。
- [ ] MWPR-S-2: 非ポリシーセクション（`brainbase` story catalog等）は再同期対象外で、worktree作成時のスナップショットのまま維持される。
- [ ] MWPR-S-3: 親configでポリシーセクション配下の値が削除された場合、worktreeコピーからも削除される（mirror semantics。片方向: 親→worktreeのみ）。
- [ ] MWPR-S-4: 再同期の結果（synced / unchanged / skipped / failed と更新セクション一覧）が refresh結果の `policy_sync` フィールドとして返り、実行state経由で監査できる。親config欠如や読み取り失敗はrefresh全体を失敗させない（fail-soft）。
- [ ] MWPR-S-5: worktree内部から呼ばれた場合（repoRoot=worktreeパス）でも `source_repo` を親として同期し、source_repoとworktreeが同一パスの場合は同期をスキップする。
- [ ] MWPR-S-6: contract testで「親に `budgets.delivery_efficiency` を追加→refresh後にworktreeコピーへ届く」「非ポリシーセクションは凍結」「変更なしの2回目refreshは unchanged」「worktree内からのrefreshでも同期」「親でのセクション削除がミラーされる」を固定する。

## Non Goals

- `budgets.delivery_efficiency` 自体のスキーマ・enforcement仕様（PR #370）の変更。
- `ensureManagedWorktree()` の作成/再利用時の全量コピー挙動の変更。
- manifest（`vibepro-manifest.json`）の再同期。
- worktree cleanup・ライフサイクル管理の変更。
