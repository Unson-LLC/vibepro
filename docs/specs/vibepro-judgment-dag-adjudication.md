---
story_id: story-vibepro-judgment-dag-adjudication
title: Judgment DAG Adjudication Spec
parent_design: vibepro-judgment-dag-adjudication
---

# Judgment DAG Adjudication Spec

## 目的

Common Judgment Spine・Judgment Axes・Failure Mode Coverageの各項目を、証拠テキストの
トークン照合ではなく、独立fresh context LLM judgeのチェックリスト裁定で消化させる。
既存のトークン照合はルーティング（どの項目がアクティブか）と防御層として残し、
消化条件からは降格する。evidence adjudication gate（clause裁定）の判断DAG版。

## CLI

```
vibepro adjudicate prepare <repo> --id <story-id> --judgment
vibepro adjudicate record <repo> --id <story-id> --judgment \
  --item <item-id> --verdict <judged_sound|judged_unsound|needs_human_judgment> \
  --reason <text> --agent-system <system> --agent-id <id> [--session-ref <ref>]
```

## 項目収集（collectJudgmentItems）

- 一次入力: 最新 `pr-prepare.json` の `pr_context.gate_dag`。成果物なしは明示エラー
- routeスコープ: `engineering_judgment.route_type === 'agent_workflow'` または
  `change_classification.profile === 'workflow_heavy'` のときのみ収集。他routeは0件
- 3系統:
  - `spine:<subcheck_id>` — `gate:common_judgment_spine` のsubchecks（surface・機械的消化状態・一致証拠つき）
  - `axis:<axis_id>` — `type: judgment_axis_gate` ノード（`decision_question` 原文つき）
  - `failure_mode:<mode_id>` — `gate:failure_mode_coverage` のmodes（候補理由・キーワード・消化証拠つき）
- アクティブ項目0件でのprepareは明示エラー（pass風の空成果物を作らない）

## 依頼書（judgment-adjudication-request.md）

- 全アクティブ項目のチェックリスト: 問い原文＋機械的消化の現状＋一致した証拠＋変更ファイル一覧
- 裁定者指示: 独立fresh contextでの実行・反証を試みる立場・3値定義・
  「トークンや文言が揃っていることだけを根拠に judged_sound を選んではならない」

## 記録（judgment-adjudication.json）

- clause裁定の `adjudication.json` とは別ファイル
- 各entry: `{ item_id, verdict, reason, provenance{agent_system, agent_id, session_ref}, head_commit, recorded_at }`
- 検証: verdict 3値以外・空reason・provenance欠落はエラー。記録時HEAD解決不能は拒否

## ゲート（gate:judgment_dag_adjudication）

- evidence_adjudicationゲート直後に評価。required・critical（理由のみwaiver不可）
- 状態遷移:
  - 裁定なし / stale HEAD / 項目不足 → `needs_evidence`（不足item id列挙）
  - いずれか `judged_unsound` → `failed`（judge理由をreasonへ）
  - `needs_human_judgment` → accepted decision record（source
    `gate:judgment_dag_adjudication:<item-id>`、reason+artifact必須）でのみ解決
  - 全項目解決 → `passed` / アクティブ項目0件 → `not_applicable`
- fail-closed: entryの `head_commit` 欠落・現HEAD解決不能はすべてstale扱い
- opt-out: `.vibepro/config.json` `judgment_adjudication.enabled: false`（既定有効）

## 非目標

- 既存トークン照合ロジックの変更・撤去
- clause裁定との統合
- VibePro自身によるLLM呼び出し
- path surface / responsibility authority系の裁定対象化（後続展開）
