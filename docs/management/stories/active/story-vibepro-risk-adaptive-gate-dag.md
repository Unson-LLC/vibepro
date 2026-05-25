---
story_id: story-vibepro-risk-adaptive-gate-dag
title: Risk-adaptive Gate DAGで変更タイプに応じて検証を重くする
view: dev
period: 2026-05
architecture_docs:
  reason: 既存のPR Gate DAGとAgent Review Gateの判定強化であり、新しいrunner基盤は追加しないため
spec_docs:
  - ../../specs/vibepro-risk-adaptive-gate-dag.md
status: active
created_at: 2026-05-25
updated_at: 2026-05-25
---

# Risk-adaptive Gate DAGで変更タイプに応じて検証を重くする

## 背景

VibeProのPR Gate DAGはStory / Spec / Unit / Integration / E2E / Agent Reviewを並べられるが、変更の性質によってDAGの形そのものを変える力が弱い。

STR-061のようにUI、API、service、DB state、queue/worker、polling/retry、legacy/v1、auth境界をまたぐ変更は、通常のUnit/API gateだけでは本番導線の破綻を止められない。変更タイプがcross-surface workflowであると分類された時点で、VibeProはworkflow-heavy gate profileへ切り替え、Flow Verificationや状態遷移/経路証跡がない限りrelease readyにしてはいけない。

## 方針

- `vibepro pr prepare` は差分、Story、Network Contract evidenceから変更タイプを分類する。
- 分類結果を `gate:change_classification` としてGate DAGに出す。
- `cross_surface_workflow_change` は `workflow_heavy` profileとして扱い、通常gateに加えてworkflow専用gateを必須化する。
- workflow-heavyでは、Flow Verification未実行、scenario clause不足、blocker open questionがある状態を `ready_for_review` にしない。
- Agent Reviewは一律の固定reviewではなく、risk surfaceに応じて必要roleを増やす。

## 受け入れ基準

- [ ] UI/API/service/state/queue/retry/auth/legacyの複数surfaceをまたぐ差分は `workflow_heavy` に分類される
- [ ] `gate-dag.json` に `gate:change_classification` が出る
- [ ] `workflow_heavy` の場合、Workflow State Machine / Production Path Matrix / Workflow Flow Replay / Evidence Coverage / Release Confidence gateがDAGに追加される
- [ ] `workflow_heavy` でFlow Verificationまたはcurrent E2E証跡がない場合、`overall_status` は `needs_verification` になる
- [ ] `workflow_heavy` でscenario clauseがない場合、状態遷移証跡不足として止まる
- [ ] `workflow_heavy` で `spec.open_questions[].blocker=true` がある場合、release readyにならない
- [ ] Agent Review required rolesは `workflow_heavy` でpreview/network/runtime/gate coverage/release riskまで増える
- [ ] UIのみ、APIのみ、docsのみの変更はそれぞれ `ui_interaction`、`api_contract`、`light` として過剰にworkflow-heavy化しない
- [ ] Flow Verificationはcurrent git bindingを持ち、既存の `BASIC_AUTH_USER && BASIC_AUTH_PASSWORD` env利用をログ/成果物へ平文保存しない
- [ ] `npm test` と `npm run typecheck` が通る
