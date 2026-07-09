---
story_id: story-vibepro-judgment-axis-activation-preconditions
title: "judgment axis の発火に diff 組成の事前条件を入れ、noise 判定の先例を再発火時に提示する"
status: active
view: dev
period: 2026-07
source:
  type: operator_feedback
  title: "2026-07-09 の価値監査で、docs/UI 中心 story（style-preset-token-gate）に security-boundary 軸が過剰発火し、false positive を閉じるための audit evidence 読み直しが繰り返し発生していた"
related_stories:
  - story-vibepro-senior-judgment-multi-axis-dag
  - story-vibepro-uiux-style-preset-token-gate
  - story-vibepro-session-attribution-boundary-guard
  - story-vibepro-audit-automation-memory-guard
parent_design: vibepro-judgment-axis-activation-preconditions
architecture_docs:
  - docs/architecture/vibepro-judgment-axis-activation-preconditions.md
spec_docs:
  - docs/specs/story-vibepro-judgment-axis-activation-preconditions.md
created_at: 2026-07-09
updated_at: 2026-07-09
reason: "alternatives considered: narrow the security_boundary path regex globally (loses detection power on stories that genuinely touch auth surfaces), let operators pre-declare a story type in frontmatter that suppresses axes (self-declared suppression invites gaming and drift), or derive activation preconditions deterministically from the diff composition already computed in fileGroups and add a noise-precedent ledger that surfaces — but never auto-applies — prior noise decisions on same-fingerprint re-fires; selected composition preconditions plus precedent surfacing. compatibility impact: JUDGMENT_AXIS_DEFINITIONS and axis identifiers are unchanged; classifyAxisActivationPrecision gains one more downgrade rule; axis output gains an optional prior_noise_precedents field; no gate is removed and no blocker semantics change. rollback plan: revert the precondition rule, the precedent ledger module, their wiring in buildSeniorJudgmentAxes/classifyAxisActivationPrecision, this Story, the spec, and design-ssot links in one commit. boundary and scope: preconditions only downgrade uncorroborated path/text-regex signals on docs/ui-composition diffs; route-type, risk-surface, and code-topology signals always activate regardless of composition; precedents are advisory context and can never close, waive, or downgrade an active blocker. accepted followups: none for this PR."
---

# Story

Engineering Judgment gate の `security_boundary` 軸は、changed path への正規表現（`auth|permission|security|secret|token|...`）でも発火する。docs/UI 中心の story ではこれが過剰発火する — 2026-07-09 の監査では `style-preset-token-gate` の「token」（design token）への発火が false positive で、現行差分と検証証跡による noise クローズには実 token コストがかかった。gate が誤検知を説明付きで下げられること自体は価値だが、同型の誤検知を毎回ゼロから閉じ直すのは senior judgment の再現ではない。

一方で正規表現を一律に狭めると、本当に auth 境界を触る story での検出力が落ちる。解くべきは 2 点: (1) **発火の事前条件** — diff 組成（`fileGroups` の docs/spec/UI 比率、source 変更の有無）が既に決定的に計算されているのだから、docs/UI 組成の diff における「path/text 正規表現のみ・裏付けなし」の signal は activation precision を下げる。route type・risk surface・code topology 由来の signal は組成に関係なく常に発火を維持する。(2) **noise 先例の提示** — false positive を evidence 付きで noise/waiver として閉じた decision を型付き先例として蓄積し、同一 fingerprint（axis + signal 種別 + マッチ token）の再発火時に gate 出力へ「前回 noise 判定」の参照を添える。先例は文脈提示のみで、自動クローズは絶対にしない。

## User Story

**As a** docs/UI 中心の story を VibePro で通す agent と、gate 出力を読む operator<br>
**I want** 裏付けのない正規表現だけの axis 発火が diff 組成で事前に抑制され、再発した同型 false positive には前回の noise 判定が文脈として添付されること<br>
**So that** 誤検知を閉じ直すための audit evidence 再読が減り、かつ本物の security/scope リスクの検出力は落ちない

## Scope

- 発火事前条件: `buildSeniorJudgmentAxes` の signal 収集後、`classifyAxisActivationPrecision` に組成ルールを1つ追加する — 対象 axis（初期は `security_boundary` と `scope_reviewability`）で、候補 signal が changed-path/text 正規表現のみ、かつ diff 組成が docs/spec/UI 系グループのみ（source group の auth 隣接変更なし）の場合、`insufficient_signal` に降格する。route/risk_surface/code_topology/scope 由来 signal が 1 つでもあれば従来どおり `active`。
- noise 先例 ledger: axis blocker が `decision_record`（waiver/noise、`reason` + `artifact` 必須）で閉じられた際、`{ axis, signal_fingerprint, decision_id, story_id, closed_at }` を `.vibepro/` 配下の precedent ledger に追記する。
- 再発火時の提示: axis 評価時に同一 fingerprint の先例があれば、axis 出力に `prior_noise_precedents[]`（decision 参照と要約）を添付する。activation precision・blocker 判定・gate verdict は一切変更しない。
- 事前宣言する数値目標: (1) design token のみを触る synthetic diff で `security_boundary` が path-regex 単独では active にならない、(2) auth middleware の source 変更を含む synthetic diff では従来どおり active になる、(3) 同一 fingerprint の再発火で先例が添付され、かつ blocker は先例だけでは閉じない。

## Acceptance Criteria

- [ ] JAP-S-1: docs/spec/UI 組成のみの synthetic diff で、path 正規表現にのみマッチする `security_boundary` 候補は `insufficient_signal` に分類され、axis は active にならない。
- [ ] JAP-S-2: 同じ path 正規表現マッチでも、source group の変更または route/risk_surface/code_topology 由来 signal が併存する場合は従来どおり `active` になる（既存テストの発火ケースは全て不変）。
- [ ] JAP-S-3: `reason` と `artifact` を備えた noise/waiver decision で axis blocker を閉じると、precedent ledger に fingerprint 付きエントリが追記される。
- [ ] JAP-S-4: 同一 fingerprint の axis が別 run / 別 story で再発火した場合、axis 出力に `prior_noise_precedents[]` が含まれ、decision 参照から元の判断を辿れる。
- [ ] JAP-S-5: 先例の存在は activation precision・matched_blockers・gate verdict のいずれも変更しない（先例あり/なしで判定が同一であることをテストが固定する）。
- [ ] JAP-S-6: precedent ledger が存在しない・空・破損している場合、axis 評価は従来どおり動作し、破損は警告として報告される。

## 既存挙動（inherited behavior）

- JUDGMENT_AXIS_DEFINITIONS axis identifiers, decision questions, required_evidence, and blocking_criteria are unchanged/existing.
- Route-type, risk-surface, scope, and code-topology signal activation is unchanged; only uncorroborated path/text regex signals gain the composition precondition.
- Waiver validation rules (decision_id, reason, artifact required) in senior gap judgment are unchanged; the ledger is written after, not instead of, that validation.

## Non Goals

- 正規表現パターン自体の変更・削減（事前条件で降格するだけで、signal 収集は従来どおり行い監査可能性を残す）。
- 先例による自動クローズ・自動 waiver（先例は文脈提示のみ）。
- story frontmatter による self-declared な axis 抑制。
- `security_boundary` / `scope_reviewability` 以外の axis への適用（実績データが貯まってから別 story で判断）。

## Runtime Evidence

- current_reality: 変更は activation precision への組成ルール追加、precedent ledger モジュールの新設、axis 出力への advisory フィールド追加、focused tests のみ。gate DAG のノード・エッジ構成、新規 CLI コマンド・外部送信は追加しない。
- failure_modes: 組成判定の誤り（本来 active にすべき signal の降格）は、route/risk_surface/code_topology signal が独立に発火を維持するため単一故障にならない。ledger の読み書き失敗は axis 評価を止めず、warning として報告される。
