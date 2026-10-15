---
story_id: story-vibepro-tl-parallel-task-plan
title: VibePro TLのTask計画と外部実行の責務境界
status: accepted
related_story_ids:
  - story-codex-parallel-task-execution
  - story-brainbase-vibepro-development-integration
---

# ADR: VibePro TLのTask計画と外部実行の責務境界

## Context

AI実装を並行して進めるには、一つのStoryを実装範囲、接続契約、依存の種類、統合順に
分け、関係のないTaskを待たせない必要がある。単に依存があるという理由で全Taskを止めると、
実装速度のボトルネックが計画の粗さへ移る。

一方、VibeProには汎用agent実行制御を本体へ戻さない設計方針がある。過去の実行管理は
維持コストが本来の開発を上回ったため削除され、TLの技術判断もmergeを止めるgateではない。
ここでTask計画とセッション実行を同じ製品の正本へ置くと、計画の変更と実行状態の競合、
第二のTask台帳、実行engineの再肥大化が起きる。

## Decision

### VibePro TLが所有する計画

TLは、上流から渡されたStoryの目的、優先順位、受入条件、委任範囲を技術計画へ変換する。
計画は既存のTaskを単位に、次を版付きで記録する。

- Taskの目的、`allowed_paths`、対象外、受入条件、担当能力、調整可能な範囲
- `prerequisite`・`interface`・`overlap`の依存種別と、対象repo/Story/Task
- 接続契約の`id@version`、必要な計画版、milestone、`start`・`verify`・`integrate`の停止段階
- 担当計画、並行組合せ、統合順、競合解決担当、再計画の参照
- 外部観測が必要な場合の成果物revision、証拠参照、計画版の一致条件

`prerequisite`だけが宣言した段階を止める。`interface`は契約を合意した後の実装を並行可能に
し、実装milestoneは別の検証・統合条件として扱う。`overlap`は統合順と競合担当で調整し、
同じファイルや型に触れるだけでは着手を止めない。Taskのstatusだけで前提依存を解除せず、
版付きの外部観測を要求する。

### 外部hostが所有する実行

Codex親・子などの外部hostは、計画に従ってセッションを起動・配布し、worktree、担当の占有、
試行、チェックポイント、成果回収、検証、統合進行、停止、再試行、復旧を記録する。実行状態の
正本は外部hostの実行記録であり、VibeProへ汎用実行engineや第二のTask台帳を追加しない。

Codex親は、技術計画を変更する必要がある場合にTLへ返す。実行上の再配布や復旧は、計画版と
担当範囲を照合して外部hostで行う。子の完了通知、セッション状態、CI完了だけでStoryの受入や
公開を確定しない。

### Brainbaseとの接続

Brainbaseは任意の上流・全体判断連携として、Problem、目的、優先順位、委任範囲、repo別Story、
全体受入を所有できる。接続時はVibeProのStory/Task参照と、外部hostの実行結果・進捗を投影する。
Task計画の正本や外部実行記録をBrainbase側に複製して第二のauthorityを作らない。同期は送信成功
ではなく受信側の読戻しで確認し、未接続・同期失敗でもVibePro単独の計画と外部実行を止めない。

### 既存の権限境界

TLの判断は技術計画とdispatch readinessの助言であり、merge gateではない。PR、review、merge、
deploy、releaseの権限と既存gateは変えない。Task計画がreadyでも、既存の検証・承認・公開条件を
省略できない。

## Consequences

- VibePro単独でも、人間や既存PdMからStoryを受けて技術計画を作れる。
- Codex親は同じ計画版と契約を共有して複数Taskを並行し、完成した変更から検証・統合できる。
- 長時間の実行、CI待ちをまたぐ復旧、複数repoの配布には外部hostの永続記録が必要になる。
- Brainbase連携は経営・管理から開発結果を追跡する追加経路であり、Story 1・2の必須依存ではない。
- Story 2の実行契約は`agent-skills`、Story 3の連携契約は`brainbase-organization`が正本を所有する。
  各repoの受入条件はそれぞれの正本で管理し、VibeProはポインタだけを持つ。
- このADRは責務境界の合意であり、並列実装、復旧、Brainbase読戻しの実行完了を意味しない。

## Rejected alternatives

- **VibePro本体へ実行管理を戻す**：過去に削除した汎用制御を復活させ、計画・実行状態・権限が
  一つへ集中するため採用しない。
- **新しいWorkPackageを追加する**：既存Taskと正本が二重になるため採用しない。必要な情報は
  既存Taskへ依存種別、契約、担当、統合順として追加する。
- **BrainbaseへTask実行台帳を複製する**：Task計画と実行記録の所有境界を曖昧にし、同期遅延を
  実行事実と誤認するため採用しない。
