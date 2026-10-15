---
story_id: story-vibepro-tl-parallel-task-plan
title: VibeProのTLが単独利用で並列Task計画を作る
status: in_progress
view: dev
created_at: 2026-10-09
updated_at: 2026-10-09
owner_repository: vibepro
---

# VibeProのTLが単独利用で並列Task計画を作る

## Storyと利用者成果

VibeProを使う開発責任者として、人間や既存PdMから渡したStoryを、並行できる既存Taskへ分けてほしい。目的・受入条件・任せる範囲を共有し、不要な待ちと文脈の再説明を減らしたい。Brainbaseなしで計画を作り外部実行側へ渡せることが成果である。

## 責務・対象範囲

TLは技術助言に加え、分割・依存分類・接続契約・割当計画・統合順・再計画を担う。この改訂をArchitecture/ADRと概念モデルへ反映する。上流の目的や優先順位を暗黙に変更せず、PRを止める新しいgateやmerge・deploy権限を作らない。

セッション起動・worktree・占有・再試行は[外部実行Story](./story-codex-parallel-task-execution.md)が所有する。Brainbaseへの取得・同期は[任意連携Story](./story-brainbase-vibepro-development-integration.md)が所有する。

## 最小Spec：計画の入出力と不変条件

TLは担当に必要な能力・並行する組合せ・調整可能な範囲を計画する。実セッションの選択と配布は外部実行側が計画に沿って行い、技術計画を変える調整はTLへ返す。

- 入力：repo/Story参照、目的、受入条件、優先順位、任せる範囲。Brainbase固有のID・receipt・認証を共通契約の必須項目にしない。欠けた必須入力は具体的に示し、目的や権限を創作しない。
- 出力：既存TaskのID、目的、`allowed_paths`、対象外、`acceptance_criteria`、依存、接続契約、割当計画、統合順、競合解決担当、計画版と根拠。Task→Story→目的を参照でたどれる。
- 既存`depends_on`の意味を黙って変更しない。依存の種別、相手参照、必要到達点、着手・検証・統合のどこを止めるかを版付き契約で追加する。旧入力の互換性と移行を定義する。
- 真の前提依存だけ必要到達点まで着手を待つ。接続仕様を合意すればモック等で並行できる依存は結合検証条件として扱う。同じファイル・型・DBを触るだけでは着手を禁止せず、安全性と競合解決を計画する。
- 未解決参照と循環を識別し、影響する範囲を解消・再計画する。全Taskを一律停止しない。
- repoとIDの組で同定する。`allowed_paths`へ他repoを暗黙追加しない。技術的な外部依存は表現できるが、BrainbaseによるProblem分割は前提にしない。
- 生成・受理・読取・外部への引渡しを通じて依存を欠落させない。現行`task-authority.js`の投影で`depends_on`が落ちる箇所を確認する。
- 受理済み計画と変更可能な実行状態を分離する。再計画は新しい版として渡し、実行中の状態更新で入力ハッシュを壊さない。実行側の参照を持てるが実行台帳を複製しない。

依存の解除はTaskの`status`を根拠にしない。`prerequisite`は対象Taskの`returned`・`verified`・`integrated`に対応する、計画版・成果物revision・証拠参照を持つ外部観測でのみ解除する。`interface`の`contract_ref`は`id@version`で固定し、consumer Taskの`contracts`とprovider Taskの`contracts`が同じid/versionを宣言する場合だけ接続仕様を解決する。別repoの`interface`は対象Taskをこの計画へコピーせず、対象repo/story/task・同じ`contract_ref`・対象側の`plan_version`・`artifact_revision`・`evidence_ref`を含む`contract_agreement`観測で接続仕様の合意を確認する。合意は実装完了を意味しないため、`verify`・`integrate`のレディネスには別のmilestone観測を要求する。`ready_stages.start`は開始候補、`ready_stages.verify`と`ready_stages.integrate`はそれぞれ観測済みの候補として分けて返す。同じファイルを触るだけの`overlap`は着手を止めない。

`vibepro task plan validate`と`vibepro task plan read`は`--observations <tracked-json>`で外部観測を受け取る。外部plan/contextを自動取得できない場合、consumerの契約versionと一致する契約観測がない対象Taskは`unresolved_external_interface_contract`として`dispatch_ready: false`になり、未確認のまま外部実行側へ配布しない。影響を受けないTaskの候補は同時に返し、全計画を一律停止しない。

## 証跡の境界

このStoryに対応するGraphifyのbefore/post結果は、このcheckoutの既存artifactから確認できていない。したがって影響文脈は未確認であり、Graphifyの不在を実装完了・受入・安全性の根拠にしない。Graphifyの確認が必要なTaskは、対象repoで新しい観測を取得してから評価する。以下の受入条件は、その結果がない状態では未完了のままとする。

## 受入条件

- [ ] TLの責務改訂が概念モデル・Architecture/ADRと一致し、技術計画と上流判断、実行、merge/deployの権限境界が明示される。
- [ ] Brainbase未接続・認証なしで、人間または既存PdMのStory入力から計画を作り、外部実行側へ渡せる。
- [ ] 同じ内容の上流入力で、Brainbaseの有無によってTask契約の必須項目と技術的な依存解釈が変わらない。
- [ ] 真の前提依存、契約合意後の並行可能な依存、ファイル・意味的な重複の三例で、待つ段階と統合方法を確認できる。
- [ ] 依存・接続契約・受入条件・計画版が生成から外部読取まで残る。旧入力、循環、未解決参照の例を確認できる。
- [ ] Task状態だけでは前提を解除できず、計画版・成果物revision・証拠参照を持つ観測がない場合は`dispatch_ready: false`になる。外部interfaceは契約合意と実装milestoneを別々に確認できる。
- [ ] 計画変更の版と影響Taskを示せる。実行状態を更新しても受理済み計画の整合性を壊さない。
- [ ] VibePro本体に起動・worktree・占有・再試行の実行制御と第二のTask台帳を追加していない。

## 対象外・依存

経営管理、Problemの事業優先順位、Task状態のBrainbase同期、汎用実行engine、旧Gateの復活は対象外。Brainbase連携Storyの完成は受入の依存にしない。実並行・中断復旧・時間評価はStory 2が所有する。

## 実装と検証の現在地

計画契約0.2.0、受理済み計画の厳密な読取、段階別の依存解析、TLと外部実行の責務文書を実装した。対象の21テスト、typecheck、CLI文書の整合検査は成功した。親の統合用worktreeでも21テストが成功した。

これはコードとローカル検証の結果であり、実利用者の入力からの計画作成、上流入力の同等性、実運用の再計画、公開と利用者成果は未確認である。受入条件はこれらを確認してから個別に確定する。

[全体方針](./story-vibepro-tl-task-orchestration-codex-pilot.md) / [TL責務ADR](../architecture/ADR-vibepro-tl-planning-and-external-execution.md) / [既存Task契約](../../src/task-authority.js)
