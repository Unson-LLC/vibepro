# Guarded Autonomy Roadmap Rebaseline Architecture

## 決定

Guarded Autonomyは6 Story shorthandではなく、単一責務を持つ10 Storyの直列ロードマップとして管理する。2026-07-19時点で1から4までが完了し、未完は5から10の6 Storyとする。

| 順序 | Story | 状態 | 所有責務 | Entry gate |
|---:|---|---|---|---|
| 1 | `story-vibepro-guarded-run-session-contract` | completed | 単一Story Runの状態・停止・再開契約 | なし |
| 2 | `story-vibepro-run-context-capsule` | completed | 再開可能なbounded context | 1 completed |
| 3 | `story-vibepro-safe-action-orchestrator` | completed | 許可済みtyped Actionの実行・journal・再束縛 | 1–2 completed、最新main再診断 |
| 4 | `story-vibepro-next-best-action-controller` | completed | 許可済み候補から次Actionを選ぶ | 3 completed |
| 5 | `story-vibepro-human-decision-checkpoint` | next | Runのtyped pause/resume | 4 completed、Human Review Overrideとの境界合意 |
| 6 | `story-vibepro-agent-runtime-adapters` | pending | provider-neutral runtime実行境界 | 5 completed、PR #338のreview surface契約確定 |
| 7 | `story-vibepro-risk-adaptive-validation-sequencing` | pending | targeted/preflight/final検証順序 | 6 completed、content freshness契約確定 |
| 8 | `story-vibepro-review-finding-repair-loop` | pending | 実findingsの修正・再検証・再review | 7 completed |
| 9 | `story-vibepro-story-run-portfolio-controller` | pending | 隔離された複数単一Story Runの順次制御 | 8 completed |
| 10 | `story-vibepro-guarded-autonomy-hardening` | pending | 統合E2E・budget・観測・停止保証 | 1–9 completed |

## 既存責務との境界

### Review lifecycle repair

`src/review-repair.js`はmissing、open、timeout、staleなどレビュー証跡ライフサイクルの回復を所有する。Story 8は`needs_changes`として確定した実findingsのコード修正だけを所有し、既存repair command生成を置換しない。

### Human decisions

`src/decision-records.js`とPR managerのhuman decisionはPR/Gate判断の記録を所有する。Story 5はGuarded Runを`waiting_for_human`へ停止し、型付き回答で同一Runを再開する境界を所有する。回答は新しいwaiver権限やmerge権限を作らない。

### Evidence freshness and publishing

PR #338のcontent-scoped freshnessをStory 6–8のcurrent-content拘束として利用する。PR #331のpublished-evidence contractはStory 10の出力整合に利用するが、前段Storyのblockerにはしない。

### Human Review Override

PR #321はhuman reviewのblock推奨を明示overrideなしで通さないmerge/PR境界を所有する。Story 5はこのoverrideを発行せず、必要な場合にHuman Decisionとして要求・保存・再評価するだけとする。

## 進行中PRの扱い

| PR | 扱い |
|---|---|
| #338 Content-scoped evidence freshness | Story 6開始前のblocking integration gate。mergeまたは同等契約のmain反映を確認する |
| #321 Human Review Override | Story 5開始前にkeep/rebase/supersedeを明示決定する。Checkpointへ吸収しない |
| #331 Published evidence integrity | Story 10のinput。Story 3–9を止めない |

## 実行規則

1. 各Storyは別Run、別branch、別managed worktree、別evidence setで進める。
2. 前StoryのPR mergeとaudit artifact確定を次Storyのentry gateとする。
3. 各開始時に最新mainで`story diagnose --run-graphify`を再実行する。
4. hot filesの一致はGit競合として扱い、所有責務の一致は設計競合として扱う。
5. Story 10は既存機能を棚卸しし、不足分だけを実装する。既存のbudget・cost accounting・review provenance・evidence freshnessは再実装せず、残存する統合ギャップだけを閉じる。

## 進捗証跡（2026-07-19）

- Story 1 `story-vibepro-guarded-run-session-contract`: completed。
- Story 2 `story-vibepro-run-context-capsule`: completed。canonical audit artifactをmainへ永続化済み。
- Story 3 `story-vibepro-safe-action-orchestrator`: completed。canonical audit artifactをmainへ永続化済み。
- Story 4 `story-vibepro-next-best-action-controller`: completed。PR #352、merge commit `b89bf7f3fc89f74395625db1278774ad0f2e3993`、canonical audit commit `846d36bc73d00133bf6983310f3ed0c1b20fe9f4`。
- 次の着手対象はStory 5 `story-vibepro-human-decision-checkpoint`。Story 6–10は直列依存のためpendingを維持する。

## Rollback

この再編は文書とStory登録だけでruntimeを変更しない。問題があれば各Story文書を独立維持したまま、自動シーケンスを使わず手動で順次実行する。
