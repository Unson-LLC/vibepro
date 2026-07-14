---
story_id: story-vibepro-judgment-dag-adjudication
title: "判断DAGの各項目を独立LLM judgeにチェックリスト裁定させ、トークン照合を消化条件から降格する"
view: dev
period: 2026-07
source:
  type: incident-analysis
  id: VP-INCIDENT-2026-07-14-JUDGMENT-DAG-TOKEN-DISCHARGE
  title: "spine/axes/failure modesの『シニア判断』項目が、証拠テキストのトークン照合だけで消化されている"
parent_design: vibepro-judgment-dag-adjudication
related_stories:
  - story-vibepro-evidence-adjudication-gate
  - story-vibepro-scanner-inconclusive-coverage
architecture_docs:
  - ../../../architecture/vibepro-judgment-dag-adjudication.md
spec_docs:
  - ../../../specs/vibepro-judgment-dag-adjudication.md
status: active
created_at: 2026-07-14
updated_at: 2026-07-14
---

# 判断DAGの各項目を独立LLM judgeにチェックリスト裁定させ、トークン照合を消化条件から降格する

## User Story

**As a** VibeProをハーネスとして使うAIコーディングエージェントの運用者
**I want to** Common Judgment Spine・Judgment Axes・Failure Mode Coverageの各項目が、証拠テキストのトークン一致ではなく、独立したLLM judgeが「問い×変更差分×証拠」を実際に検討した裁定で消化されてほしい
**So that** 「シニアエンジニアの判断チェックリスト」を名乗るゲート群が、実際に判断を実行した上で通過し、`release_note` や `rollback_instruction` のような文字列を証拠に書くだけでは決して満たせなくなる

## 背景

VibeProの判断系ゲートは、項目ごとの問い（judgment axesの `decision_question`、spineのsubcheck、
failure modeの候補理由）は良質なproseとして持っている。しかしその消化条件はすべて決定的な
トークン照合である: spine subcheckは証拠テキスト中の `flow_replay` 等の語の有無
（`requiredEvidenceForJudgmentSubcheck`）、axesは `release_note` / `rollback_instruction` 等の
counter-evidenceトークン検索、failure modesはキーワードregex（`['parse','json','malformed']` 等）。
2026-07-14の3 Story導入作業で、coordinator自身がこれらのトークンを含む文章を書いてゲートを
通過させたが、**内容が正直かどうかをゲートは判定できず、嘘の文章でも同一に通過する**ことを
実地で確認した。evidence adjudication gate（PR#324）はこの穴のうちAC clauseだけを埋めており、
判断DAG本体は未カバーである。

対策は#324パターンの一般化: 判断DAGのアクティブ項目を1つのチェックリストとして独立fresh
contextのLLM judgeへ渡し、項目ごとに「機械的消化は妥当か」を裁定させる。裁定は
checkpoint単位の一括セッション（項目ごとの個別dispatchはしない——コミット毎再裁定コストを
3 Storyの運用で実証済みのため）。既存ゲートのトークン照合は削除せず残す（防御層+
ルーティングヒント）。その上に裁定ゲートを重ねることで、トークン照合単独では
消化にならない状態を作る（実質的な降格）。

## Scope

- `vibepro adjudicate prepare . --id <story-id> --judgment`: 最新の `pr prepare` 成果物（pr-prepare.json）から判断DAGのアクティブ項目を収集し、`.vibepro/adjudication/<story-id>/judgment-adjudication-request.md` を生成する。項目は3系統: `spine:<subcheck_id>`（Common Judgment Spineのsubcheck、問い＝subcheck定義とsurface、現在の機械的消化状態と一致した証拠つき）、`axis:<axis_id>`（judgment axesの `decision_question` 原文つき）、`failure_mode:<mode_id>`（候補理由とキーワード、現在の消化証拠つき）。変更差分の要約（changed files）を必ず併記する
- pr prepare成果物が存在しない場合は明示エラー（先に `vibepro pr prepare` を要求。anti-vacuum）
- 裁定語彙は3値: `judged_sound`（機械的消化は変更の実体に照らして妥当）/ `judged_unsound`（トークンは揃っているが判断として不成立。理由必須）/ `needs_human_judgment`（LLMでは判断不能、人間の判断が必要）
- `vibepro adjudicate record . --id <story-id> --judgment --item <item-id> --verdict <v> --reason <text> --agent-system --agent-id [--session-ref]`: HEADバインド+provenance必須で `judgment-adjudication.json` へ記録（clause裁定とは別ファイル・別ゲート）
- `pr prepare` に必須ゲート `gate:judgment_dag_adjudication` を追加: アクティブ項目すべてがcurrent HEADの裁定を持つまで `needs_evidence`（不足item列挙）、いずれかが `judged_unsound` なら `failed`（judge理由つき）、`needs_human_judgment` はdecision record（source `gate:judgment_dag_adjudication:<item-id>`、accepted+reason+artifact）でのみ解決、全項目解決で `passed`。アクティブ項目が0件なら明示 `not_applicable`
- `judgment_dag_adjudication` をunresolved-required集計とcritical判定（理由のみのwaiver不可）へ登録
- 対象routeは判断DAGがrelease判断を担う `agent_workflow` route / `workflow_heavy` profileのみ。それ以外のroute（fast lane・general等）はアクティブ項目0件として明示 `not_applicable` になる
- `.vibepro/config.json` の `judgment_adjudication.enabled: false` で明示オプトアウト（既定は有効）
- README（en/ja）へ運用手順を追記

## 非目標

- 既存のspine/axes/failure modes/path surface/responsibilityゲートのトークン照合ロジック変更（残置=防御層+ルーティング。撤去は採用実績を見て後続Story）
- clause裁定（evidence_adjudication gate）との統合・変更
- VibePro自身によるLLM API呼び出し（委譲パターン維持）
- 項目ごとの個別裁定dispatch（checkpoint一括のみ）
- path surface / responsibility authority系のトークン照合の裁定対象化（対象3系統で開始、共有実装で後続展開可能にする）

## 受け入れ基準

- [ ] `adjudicate prepare --judgment` は最新pr-prepare.jsonからspine subcheck・judgment axis・failure modeのアクティブ項目を収集し、各項目の問い原文・現在の機械的消化状態・一致した証拠・変更ファイル一覧を含む依頼書を生成する
- [ ] pr prepare成果物が無い状態の `--judgment` prepareは、成果物を作らず「先にpr prepareを実行せよ」という明示エラーになる
- [ ] 依頼書には独立fresh contextでの実行・反証を試みる立場・裁定語彙3値（judged_sound / judged_unsound / needs_human_judgment）の定義と、トークン一致だけでは判断成立と見なさない旨の指示が含まれる
- [ ] `adjudicate record --judgment` は3値以外のverdict・空reason・provenance欠落をエラーにし、記録をcurrent HEADへバインドする（HEAD解決不能時は拒否）
- [ ] `pr prepare` の `gate:judgment_dag_adjudication` は、裁定が無い・stale・項目不足のとき `needs_evidence` になり、reasonへ不足item idを列挙する
- [ ] いずれかの項目が `judged_unsound` のときゲートは `failed` になり、reasonにjudgeの理由が含まれる
- [ ] `needs_human_judgment` の項目はdecision record（source `gate:judgment_dag_adjudication:<item-id>`、accepted+reason+artifact）でのみ解決される
- [ ] 全アクティブ項目がcurrent HEADの裁定で解決されるとゲートは `passed`、アクティブ項目0件は明示 `not_applicable` になる
- [ ] ゲートは必須かつcriticalで、未解決の間 `ready_for_pr_create` はfalse、理由のみのwaiverでは通らない
- [ ] `.vibepro/config.json` の `judgment_adjudication.enabled: false` でゲートが生成されず、成果物なしの既存リポジトリでも `pr prepare` はクラッシュしない
- [ ] テストは「項目収集（3系統）とpr prepare前提の明示エラー」「record入力検証とHEADバインド」「ゲート5状態（needs_evidence / failed / 人間判断要求 / passed / not_applicable）」「required・critical連動」「オプトアウトと後方互換」を含む

## 検証メモ

証拠記録では自動テストで検証した事実のみをverify recordへ記録する。clause裁定と
judgment裁定の両方を独立fresh context subagentへdispatchする（本Storyは自分自身の
判断DAGを新ゲートで裁かせる最初のstoryになる）。
