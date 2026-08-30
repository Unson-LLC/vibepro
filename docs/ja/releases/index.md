# リリースノート

VibeProで何が変わったかを、公開版と開発中の変更を分けて記録します。

## 公開版と開発マイルストーン

- **公開版**はGitHub Release、git tag、npm registryで確認できる版です。
- **開発マイルストーン**は、マージ済みPRから主要な変化を月ごとに再構成したものです。npmへ公開済みとは限りません。

2026年7月16日時点で、GitHubには**281件のmerged PR**があり、そのうち**273件が`main`向け**です。全件を並べるのではなく、利用・更新判断に影響するPRを選び、根拠として直接リンクしています。

## 公開済み

| 公開日 | Version | Channel | 内容 |
| --- | --- | --- | --- |
| 2026-08-30 | [`0.2.0-beta.17`](https://www.npmjs.com/package/vibepro/v/0.2.0-beta.17) | npm `beta` / `latest` | PRマージ後のcontinuous release |
| 2026-08-25 | [`0.2.0-beta.16`](https://www.npmjs.com/package/vibepro/v/0.2.0-beta.16) | npm `beta` / `latest` | PRマージ後のcontinuous release |
| 2026-08-24 | [`0.2.0-beta.15`](https://www.npmjs.com/package/vibepro/v/0.2.0-beta.15) | npm `beta` / `latest` | PRマージ後のcontinuous release |
| 2026-08-24 | [`0.2.0-beta.14`](https://www.npmjs.com/package/vibepro/v/0.2.0-beta.14) | npm `beta` / `latest` | PRマージ後のcontinuous release |
| 2026-08-23 | [`0.2.0-beta.13`](https://www.npmjs.com/package/vibepro/v/0.2.0-beta.13) | npm `beta` / `latest` | PRマージ後のcontinuous release |
| 2026-08-22 | [`0.2.0-beta.12`](https://www.npmjs.com/package/vibepro/v/0.2.0-beta.12) | npm `beta` / `latest` | PRマージ後のcontinuous release |
| 2026-08-21 | [`0.2.0-beta.11`](https://www.npmjs.com/package/vibepro/v/0.2.0-beta.11) | npm `beta` / `latest` | PRマージ後のcontinuous release |
| 2026-08-17 | [`0.2.0-beta.10`](https://www.npmjs.com/package/vibepro/v/0.2.0-beta.10) | npm `beta` / `latest` | PRマージ後のcontinuous release |
| 2026-08-15 | [`0.2.0-beta.9`](https://www.npmjs.com/package/vibepro/v/0.2.0-beta.9) | npm `beta` / `latest` | PRマージ後のcontinuous release |
| 2026-08-12 | [`0.2.0-beta.8`](https://www.npmjs.com/package/vibepro/v/0.2.0-beta.8) | npm `beta` / `latest` | PRマージ後のcontinuous release |
| 2026-08-12 | [`0.2.0-beta.7`](https://www.npmjs.com/package/vibepro/v/0.2.0-beta.7) | npm `beta` / `latest` | PRマージ後のcontinuous release |
| 2026-08-11 | [`0.2.0-beta.6`](https://www.npmjs.com/package/vibepro/v/0.2.0-beta.6) | npm `beta` / `latest` | PRマージ後のcontinuous release |
| 2026-08-10 | [`0.2.0-beta.5`](https://www.npmjs.com/package/vibepro/v/0.2.0-beta.5) | npm `beta` / `latest` | PRマージ後のcontinuous release |
| 2026-08-07 | [`0.2.0-beta.4`](https://www.npmjs.com/package/vibepro/v/0.2.0-beta.4) | npm `beta` / `latest` | PRマージ後のcontinuous release |
| 2026-08-07 | [`0.2.0-beta.3`](https://www.npmjs.com/package/vibepro/v/0.2.0-beta.3) | npm `beta` / `latest` | PRマージ後のcontinuous release |
| 2026-07-29 | [`0.2.0-beta.2`](https://www.npmjs.com/package/vibepro/v/0.2.0-beta.2) | npm `beta` / `latest` | PRマージ後のcontinuous release |
| 2026-07-18 | [`0.2.0-beta.1`](https://www.npmjs.com/package/vibepro/v/0.2.0-beta.1) | npm `latest` / `beta` | PRマージ後のcontinuous release |
| 2026-07-16 | [`0.2.0-beta.0`](https://www.npmjs.com/package/vibepro/v/0.2.0-beta.0) | npm `latest` / `beta` | release workflow完了後の現在の公開beta |
| 2026-06-07 | [`0.1.0-beta.0`](https://www.npmjs.com/package/vibepro/v/0.1.0-beta.0) | npm | 以前の公開beta |
| 2026-06-07 | [`0.1.0-alpha.0`](https://www.npmjs.com/package/vibepro/v/0.1.0-alpha.0) | npm `alpha` | 最初のnpm公開版 |
| 2026-05-05 | [`v0.1.0-internal-beta.1`](https://github.com/Unson-LLC/vibepro/releases/tag/v0.1.0-internal-beta.1) | GitHub pre-release / tag | internal beta |

## 開発履歴

| 期間 | Merged PR | 主な変化 |
| --- | ---: | --- |
| [2026年7月](/ja/releases/2026-07) | 64 | bounded evidence、UI/UX cockpit、semantic adjudication、guarded execution |
| [2026年6月](/ja/releases/2026-06) | 115 | Journey、managed worktree/merge、canonical audit、Design SSOT |
| [2026年5月](/ja/releases/2026-05) | 101 | Story/Spec/Gate基盤、review lifecycle、公開前check pack |
| [2026年1月](/ja/releases/2026-01) | 1 | 公開サイト検証の起点 |

実行中の版を確かめる場合は[バージョンとリリースチャネル](/ja/reference/version-history)を参照してください。全PRは[GitHubのmerged PR一覧](https://github.com/Unson-LLC/vibepro/pulls?q=is%3Apr+is%3Amerged)で確認できます。

<!-- vibepro-release-index-pr:349:start -->
- [PR #349](https://github.com/Unson-LLC/vibepro/pull/349) — [2026-07](/ja/releases/2026-07): story-vibepro-pr-driven-continuous-release - PRマージからマニュアル・VitePress・npmまで完全自動でリリースする
<!-- vibepro-release-index-pr:349:end -->

<!-- vibepro-release-index-pr:350:start -->
- [PR #350](https://github.com/Unson-LLC/vibepro/pull/350) — [2026-07](/ja/releases/2026-07): story-vibepro-post-merge-docs-clean-worktree - Keep the post-merge docs deployment worktree clean
<!-- vibepro-release-index-pr:350:end -->

<!-- vibepro-release-index-pr:351:start -->
- [PR #351](https://github.com/Unson-LLC/vibepro/pull/351) — [2026-07](/ja/releases/2026-07): story-vibepro-linux-rollup-ci-lock - Make the VitePress lockfile installable on Linux CI
<!-- vibepro-release-index-pr:351:end -->

<!-- vibepro-release-index-pr:352:start -->
- [PR #352](https://github.com/Unson-LLC/vibepro/pull/352) — [2026-07](/ja/releases/2026-07): story-vibepro-next-best-action-controller - トークン最小ではなくTrusted PR-readyまでの総コストで次のActionを選びたい
<!-- vibepro-release-index-pr:352:end -->

<!-- vibepro-release-index-pr:353:start -->
- [PR #353](https://github.com/Unson-LLC/vibepro/pull/353) — [2026-07](/ja/releases/2026-07): story-vibepro-autonomy-roadmap-rebaseline - 直近追加Storyと衝突しない実装順へ再編したい
<!-- vibepro-release-index-pr:353:end -->

<!-- vibepro-release-index-pr:355:start -->
- [PR #355](https://github.com/Unson-LLC/vibepro/pull/355) — [2026-07](/ja/releases/2026-07): story-vibepro-release-note-link-normalization - Release noteのrepo-root docsリンクをcanonical source URLへ正規化する
<!-- vibepro-release-index-pr:355:end -->

<!-- vibepro-release-index-pr:354:start -->
- [PR #354](https://github.com/Unson-LLC/vibepro/pull/354) — [2026-07](/ja/releases/2026-07): story-vibepro-artifact-output-routing - 成果物の正本出力先をリポジトリ設定で一意に制御する
<!-- vibepro-release-index-pr:354:end -->

<!-- vibepro-release-index-pr:357:start -->
- [PR #357](https://github.com/Unson-LLC/vibepro/pull/357) — [2026-07](/ja/releases/2026-07): story-vibepro-human-decision-checkpoint - 自律実行中に本当に必要な質問だけを受け、回答後に同じRunを再開したい
<!-- vibepro-release-index-pr:357:end -->

<!-- vibepro-release-index-pr:360:start -->
- [PR #360](https://github.com/Unson-LLC/vibepro/pull/360) — [2026-07](/ja/releases/2026-07): story-vibepro-agent-runtime-adapters - handoffとreview dispatch文書を作るだけでなく、利用可能なagent runtimeへ実行委譲したい
<!-- vibepro-release-index-pr:360:end -->

<!-- vibepro-release-index-pr:362:start -->
- [PR #362](https://github.com/Unson-LLC/vibepro/pull/362) — [2026-07](/ja/releases/2026-07): story-vibepro-risk-adaptive-validation-sequencing - 高コストFull Suite後に境界欠陥が見つかり、修正で証跡を全て取り直す順序を改善したい
<!-- vibepro-release-index-pr:362:end -->

<!-- vibepro-release-index-pr:363:start -->
- [PR #363](https://github.com/Unson-LLC/vibepro/pull/363) — [2026-07](/ja/releases/2026-07): story-vibepro-review-finding-repair-loop - needs_changesを停止報告で終わらせず、修正・再検証・再Reviewへ閉ループ化したい
<!-- vibepro-release-index-pr:363:end -->

<!-- vibepro-release-index-pr:364:start -->
- [PR #364](https://github.com/Unson-LLC/vibepro/pull/364) — [2026-07](/ja/releases/2026-07): story-vibepro-story-run-portfolio-controller - 複数Storyを一つの長大sessionへ混載せず、Storyごとに閉じて順次進めたい
<!-- vibepro-release-index-pr:364:end -->

<!-- vibepro-release-index-pr:366:start -->
- [PR #366](https://github.com/Unson-LLC/vibepro/pull/366) — [2026-07](/ja/releases/2026-07): story-vibepro-guarded-autonomy-hardening - 自律ループを無限実行や自己Reviewにせず、費用・時間・停止理由まで運用可能にしたい
<!-- vibepro-release-index-pr:366:end -->

<!-- vibepro-release-index-pr:367:start -->
- [PR #367](https://github.com/Unson-LLC/vibepro/pull/367) — [2026-07](/ja/releases/2026-07): feat(artifact-routing): add profile-based projections
<!-- vibepro-release-index-pr:367:end -->

<!-- vibepro-release-index-pr:368:start -->
- [PR #368](https://github.com/Unson-LLC/vibepro/pull/368) — [2026-07](/ja/releases/2026-07): story-vibepro-canonical-audit-gate-dag-replay - Summary depthのCanonical Audit Replayを欠損なく引き継ぐ
<!-- vibepro-release-index-pr:368:end -->

<!-- vibepro-release-index-pr:369:start -->
- [PR #369](https://github.com/Unson-LLC/vibepro/pull/369) — [2026-07](/ja/releases/2026-07): feat: add explicit Run attribution lineage
<!-- vibepro-release-index-pr:369:end -->

<!-- vibepro-release-index-pr:371:start -->
- [PR #371](https://github.com/Unson-LLC/vibepro/pull/371) — [2026-07](/ja/releases/2026-07): story-vibepro-explicit-run-attribution-lineage - Codex DesktopのThreadと内部sessionの対応は公開契約ではなく、利用者によるThread分離を正確な価値監査の前提にできない
<!-- vibepro-release-index-pr:371:end -->

<!-- vibepro-release-index-pr:374:start -->
- [PR #374](https://github.com/Unson-LLC/vibepro/pull/374) — [2026-07](/ja/releases/2026-07): story-vibepro-managed-worktree-policy-resync - Managed worktreeのポリシーconfigを凍結させず親repoから再同期する
<!-- vibepro-release-index-pr:374:end -->

<!-- vibepro-release-index-pr:345:start -->
- [PR #345](https://github.com/Unson-LLC/vibepro/pull/345) — [2026-07](/ja/releases/2026-07): story-vibepro-session-attribution-boundary-guard - 2026-07-09 の価値監査で親 session 019f3f8c が複数の関連 story を混載し、strict と worktree-bound の attribution 乖離（例: docs-feature-map strict 1h24m vs bound 11h24m 相当）が前回監査から横ばいのまま残った
<!-- vibepro-release-index-pr:345:end -->

<!-- vibepro-release-index-pr:373:start -->
- [PR #373](https://github.com/Unson-LLC/vibepro/pull/373) — [2026-07](/ja/releases/2026-07): story-vibepro-routing-profiles-rendered-projections - Story別routing profileとlineage付きprojectionでfeature packetを正本化する
<!-- vibepro-release-index-pr:373:end -->

<!-- vibepro-release-index-pr:375:start -->
- [PR #375](https://github.com/Unson-LLC/vibepro/pull/375) — [2026-07](/ja/releases/2026-07): fix: policy_syncレビュー残課題3件を解消（#374 フォローアップ）
<!-- vibepro-release-index-pr:375:end -->

<!-- vibepro-release-index-pr:372:start -->
- [PR #372](https://github.com/Unson-LLC/vibepro/pull/372) — [2026-07](/ja/releases/2026-07): story-vibepro-autonomous-action-dag - Guarded Runを完全な型付き自律Action DAGへ拡張する
<!-- vibepro-release-index-pr:372:end -->

<!-- vibepro-release-index-pr:370:start -->
- [PR #370](https://github.com/Unson-LLC/vibepro/pull/370) — [2026-07](/ja/releases/2026-07): story-vibepro-trusted-delivery-efficiency-guardrail - 個別Gateの安全性だけでなく、Story全体の時間・subagent・token・再レビューを最適化したい
<!-- vibepro-release-index-pr:370:end -->

<!-- vibepro-release-index-pr:377:start -->
- [PR #377](https://github.com/Unson-LLC/vibepro/pull/377) — [2026-07](/ja/releases/2026-07): story-vibepro-production-runtime-connectors - Agent Runtime Adapterへproduction connectorを接続する
<!-- vibepro-release-index-pr:377:end -->

<!-- vibepro-release-index-pr:378:start -->
- [PR #378](https://github.com/Unson-LLC/vibepro/pull/378) — [2026-07](/ja/releases/2026-07): story-vibepro-target-architecture-conformance - Target Architecture SSOTとconformance dry-runを導入する
<!-- vibepro-release-index-pr:378:end -->

<!-- vibepro-release-index-pr:379:start -->
- [PR #379](https://github.com/Unson-LLC/vibepro/pull/379) — [2026-07](/ja/releases/2026-07): story-vibepro-node20-e2e-ts-ci-visibility - Node 20 CIレーンのe2e .ts spec偽passを可視化しNode 22+必須ゲートで実行する
<!-- vibepro-release-index-pr:379:end -->

<!-- vibepro-release-index-pr:380:start -->
- [PR #380](https://github.com/Unson-LLC/vibepro/pull/380) — [2026-07](/ja/releases/2026-07): story-vibepro-canonical-audit-review-root-state-files - Canonical auditがreview root直下のstory-level state fileでmergeを失敗させないようにする
<!-- vibepro-release-index-pr:380:end -->

<!-- vibepro-release-index-pr:382:start -->
- [PR #382](https://github.com/Unson-LLC/vibepro/pull/382) — [2026-07](/ja/releases/2026-07): story-vibepro-independent-review-orchestration - Required Reviewを独立agentへ自動dispatchして記録する
<!-- vibepro-release-index-pr:382:end -->

<!-- vibepro-release-index-pr:383:start -->
- [PR #383](https://github.com/Unson-LLC/vibepro/pull/383) — [2026-07](/ja/releases/2026-07): story-vibepro-merge-waiver-propagation - PR作成時の監査可能なGate waiverをexecute mergeへ安全に伝播する
<!-- vibepro-release-index-pr:383:end -->

<!-- vibepro-release-index-pr:358:start -->
- [PR #358](https://github.com/Unson-LLC/vibepro/pull/358) — [2026-07](/ja/releases/2026-07): story-vibepro-atomic-scope-review-contract - 大規模Storyが自ら追加したscope policyで自身の単一PRを承認できる循環を除く
<!-- vibepro-release-index-pr:358:end -->

<!-- vibepro-release-index-pr:381:start -->
- [PR #381](https://github.com/Unson-LLC/vibepro/pull/381) — [2026-07](/ja/releases/2026-07): story-vibepro-codex-detached-completion-inbox - 10分wait超過でsubagent成果を失わず、後継Runが完了通知を回収したい
<!-- vibepro-release-index-pr:381:end -->

<!-- vibepro-release-index-pr:384:start -->
- [PR #384](https://github.com/Unson-LLC/vibepro/pull/384) — [2026-07](/ja/releases/2026-07): Agent Review freshnessを検査surfaceとrelease-impactに束縛する
<!-- vibepro-release-index-pr:384:end -->

<!-- vibepro-release-index-pr:356:start -->
- [PR #356](https://github.com/Unson-LLC/vibepro/pull/356) — [2026-07](/ja/releases/2026-07): story-vibepro-delivery-reconciliation-state - 外部マージ済みPRの再読込が、現在HEADのgate driftを隠して成功終了し得る
<!-- vibepro-release-index-pr:356:end -->

<!-- vibepro-release-index-pr:385:start -->
- [PR #385](https://github.com/Unson-LLC/vibepro/pull/385) — [2026-07](/ja/releases/2026-07): story-vibepro-one-command-pr-ready-closure - 1コマンド自律実装を実Runtime E2Eで閉じる
<!-- vibepro-release-index-pr:385:end -->

<!-- vibepro-release-index-pr:386:start -->
- [PR #386](https://github.com/Unson-LLC/vibepro/pull/386) — [2026-07](/ja/releases/2026-07): story-vibepro-one-command-pr-ready-closure - 1コマンド自律実装を実Runtime E2Eで閉じる
<!-- vibepro-release-index-pr:386:end -->

<!-- vibepro-release-index-pr:387:start -->
- [PR #387](https://github.com/Unson-LLC/vibepro/pull/387) — [2026-07](/ja/releases/2026-07): story-vibepro-infra-story-dependency-cut - workspace-infraからstoryへの許可外依存を削減する
<!-- vibepro-release-index-pr:387:end -->

<!-- vibepro-release-index-pr:388:start -->
- [PR #388](https://github.com/Unson-LLC/vibepro/pull/388) — [2026-07](/ja/releases/2026-07): story-vibepro-autonomous-roadmap-catalog-closure - 自律実装ロードマップのStory catalogを完了状態へ整合する
<!-- vibepro-release-index-pr:388:end -->

<!-- vibepro-release-index-pr:365:start -->
- [PR #365](https://github.com/Unson-LLC/vibepro/pull/365) — [2026-07](/ja/releases/2026-07): story-vibepro-gate-decision-outcome-ledger - 実欠陥を捕捉したgate findingが実装修正・PR・mergeへ接続した価値を監査から再構成しにくい
<!-- vibepro-release-index-pr:365:end -->

<!-- vibepro-release-index-pr:389:start -->
- [PR #389](https://github.com/Unson-LLC/vibepro/pull/389) — [2026-07](/ja/releases/2026-07): story-vibepro-conformance-nul-escape - architecture-conformance.jsの生NULバイトを\0エスケープに置換しテキストファイル性を回復する
<!-- vibepro-release-index-pr:389:end -->

<!-- vibepro-release-index-pr:390:start -->
- [PR #390](https://github.com/Unson-LLC/vibepro/pull/390) — [2026-07](/ja/releases/2026-07): story-vibepro-import-based-conformance - モジュール間依存の測定をGraphify callsから実import文スキャンへ切り替える
<!-- vibepro-release-index-pr:390:end -->

<!-- vibepro-release-index-pr:361:start -->
- [PR #361](https://github.com/Unson-LLC/vibepro/pull/361) — [2026-07](/ja/releases/2026-07): story-vibepro-symlinked-bin-entrypoint - symlink経由でもVibePro CLIを実行する
<!-- vibepro-release-index-pr:361:end -->

<!-- vibepro-release-index-pr:217:start -->
- [PR #217](https://github.com/Unson-LLC/vibepro/pull/217) — [2026-07](/ja/releases/2026-07): chore(deps): bump actions/checkout from 6 to 7
<!-- vibepro-release-index-pr:217:end -->

<!-- vibepro-release-index-pr:391:start -->
- [PR #391](https://github.com/Unson-LLC/vibepro/pull/391) — [2026-07](/ja/releases/2026-07): story-vibepro-ideal-state-inversion - senior-gap judgmentのideal_stateがStoryではなく裁定済みtarget architectureを参照するようにする
<!-- vibepro-release-index-pr:391:end -->

<!-- vibepro-release-index-pr:392:start -->
- [PR #392](https://github.com/Unson-LLC/vibepro/pull/392) — [2026-07](/ja/releases/2026-07): story-vibepro-docs-only-evidence-profile - budget exceeded 19/71の大半が製品変更0行のdocs/roadmap Storyで、bundleが3,700〜5,000行に膨らみ、計測上もdiff base喪失でratioが壊れている
<!-- vibepro-release-index-pr:392:end -->

<!-- vibepro-release-index-pr:394:start -->
- [PR #394](https://github.com/Unson-LLC/vibepro/pull/394) — [2026-07](/ja/releases/2026-07): feat: support task-scoped PR acceptance gates
<!-- vibepro-release-index-pr:394:end -->

<!-- vibepro-release-index-pr:395:start -->
- [PR #395](https://github.com/Unson-LLC/vibepro/pull/395) — [2026-07](/ja/releases/2026-07): story-vibepro-runner-direct-evidence - 先行Storyで『441/441で再実行した』という真の主張ですら、artifactが前回と同一内容のためgit上で検証不能になり3ラウンド連続で指摘された。head_shaを手で足す対処をしたが、根本は実行した者と記録する者が同一であること
<!-- vibepro-release-index-pr:395:end -->

<!-- vibepro-release-index-pr:396:start -->
- [PR #396](https://github.com/Unson-LLC/vibepro/pull/396) — [2026-07](/ja/releases/2026-07): story-vibepro-release-0-2-0-beta-2 - runner-direct evidence (PR #395) を含む #356〜#395 の約20PR分が npm 未公開のまま main に滞留している
<!-- vibepro-release-index-pr:396:end -->

<!-- vibepro-release-index-pr:397:start -->
- [PR #397](https://github.com/Unson-LLC/vibepro/pull/397) — [2026-07](/ja/releases/2026-07): story-vibepro-review-surface-violation-ledger - 先行 Story の round 6 で、実装エージェントがレビュー実行中にツリーを変更した。lifecycle は start 時の head_sha しか記録しないため機械検出されず、レビュアーが git status を偶然見て発見した。違反は stale と同じ failed 表示になり、レビュー再実行で痕跡ごと消えた
<!-- vibepro-release-index-pr:397:end -->

<!-- vibepro-release-index-pr:398:start -->
- [PR #398](https://github.com/Unson-LLC/vibepro/pull/398) — [2026-07](/ja/releases/2026-07): story-vibepro-merge-binding-stale-stop-reason - Clear stale decision-outcome-binding failure flags when rebinding succeeds
<!-- vibepro-release-index-pr:398:end -->

<!-- vibepro-release-index-pr:399:start -->
- [PR #399](https://github.com/Unson-LLC/vibepro/pull/399) — [2026-07](/ja/releases/2026-07): fix: keep session-cost available on corrupt process metadata
<!-- vibepro-release-index-pr:399:end -->

<!-- vibepro-release-index-pr:403:start -->
- [PR #403](https://github.com/Unson-LLC/vibepro/pull/403) — [2026-07](/ja/releases/2026-07): story-vibepro-process-record-worktree-durability - プロセス記録をworktreeライフサイクルから切り離して永続化する
<!-- vibepro-release-index-pr:403:end -->

<!-- vibepro-release-index-pr:404:start -->
- [PR #404](https://github.com/Unson-LLC/vibepro/pull/404) — [2026-07](/ja/releases/2026-07): story-vibepro-task-atomic-repo-control-contract - Taskが同一HEADを要求するworkflowとruntimeを現行split policyが強制分離する矛盾を解消する
<!-- vibepro-release-index-pr:404:end -->

<!-- vibepro-release-index-pr:405:start -->
- [PR #405](https://github.com/Unson-LLC/vibepro/pull/405) — [2026-07](/ja/releases/2026-07): fix: recover terminal review replacement lifecycle
<!-- vibepro-release-index-pr:405:end -->

<!-- vibepro-release-index-pr:401:start -->
- [PR #401](https://github.com/Unson-LLC/vibepro/pull/401) — [2026-08](/ja/releases/2026-08): story-vibepro-verify-command-test-path-existence-guard - verify record/runのコマンドが名指しするtest fileパスの実在を検証する
<!-- vibepro-release-index-pr:401:end -->

<!-- vibepro-release-index-pr:406:start -->
- [PR #406](https://github.com/Unson-LLC/vibepro/pull/406) — [2026-08](/ja/releases/2026-08): story-vibepro-budget-grant-tracked-decision-doc - budget grant を diff でレビュー可能にする: decision record --source budget:delivery_efficiency:* が tracked decision document を必ず書く
<!-- vibepro-release-index-pr:406:end -->

<!-- vibepro-release-index-pr:407:start -->
- [PR #407](https://github.com/Unson-LLC/vibepro/pull/407) — [2026-08](/ja/releases/2026-08): story-vibepro-vacuous-e2e-test-elimination - test/e2e配下に、テスト内で定義した文字列リテラルを同じ文字列由来の正規表現でassert.matchするだけの、構造上失敗しないテストが19ファイル存在する
<!-- vibepro-release-index-pr:407:end -->

<!-- vibepro-release-index-pr:409:start -->
- [PR #409](https://github.com/Unson-LLC/vibepro/pull/409) — [2026-08](/ja/releases/2026-08): story-vibepro-profiler-file-walk-stack-overflow - architecture-profiler のファイル走査を反復処理化し、大規模treeでの "Maximum call stack size exceeded" を解消する
<!-- vibepro-release-index-pr:409:end -->

<!-- vibepro-release-index-pr:412:start -->
- [PR #412](https://github.com/Unson-LLC/vibepro/pull/412) — [2026-08](/ja/releases/2026-08): story-vibepro-unit-suite-concurrency-default - unit証跡の全体スイート実行を実測最適並列度に正本化し、verify runのタイムアウト余裕を確保する
<!-- vibepro-release-index-pr:412:end -->

<!-- vibepro-release-index-pr:415:start -->
- [PR #415](https://github.com/Unson-LLC/vibepro/pull/415) — [2026-08](/ja/releases/2026-08): story-vibepro-codex-host-containment-test-load-tolerance - test/codex-subagent-host.test.js の containment テストが load average 20-35 の full suite 実行時のみ condition timeout でフレークする
<!-- vibepro-release-index-pr:415:end -->

<!-- vibepro-release-index-pr:416:start -->
- [PR #416](https://github.com/Unson-LLC/vibepro/pull/416) — [2026-08](/ja/releases/2026-08): story-vibepro-uiux-intake-gate-pr-summary-surfaces - gate:uiux_intake_judgment を人間向けPRサマリー表面に表示する
<!-- vibepro-release-index-pr:416:end -->

<!-- vibepro-release-index-pr:413:start -->
- [PR #413](https://github.com/Unson-LLC/vibepro/pull/413) — [2026-08](/ja/releases/2026-08): story-vibepro-cross-system-adjudication - Cross-system adjudication requires a different model family than the implementer
<!-- vibepro-release-index-pr:413:end -->

<!-- vibepro-release-index-pr:417:start -->
- [PR #417](https://github.com/Unson-LLC/vibepro/pull/417) — [2026-08](/ja/releases/2026-08): story-vibepro-test-tmpdir-fixture-cleanup - テストスイートが$TMPDIRに残すmkdtemp fixtureのクリーンアップ機構
<!-- vibepro-release-index-pr:417:end -->

<!-- vibepro-release-index-pr:418:start -->
- [PR #418](https://github.com/Unson-LLC/vibepro/pull/418) — [2026-08](/ja/releases/2026-08): story-vibepro-verification-checkpoint-uiux-intake-gate - verification checkpoint の curated gate list に gate:uiux_intake_judgment を追加する
<!-- vibepro-release-index-pr:418:end -->

<!-- vibepro-release-index-pr:419:start -->
- [PR #419](https://github.com/Unson-LLC/vibepro/pull/419) — [2026-08](/ja/releases/2026-08): story-vibepro-pr-human-summary-dead-chain-removal - 死んだ人間向けPRサマリーレンダラーチェーンを削除する
<!-- vibepro-release-index-pr:419:end -->

<!-- vibepro-release-index-pr:420:start -->
- [PR #420](https://github.com/Unson-LLC/vibepro/pull/420) — [2026-08](/ja/releases/2026-08): story-vibepro-strict-head-binding-origin-guard - strict HEAD bindingをfrozen final_reviewとrole policy例外に限定する
<!-- vibepro-release-index-pr:420:end -->

<!-- vibepro-release-index-pr:414:start -->
- [PR #414](https://github.com/Unson-LLC/vibepro/pull/414) — [2026-08](/ja/releases/2026-08): story-vibepro-uiux-intake-judgment-gate - uiux intakeのSkill発火 + 判断記録gate
<!-- vibepro-release-index-pr:414:end -->

<!-- vibepro-release-index-pr:408:start -->
- [PR #408](https://github.com/Unson-LLC/vibepro/pull/408) — [2026-08](/ja/releases/2026-08): story-vibepro-progress-heartbeat-policy-kernel - src配下37箇所の長時間実行バウンドのうち理想形を満たすのはevaluateProgressBounds 1箇所のみ。バウンド皆無の子プロセスと進捗シグナル破棄サイトを正本kernelへ寄せたい
<!-- vibepro-release-index-pr:408:end -->

<!-- vibepro-release-index-pr:421:start -->
- [PR #421](https://github.com/Unson-LLC/vibepro/pull/421) — [2026-08](/ja/releases/2026-08): story-vibepro-conformance-delta-ledger - conformance delta ledger — base/head差分でアーキテクチャ逸脱を再現可能に観測する
<!-- vibepro-release-index-pr:421:end -->

<!-- vibepro-release-index-pr:422:start -->
- [PR #422](https://github.com/Unson-LLC/vibepro/pull/422) — [2026-08](/ja/releases/2026-08): fix: iterative pr-manager walkFiles + exclude .claude from repo scanners
<!-- vibepro-release-index-pr:422:end -->

<!-- vibepro-release-index-pr:424:start -->
- [PR #424](https://github.com/Unson-LLC/vibepro/pull/424) — [2026-08](/ja/releases/2026-08): story-vibepro-target-model-governance-rebaseline - target model governance rebaseline — 誰がモデルを変えてよいかを三分法で確定し、再baseline案と裁定カードを機械生成する
<!-- vibepro-release-index-pr:424:end -->

<!-- vibepro-release-index-pr:427:start -->
- [PR #427](https://github.com/Unson-LLC/vibepro/pull/427) — [2026-08](/ja/releases/2026-08): story-vibepro-target-model-projection-v2 - target model projection v2 — 佐藤裁定済みの5問を target-model.json へ機械的に投影し model_version を 2 へ上げる
<!-- vibepro-release-index-pr:427:end -->

<!-- vibepro-release-index-pr:428:start -->
- [PR #428](https://github.com/Unson-LLC/vibepro/pull/428) — [2026-08](/ja/releases/2026-08): story-vibepro-dependency-cycle-scc-reduction - dependency_cycle の SCC 縮約 — 69,490件の単純閉路列挙を「1つのSCC + 20の相互依存ペア」へ畳み、ratchet gate を載せられる粒度にする
<!-- vibepro-release-index-pr:428:end -->

<!-- vibepro-release-index-pr:429:start -->
- [PR #429](https://github.com/Unson-LLC/vibepro/pull/429) — [2026-08](/ja/releases/2026-08): refactor: 縮小リファクタ Slice 1 — 診断/UIUX/architecture/performanceスキャナ群を削除
<!-- vibepro-release-index-pr:429:end -->

<!-- vibepro-release-index-pr:430:start -->
- [PR #430](https://github.com/Unson-LLC/vibepro/pull/430) — [2026-08](/ja/releases/2026-08): refactor: 縮小リファクタ Slice 2 — 実行エンジン本体（execute/gate/adjudicate/outcome/checkpoint）を削除
<!-- vibepro-release-index-pr:430:end -->

<!-- vibepro-release-index-pr:431:start -->
- [PR #431](https://github.com/Unson-LLC/vibepro/pull/431) — [2026-08](/ja/releases/2026-08): refactor: 縮小リファクタ Slice 3 — delivery-efficiency予算全系を削除
<!-- vibepro-release-index-pr:431:end -->

<!-- vibepro-release-index-pr:432:start -->
- [PR #432](https://github.com/Unson-LLC/vibepro/pull/432) — [2026-08](/ja/releases/2026-08): refactor: 縮小リファクタ Slice 4 — run-context-capsuleスナップショット機構を削除（計画の実測更新込み）
<!-- vibepro-release-index-pr:432:end -->

<!-- vibepro-release-index-pr:435:start -->
- [PR #435](https://github.com/Unson-LLC/vibepro/pull/435) — [2026-08](/ja/releases/2026-08): feat: v-nextフォローアップ — report fingerprint再設計とstory_source/AC対応マップのpr prepare再統合
<!-- vibepro-release-index-pr:435:end -->

<!-- vibepro-release-index-pr:437:start -->
- [PR #437](https://github.com/Unson-LLC/vibepro/pull/437) — [2026-08](/ja/releases/2026-08): release: publish minimal core beta.3
<!-- vibepro-release-index-pr:437:end -->

<!-- vibepro-release-index-pr:438:start -->
- [PR #438](https://github.com/Unson-LLC/vibepro/pull/438) — [2026-08](/ja/releases/2026-08): fix: v-next外部repo初適用で見つかった不具合5件を修正 (#436)
<!-- vibepro-release-index-pr:438:end -->

<!-- vibepro-release-index-pr:442:start -->
- [PR #442](https://github.com/Unson-LLC/vibepro/pull/442) — [2026-08](/ja/releases/2026-08): feat: シニアエンジニア判断DAGを追加
<!-- vibepro-release-index-pr:442:end -->

<!-- vibepro-release-index-pr:443:start -->
- [PR #443](https://github.com/Unson-LLC/vibepro/pull/443) — [2026-08](/ja/releases/2026-08): fix: derive judgment mode from causal evidence
<!-- vibepro-release-index-pr:443:end -->

<!-- vibepro-release-index-pr:444:start -->
- [PR #444](https://github.com/Unson-LLC/vibepro/pull/444) — [2026-08](/ja/releases/2026-08): fix: 判断モードの証拠境界を分離
<!-- vibepro-release-index-pr:444:end -->

<!-- vibepro-release-index-pr:445:start -->
- [PR #445](https://github.com/Unson-LLC/vibepro/pull/445) — [2026-08](/ja/releases/2026-08): fix: release履歴を追記型に修正
<!-- vibepro-release-index-pr:445:end -->

<!-- vibepro-release-index-pr:448:start -->
- [PR #448](https://github.com/Unson-LLC/vibepro/pull/448) — [2026-08](/ja/releases/2026-08): fix: enforce immutable runtime identity
<!-- vibepro-release-index-pr:448:end -->

<!-- vibepro-release-index-pr:450:start -->
- [PR #450](https://github.com/Unson-LLC/vibepro/pull/450) — [2026-08](/ja/releases/2026-08): fix: PR準備成果物の不整合を修正
<!-- vibepro-release-index-pr:450:end -->

<!-- vibepro-release-index-pr:451:start -->
- [PR #451](https://github.com/Unson-LLC/vibepro/pull/451) — [2026-08](/ja/releases/2026-08): fix: GitHub Release分類を確実に収束
<!-- vibepro-release-index-pr:451:end -->

<!-- vibepro-release-index-pr:452:start -->
- [PR #452](https://github.com/Unson-LLC/vibepro/pull/452) — [2026-08](/ja/releases/2026-08): chore: 0.2.0-beta.6を公開準備
<!-- vibepro-release-index-pr:452:end -->

<!-- vibepro-release-index-pr:453:start -->
- [PR #453](https://github.com/Unson-LLC/vibepro/pull/453) — [2026-08](/ja/releases/2026-08): docs: リリース安全事例を公開
<!-- vibepro-release-index-pr:453:end -->

<!-- vibepro-release-index-pr:456:start -->
- [PR #456](https://github.com/Unson-LLC/vibepro/pull/456) — [2026-08](/ja/releases/2026-08): docs: 匿名化した実運用事例を追加
<!-- vibepro-release-index-pr:456:end -->

<!-- vibepro-release-index-pr:455:start -->
- [PR #455](https://github.com/Unson-LLC/vibepro/pull/455) — [2026-08](/ja/releases/2026-08): fix: accepted-specのHEAD系譜をPR成果物へ投影する
<!-- vibepro-release-index-pr:455:end -->

<!-- vibepro-release-index-pr:457:start -->
- [PR #457](https://github.com/Unson-LLC/vibepro/pull/457) — [2026-08](/ja/releases/2026-08): chore: 0.2.0-beta.7を公開準備
<!-- vibepro-release-index-pr:457:end -->

<!-- vibepro-release-index-pr:459:start -->
- [PR #459](https://github.com/Unson-LLC/vibepro/pull/459) — [2026-08](/ja/releases/2026-08): feat: VibePro npm公開Skillを追加する
<!-- vibepro-release-index-pr:459:end -->

<!-- vibepro-release-index-pr:461:start -->
- [PR #461](https://github.com/Unson-LLC/vibepro/pull/461) — [2026-08](/ja/releases/2026-08): chore: 0.2.0-beta.8を公開準備
<!-- vibepro-release-index-pr:461:end -->

<!-- vibepro-release-index-pr:465:start -->
- [PR #465](https://github.com/Unson-LLC/vibepro/pull/465) — [2026-08](/ja/releases/2026-08): chore: 0.2.0-beta.9を公開準備
<!-- vibepro-release-index-pr:465:end -->

<!-- vibepro-release-index-pr:473:start -->
- [PR #473](https://github.com/Unson-LLC/vibepro/pull/473) — [2026-08](/ja/releases/2026-08): fix: バージョン据え置き時のマージ後処理を完了する
<!-- vibepro-release-index-pr:473:end -->

<!-- vibepro-release-index-pr:474:start -->
- [PR #474](https://github.com/Unson-LLC/vibepro/pull/474) — [2026-08](/ja/releases/2026-08): fix: 旧形式Storyタスクを正規化する
<!-- vibepro-release-index-pr:474:end -->

<!-- vibepro-release-index-pr:475:start -->
- [PR #475](https://github.com/Unson-LLC/vibepro/pull/475) — [2026-08](/ja/releases/2026-08): chore: 0.2.0-beta.10を公開準備
<!-- vibepro-release-index-pr:475:end -->

<!-- vibepro-release-index-pr:476:start -->
- [PR #476](https://github.com/Unson-LLC/vibepro/pull/476) — [2026-08](/ja/releases/2026-08): docs: align VibePro with product intent traceability
<!-- vibepro-release-index-pr:476:end -->

<!-- vibepro-release-index-pr:477:start -->
- [PR #477](https://github.com/Unson-LLC/vibepro/pull/477) — [2026-08](/ja/releases/2026-08): feat: add minimal Development Judgment DAG
<!-- vibepro-release-index-pr:477:end -->

<!-- vibepro-release-index-pr:478:start -->
- [PR #478](https://github.com/Unson-LLC/vibepro/pull/478) — [2026-08](/ja/releases/2026-08): 公開説明文の意図を保ったまま、旧文言に固定されたCI契約を修復する
<!-- vibepro-release-index-pr:478:end -->

<!-- vibepro-release-index-pr:479:start -->
- [PR #479](https://github.com/Unson-LLC/vibepro/pull/479) — [2026-08](/ja/releases/2026-08): fix: block PR creation until agent reviews complete
<!-- vibepro-release-index-pr:479:end -->

<!-- vibepro-release-index-pr:480:start -->
- [PR #480](https://github.com/Unson-LLC/vibepro/pull/480) — [2026-08](/ja/releases/2026-08): chore: 0.2.0-beta.11を公開準備
<!-- vibepro-release-index-pr:480:end -->

<!-- vibepro-release-index-pr:481:start -->
- [PR #481](https://github.com/Unson-LLC/vibepro/pull/481) — [2026-08](/ja/releases/2026-08): feat: connect Development Judgment to the delivery workflow
<!-- vibepro-release-index-pr:481:end -->

<!-- vibepro-release-index-pr:482:start -->
- [PR #482](https://github.com/Unson-LLC/vibepro/pull/482) — [2026-08](/ja/releases/2026-08): chore: 0.2.0-beta.12を公開準備
<!-- vibepro-release-index-pr:482:end -->

<!-- vibepro-release-index-pr:483:start -->
- [PR #483](https://github.com/Unson-LLC/vibepro/pull/483) — [2026-08](/ja/releases/2026-08): feat: complete Development Judgment operating loop
<!-- vibepro-release-index-pr:483:end -->

<!-- vibepro-release-index-pr:484:start -->
- [PR #484](https://github.com/Unson-LLC/vibepro/pull/484) — [2026-08](/ja/releases/2026-08): chore: release 0.2.0-beta.13
<!-- vibepro-release-index-pr:484:end -->

<!-- vibepro-release-index-pr:486:start -->
- [PR #486](https://github.com/Unson-LLC/vibepro/pull/486) — [2026-08](/ja/releases/2026-08): feat: add causal Review DAG freshness and progress-sensitive convergence
<!-- vibepro-release-index-pr:486:end -->

<!-- vibepro-release-index-pr:488:start -->
- [PR #488](https://github.com/Unson-LLC/vibepro/pull/488) — [2026-08](/ja/releases/2026-08): chore: release 0.2.0-beta.14
<!-- vibepro-release-index-pr:488:end -->

<!-- vibepro-release-index-pr:489:start -->
- [PR #489](https://github.com/Unson-LLC/vibepro/pull/489) — [2026-08](/ja/releases/2026-08): fix: 非マルチテナント適用判定と実装証拠を分離する
<!-- vibepro-release-index-pr:489:end -->

<!-- vibepro-release-index-pr:490:start -->
- [PR #490](https://github.com/Unson-LLC/vibepro/pull/490) — [2026-08](/ja/releases/2026-08): chore: release 0.2.0-beta.15
<!-- vibepro-release-index-pr:490:end -->

<!-- vibepro-release-index-pr:491:start -->
- [PR #491](https://github.com/Unson-LLC/vibepro/pull/491) — [2026-08](/ja/releases/2026-08): fix: project safe agent review instructions
<!-- vibepro-release-index-pr:491:end -->

<!-- vibepro-release-index-pr:492:start -->
- [PR #492](https://github.com/Unson-LLC/vibepro/pull/492) — [2026-08](/ja/releases/2026-08): fix: bind PR readiness to canonical Story Tasks
<!-- vibepro-release-index-pr:492:end -->

<!-- vibepro-release-index-pr:494:start -->
- [PR #494](https://github.com/Unson-LLC/vibepro/pull/494) — [2026-08](/ja/releases/2026-08): fix: Judgmentを通常計画フローへ接続
<!-- vibepro-release-index-pr:494:end -->

<!-- vibepro-release-index-pr:493:start -->
- [PR #493](https://github.com/Unson-LLC/vibepro/pull/493) — [2026-08](/ja/releases/2026-08): chore: prepare 0.2.0-beta.16 release
<!-- vibepro-release-index-pr:493:end -->

<!-- vibepro-release-index-pr:495:start -->
- [PR #495](https://github.com/Unson-LLC/vibepro/pull/495) — [2026-08](/ja/releases/2026-08): fix: make verification progress deadline test deterministic
<!-- vibepro-release-index-pr:495:end -->

<!-- vibepro-release-index-pr:499:start -->
- [PR #499](https://github.com/Unson-LLC/vibepro/pull/499) — [2026-08](/ja/releases/2026-08): fix: subagent回復ループを3回で収束させる
<!-- vibepro-release-index-pr:499:end -->

<!-- vibepro-release-index-pr:500:start -->
- [PR #500](https://github.com/Unson-LLC/vibepro/pull/500) — [2026-08](/ja/releases/2026-08): fix: stop evidence loops with the minimal-core workflow
<!-- vibepro-release-index-pr:500:end -->

<!-- vibepro-release-index-pr:502:start -->
- [PR #502](https://github.com/Unson-LLC/vibepro/pull/502) — [2026-08](/ja/releases/2026-08): chore: prepare 0.2.0-beta.17 release
<!-- vibepro-release-index-pr:502:end -->

<!-- vibepro-release-index-pr:503:start -->
- [PR #503](https://github.com/Unson-LLC/vibepro/pull/503) — [2026-08](/ja/releases/2026-08): fix: Minimal Core契約をCodex配布面まで収束させる
<!-- vibepro-release-index-pr:503:end -->
