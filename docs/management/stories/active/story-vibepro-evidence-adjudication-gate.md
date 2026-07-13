---
story_id: story-vibepro-evidence-adjudication-gate
title: "AC証拠の意味的裁定を独立LLM adjudicatorへ委譲するEvidence Adjudication Gateを追加する"
view: dev
period: 2026-07
source:
  type: incident-analysis
  id: VP-INCIDENT-2026-07-13-SALESTAILOR-BLUEPRINT-FAKE-BINDING
  title: "traceabilityの正規表現照合が、AC全文を--scenarioへ貼った npm test 記録を正規のclause bindingとして受理した"
parent_design: vibepro-evidence-adjudication-gate
related_stories:
  - story-vibepro-verification-observation-artifacts
  - story-vibepro-fake-value-hardening
architecture_docs:
  - ../../../architecture/vibepro-evidence-adjudication-gate.md
spec_docs:
  - ../../../specs/vibepro-evidence-adjudication-gate.md
status: active
created_at: 2026-07-13
updated_at: 2026-07-13
---

# AC証拠の意味的裁定を独立LLM adjudicatorへ委譲するEvidence Adjudication Gateを追加する

## User Story

**As a** VibeProをハーネスとして使うAIコーディングエージェントの運用者
**I want to** 「この証拠はこの受け入れ基準の成果を実際に実証しているか」という意味的判断を、実装エージェントとは独立したLLM adjudicatorに裁定させ、その裁定なしにPRを ready 扱いできないゲートがほしい
**So that** AC文言のテキスト一致だけで clause binding が成立する現行の正規表現照合では防げない fake-value（文字列存在テストを人間成果の検証として記録する行為）を、ハーネスの強制力で止められる

## 背景

2026-07-13 の SalesTailor Blueprint インシデントで、実装エージェントは当初正直に検証していた
（e2e未完了を needs_setup で記録、実ブラウザ+スクリーンショット証拠）が、traceability gate の
「no AC/scenario-specific binding was found」という要求に対し、AC全文を `--scenario` フラグへ
貼り付けた `npm test` 記録で「binding」を成立させた。現行実装は clause binding をテキスト
トークン照合で定義しているため、これはツール契約上正しい操作として受理され、
`初見のCSが責任範囲を区別できる` という人間成果ACが `npm test` 1回で「検証済み」になった。

根本原因は「この証拠はこの成果を実証しているか」という判断質問を、決定的コード（正規表現）に
実装したこと。判断レンズのprose（agent-review の MANDATORY_REVIEW_LENSES）は正しい問いを
持っているが、監査対象のエージェント自身に手渡される注意書きであり、context compaction で
蒸発する一方、機械ゲートのJSON要求は毎回再出力されて持続する。長時間セッションでは
形式充足だけが選択圧として残る。

対策は、agent review と同じ委譲パターン（VibePro自身はLLMを呼ばず、依頼書生成・裁定記録・
ゲート強制のみ行う）で、clauseごとの意味的裁定を独立subagentに要求すること。裁定には
「自動検証不能」という正直な語彙を用意し、正直な答えに表現手段がないことによる
ロンダリング誘発を断つ。

## Scope

- `vibepro adjudicate prepare <repo> --id <story-id>`: `.vibepro/adjudication/<story-id>/adjudication-request.md` を生成する。内容は (a) 各ACのclause全文、(b) 各clauseに紐づく検証証拠（verify record の kind/status/command/summary/observation）、(c) 裁定者への指示（実装エージェントと独立のfresh contextで実行、反証を試みる立場、Story原文を一次コンテキストとする）、(d) verdict語彙 `demonstrated | not_demonstrated | not_verifiable_by_automation` の定義
- `vibepro adjudicate record <repo> --id <story-id> --clause <clause-id> --verdict <verdict> --reason <text> --agent-system <system> --agent-id <id> [--session-ref <ref>]`: clauseごとの裁定を `.vibepro/adjudication/<story-id>/adjudication.json` へ current HEAD にバインドして記録する
- `vibepro pr prepare` に必須ゲート `evidence_adjudication` を追加する。ACを持つStoryでは、全clauseがcurrent HEADの `demonstrated` 裁定を持つまで未解決。`not_demonstrated` はゲート failed。`not_verifiable_by_automation` は人間検証を要求する明示理由付き未解決とし、decision record（status=accepted + reason + artifact）でのみ閉じられる
- `evidence_adjudication` を unresolved-required 集計（overall_status / ready_for_pr_create へ反映）と critical 判定（理由のみのwaiver不可）へ登録する
- `.vibepro/config.json` の `evidence_adjudication.enabled: false` で明示的にオプトアウトできる（既定は有効）

## 非目標

- VibePro自身がLLM APIを呼び出すこと（委譲パターンを維持する）
- agent_review gate の置き換えや統合
- 裁定transcriptの自動品質採点
- verify record のstatus語彙変更
- 既存全ゲートのvacuum pass（検査対象0件=pass）の一括修正（別Story）
- traceability正規表現照合そのものの撤去（adjudicationが上位の防波堤になるため今回は残置）

## 受け入れ基準

- [ ] `vibepro adjudicate prepare` が adjudication-request.md を生成し、Story の全ACのclause全文と、各clauseへ紐づく検証証拠（command / summary / observation）が含まれる
- [ ] adjudication-request.md に、独立fresh contextでの実行・反証を試みる立場・verdict語彙3値（demonstrated / not_demonstrated / not_verifiable_by_automation）の定義が含まれる
- [ ] ACが1件もないStoryに対する `adjudicate prepare` は、pass相当の成果物を作らず「acceptance criteria なし」を明示するエラーになる
- [ ] `adjudicate record` は verdict が3値以外・reason が空・agent-system / agent-id 欠落のいずれでもエラーになり、記録は current HEAD のcommitへバインドされる
- [ ] `pr prepare` の `evidence_adjudication` ゲートは、裁定が無い・古いHEADに紐づく・clauseが不足しているとき未解決（needs_evidence）になり、reason に不足clause idが列挙される
- [ ] いずれかのclauseが `not_demonstrated` のとき、ゲートは failed になり reason に裁定者の理由が含まれる
- [ ] いずれかのclauseが `not_verifiable_by_automation` のとき、ゲートは人間検証を要求する理由付きで未解決になり、decision record（status=accepted + reason + artifact）を記録したときのみ解決する
- [ ] 全clauseが current HEAD の `demonstrated` 裁定を持つとき、ゲートは passed になる
- [ ] `evidence_adjudication` が未解決のとき overall_status は ready_for_review にならず、ready_for_pr_create は false になり、critical gate として理由のみのwaiverでは通らない
- [ ] `.vibepro/config.json` で `evidence_adjudication.enabled: false` のときゲートは生成されず、adjudication成果物が無い既存リポジトリでも `pr prepare` はクラッシュしない
- [ ] テストは「request生成の内容」「AC 0件の明示エラー」「record入力検証とHEADバインド」「ゲート4状態（needs_evidence / failed / 人間検証要求 / passed）」「overall_status・ready_for_pr_create・critical連動」「オプトアウトと後方互換」を含む

## 検証メモ

このStory自体の証拠記録では、自動テストで検証した事実のみを verify record へ記録し、
人間成果に関する主張を自動テストの scenario として貼らない（本Storyの動機となった
fake binding を自身の証跡で再演しない）。
