---
story_id: story-vibepro-evidence-reuse-metric-semantics
title: "Gate evidence reuseの生成回数メトリクスを意味別に分離する"
status: active
view: dev
period: 2026-06
source:
  type: value_audit_followup
  id: VP-VALUE-AUDIT-2026-06-24-REUSE-METRIC-SEMANTICS
  title: "reuse hitとfull evidence generation countの意味衝突を解消する"
related_stories:
  - story-vibepro-evidence-summary-reuse
  - story-vibepro-canonical-audit-artifacts
  - story-vibepro-usage-report-canonical-traceability
architecture_docs:
  - docs/architecture/vibepro-evidence-reuse-metric-semantics.md
spec_docs:
  - docs/specs/vibepro-evidence-reuse-metric-semantics.md
created_at: 2026-06-24
updated_at: 2026-06-24
---

# Story

VibeProのGate DAG / review evidence監査で、`status=hit` なのに `full_evidence_generation_count=9` と表示される merged story が見つかった。
既存Specは「同じ `evidence_key` のfull evidenceは2回目以降再生成せず、`generation_count` を1に保つ」と定義していたが、
実装はstale/new keyをまたいだ累積生成回数にも同じフィールドを使っていた。

このままだと、reuseが効いているのか、単に過去の再生成回数をcarryしているだけなのかをusage report、Gate evidence、canonical auditから判断できない。

## User Story

**As a** VibeProの価値監査を読むengineer<br>
**I want to** same-key reuse KPIと累積生成履歴を別々に見たい<br>
**So that** reuse hitの価値と、PR lifecycle全体の証跡生成コストを混同せず判断できる

## Scope

- `full_evidence.generation_count` は既存契約どおり same evidence key 内の生成回数として扱う
- 累積生成履歴は `full_evidence.cumulative_generation_count` として別フィールドに出す
- 明示的な `generation_count_scope` と `same_key_generation_count` を追加する
- `usage report` はsame-key countとcumulative countを並べて表示する
- `execute merge` のcanonical audit summaryは新旧メトリクスを保持する
- Gate / review artifact consumersが、同じ指標をsame-key reuse KPIとして読むのか、累積cost historyとして読むのかを再構成できる

## Acceptance Criteria

- [ ] Same `evidence_key` の2回目以降の `pr prepare` は `full_evidence.generation_count=1` を維持し、`status=reused` を出す。
- [ ] Stale/new keyでfull evidenceを再生成しても `generation_count` は1に戻り、`cumulative_generation_count` だけが増える。
- [ ] Stale後に同じnew keyを再実行した場合、`status=hit`、`generation_count=1`、`cumulative_generation_count` は直前の累積値を維持する。
- [ ] `usage report` は `generation_count_scope`、same-key full generation count、cumulative full generation countを表示する。
- [ ] canonical audit compact summaryはsame-keyとcumulativeの両方を保持し、main-only auditで意味を再構成できる。
- [ ] Regression testは `ERM-CONTRACT-001` から `ERM-CONTRACT-004` のclause IDを含み、genericなpass-only証跡にしない。
- [ ] Gate DAG / review evidence の再生成フローを、現在HEADに束縛された artifact replay として検証できる。

## Non Goals

- evidence keyの構成要素変更。
- full evidence digestの生成内容変更。
- 既存canonical audit artifactの過去データを書き換えること。
