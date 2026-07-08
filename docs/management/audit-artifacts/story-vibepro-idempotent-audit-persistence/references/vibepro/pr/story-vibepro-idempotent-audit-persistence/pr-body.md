## 判断
- このPRで判断すること: main の直近40コミット中22本が persist audit artifacts で、全 story で同一メッセージのコミットが2回ずつ入っている を満たすための Runtime / Contract Docs / Tests 変更として、このPRを受け入れてよいか。
- Story: story-vibepro-idempotent-audit-persistence - main の直近40コミット中22本が persist audit artifacts で、全 story で同一メッセージのコミットが2回ずつ入っている
- 正本: [docs/management/stories/active/story-vibepro-idempotent-audit-persistence.md](docs/management/stories/active/story-vibepro-idempotent-audit-persistence.md)
- 変更範囲: 6 files / Runtime / Contract Docs / Tests
- 設計/Story: [docs/management/stories/active/story-vibepro-idempotent-audit-persistence.md](docs/management/stories/active/story-vibepro-idempotent-audit-persistence.md), [docs/architecture/vibepro-idempotent-audit-persistence.md](docs/architecture/vibepro-idempotent-audit-persistence.md)
- 実装: [src/canonical-audit.js](src/canonical-audit.js)
- テスト: [test/canonical-audit-idempotent-persistence.test.js](test/canonical-audit-idempotent-persistence.test.js), [test/vibepro-cli.test.js](test/vibepro-cli.test.js)

## 経緯
- 要求: main の直近40コミット中22本が persist audit artifacts で、全 story で同一メッセージのコミットが2回ずつ入っている
- 発生経緯: `execute merge` は canonical audit bundle を base ブランチへ持ち回る際、`persistCanonicalAuditToBase` を 2 回呼ぶ（`src/merge-manager.js` の 1 回目: merge 直後、2 回目: 最終 merge artifact を bundle に含めた後）。2 回目のための bundle 再生成で `promoted_at` タイムスタンプと gzip 再圧縮のバイト列が毎回変わるため、`already_present` 判定（`git diff --cached --quiet`）が論理的に同一内容でも絶対に成立せず、**全 story


## 原因
- 最新診断gateが needs_review

## 解決
- Story文書を更新: [docs/management/stories/active/story-vibepro-idempotent-audit-persistence.md](docs/management/stories/active/story-vibepro-idempotent-audit-persistence.md)

## レビュー観点
- Gate: 未解決の必須Gateはありません。ただしリリース判断Warning: Managed Worktree Gate。 詳細はVibePro証跡の Gate DAG / Gate Enforcement を確認してください。
- Scope: 差分範囲の説明または分割判断が必要。理由: baseからのcommitが 4 件あり、Story外の変更混入を確認する必要がある / split=split_by_lane_then_prepare
- 管理worktree: needs_review
- Storyの受け入れ基準と実装差分が対応しているか
- 主要ソース差分: [src/canonical-audit.js](src/canonical-audit.js)
- テスト差分: [test/canonical-audit-idempotent-persistence.test.js](test/canonical-audit-idempotent-persistence.test.js), [test/vibepro-cli.test.js](test/vibepro-cli.test.js)
- Risk: 最新診断gateが needs_review

## 確認
- [x] verification:typecheck - [package.json](package.json) の typecheck scriptでTypeScript/型境界を確認する / gate: passed / evidence: ../claude-502/-Users-ksato-workspace-code-vibepro--claude-worktrees-charming-lamport-915b50/668c5454-826e-4d87-a655-08eb9663bc74/scratchpad/iap-evidence/typecheck-status.json
- [x] Unit Gate - Focused unit regression 9/9 pass at head 0e21970f using a real byte fixture plus headless replay assertion, with durable status artifact from the actual exit code. Includes the review-driven regression test: withCanonicalAuditBookkeeping now injects roi_ledger_promotion exactly as merge-manager does, and the suite fails without the exclusion fix (verified: 8 pass 1 fail with fix stripped, 9 pass with fix). Covers IAP-CONTRACT-001 deterministic bytes incl. mtime-free gzip, IAP-CONTRACT-002 stable promoted_at carry-forward, IAP-CONTRACT-003 at most one persistence commit with already_present, IAP-CONTRACT-004 unparseable fallback toward duplication never loss, IAP-CONTRACT-005 replay compatibility.; evidence: ../claude-502/-Users-ksato-workspace-code-vibepro--claude-worktrees-charming-lamport-915b50/668c5454-826e-4d87-a655-08eb9663bc74/scratchpad/iap-evidence/unit-status.json / gate: passed / evidence: ../claude-502/-Users-ksato-workspace-code-vibepro--claude-worktrees-charming-lamport-915b50/668c5454-826e-4d87-a655-08eb9663bc74/scratchpad/iap-evidence/unit-status.json
- [x] Integration Gate - artifact_replay: vibepro pr prepare replays the full Gate DAG at head 0e21970f with durable status artifact generated from the actual exit code; gate-dag.json, pr-prepare.json and evidence plans regenerated headlessly. Current reality: the canonical audit persistence change alters bundle generation determinism, the already_present dedupe path, and excludes canonical_audit plus roi_ledger_promotion bookkeeping from the promoted view; no scheduler, network, or new command surface. Failure modes stay loud: unparseable existing bundle falls back to fresh content and persistence proceeds (duplication over loss, IAP-CONTRACT-004).; evidence: ../claude-502/-Users-ksato-workspace-code-vibepro--claude-worktrees-charming-lamport-915b50/668c5454-826e-4d87-a655-08eb9663bc74/scratchpad/iap-evidence/build-status.json / gate: passed / evidence: ../claude-502/-Users-ksato-workspace-code-vibepro--claude-worktrees-charming-lamport-915b50/668c5454-826e-4d87-a655-08eb9663bc74/scratchpad/iap-evidence/build-status.json
- [x] E2E Gate - CLI acceptance scenarios 3/3 pass end-to-end at head 0e21970f with durable status artifact from the actual exit code. scenario_clause_e2e: spec clauses S-001, S-002, S-003 driven through the real vibepro execute-merge CLI path against a bare remote. flow_replay: promote -> persist -> merge artifacts -> final persist replays headlessly with roi_ledger_promotion bookkeeping excluded from the promoted view.; evidence: ../claude-502/-Users-ksato-workspace-code-vibepro--claude-worktrees-charming-lamport-915b50/668c5454-826e-4d87-a655-08eb9663bc74/scratchpad/iap-evidence/e2e-status.json / gate: passed / evidence: ../claude-502/-Users-ksato-workspace-code-vibepro--claude-worktrees-charming-lamport-915b50/668c5454-826e-4d87-a655-08eb9663bc74/scratchpad/iap-evidence/e2e-status.json
- 最終E2E: pass: CLI acceptance scenarios 3/3 pass end-to-end at head 0e21970f with durable status artifact from the actual exit code. scenario_clause_e2e: spec clauses S-001, S-002, S-003 driven through the real vibepro execute-merge CLI path against a bare remote. flow_replay: promote -> persist -> merge artifacts -> final persist replays headlessly with roi_ledger_promotion bookkeeping excluded from the promoted view.（../claude-502/-Users-ksato-workspace-code-vibepro--claude-worktrees-charming-lamport-915b50/668c5454-826e-4d87-a655-08eb9663bc74/scratchpad/iap-evidence/e2e-status.json）

## 詳細
- 証跡: [.vibepro/pr/story-vibepro-idempotent-audit-persistence/](.vibepro/pr/story-vibepro-idempotent-audit-persistence/)
- PR準備: [.vibepro/pr/story-vibepro-idempotent-audit-persistence/pr-prepare.json](.vibepro/pr/story-vibepro-idempotent-audit-persistence/pr-prepare.json)
- 判断索引: [.vibepro/pr/story-vibepro-idempotent-audit-persistence/decision-index.json](.vibepro/pr/story-vibepro-idempotent-audit-persistence/decision-index.json)
- Gate: ready_for_review
- 実行状態: ready
- Scope: needs_clean_branch / clean_branch_or_split_pr
- Runtime: vibepro@0.1.0-beta.0 8b91e3fce07f detached/package clean (story=story-vibepro-idempotent-audit-persistence)
