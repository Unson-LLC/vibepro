---
story_id: story-vibepro-tl-task-orchestration-codex-pilot
title: 並列開発の責務分割と実装Storyの全体方針
status: draft
view: dev
created_at: 2026-10-09
updated_at: 2026-10-09
owner_repository: vibepro
document_kind: orchestration_overview
---

# 並列開発の責務分割と実装Storyの全体方針

## 位置づけ

この文書は全体方針と関連Storyの索引である。実装の受入条件は下記3Storyのcanonical ownerが
それぞれ所有し、本書を第四の実装Storyや重複したTask台帳として扱わない。VibeProにはStory 1の
正本と、他repoのStory 2・3へのポインタだけを置く。旧草案の一括受入条件は3Storyへ移した。

VibeProは単独で成立する開発プロダクトを目指す。Brainbase連携は、経営・管理の判断から開発と結果の回収までをつなぐ任意の使い方である。今回合意した責務分割を以下へ反映した。文書修正は機能実装や試行完了を意味しない。

## 共通の責務

| 担当 | 責務 |
| --- | --- |
| 人間・既存PdM・上流システム | 何を・なぜ・どの優先度で、受入条件と任せる範囲を渡す |
| VibeProのTL | Storyを既存Taskへ分割し、依存分類・接続契約・割当計画・統合順・再計画を判断する |
| Codex等の外部実行側 | セッション起動・worktree・担当の占有・再試行・検証と統合の進行を担う |
| 既存のGitHub・CI・運用 | 現行の権限と承認でPR・merge・公開を行う |

単独利用では人間や既存PdMが上流入力を渡す。連携利用ではBrainbaseがその入力と全体判断を担い、結果を受け取る。Task分割・依存分類・統合計画は共通機能であり、Brainbaseの接続・ID・認証・同期を必須条件にしない。

計画の正本はVibeProの既存Task/Spec、実行状態の正本は外部実行側。Brainbaseは参照と進捗の投影を持つ。実行状態の編集可能な正本を重複させない。

## 実装用Story

| Story | 役割 | canonical owner / path | VibePro側の扱い |
| --- | --- | --- | --- |
| [Story 1: VibeProのTLによる並列Task計画](./story-vibepro-tl-parallel-task-plan.md) | 単独利用できる技術計画と既存Task契約 | `vibepro` / このStory | canonical |
| [Story 2: Codexによる並列実行・統合・再開](./story-codex-parallel-task-execution.md) | 外部実行側の配布、統合、再開 | `agent-skills` / `docs/stories/story-codex-parallel-task-execution.md` | canonical pointer |
| [Story 3: Brainbaseとの任意連携](./story-brainbase-vibepro-development-integration.md) | 経営・管理から開発への引渡し、複数repo、進捗返却 | `brainbase-organization` / `docs/stories/story-brainbase-vibepro-development-integration.md`（owner確定後に照合） | canonical pointer |

1のTask契約の版を合意すれば2の実装を並行できる。3も共通契約を使って進め、3の完成を1・2の受入条件にしない。実行側と連携側の実装repoは各Storyの着手時に確定する。ここに置いた草案をVibePro本体への実行管理追加の指示と解釈しない。

Story 2の正本はagent-skills側で管理され、Story 3のcanonical pathと正本の存在はこのcheckoutから
未確認である。ポインタは実装・受入・同期の完了を示さず、各ownerが正本の受入条件を未完了のまま
管理する。Graphifyのこの試行に対するbefore/post結果も確認できていないため、影響文脈はunknown
として扱う。

## 試行と完了の境界

まずBrainbase未接続の実Storyを三つ程度のTaskへ分け、二つ以上を並行し、完成した変更から検証・統合する。親の中断と再開も確認する。これはStory 2の受入である。

その後、同じ開発契約にBrainbaseを接続し、複数repoのProblem・Story・結果返却を確認する。これはStory 3の受入であり、単独開発の前提ではない。

CI整理は必要な場合に並行して行い、実試行の開始条件にしない。並列数だけでなく、受入までの時間・待ち・統合・手戻り・人間の介入・不具合を見る。同等条件の比較なしに速度改善を断定しない。

## 現行との差分・参照

現行TLの技術判断は助言であり、それ自体をmerge gateにしない。判断・計画までの責務拡張はStory 1で概念モデルとArchitecture/ADRへ反映する。計画の採用はmerge・deploy権限の追加ではない。

現行Taskには担当セッションや再開保証がなく、BrainbaseへのTask状態自動同期も未実装である。Story 2・3がその不足を扱う。VibeProの汎用実行エンジン、旧Gate/budget/lifecycle、WorkPackageという別作業単位は追加しない。

- [README](../../README.md)
- [既存Task契約](../../src/task-authority.js)
- [現行Brainbase通信](../../src/brainbase-transport.js)
- 現行技術判断：Graph `gls_vp_engineering_judgment_16fff07267` version 2
