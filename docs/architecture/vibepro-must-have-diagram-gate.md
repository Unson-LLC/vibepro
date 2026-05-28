---
title: "VibePro MUST-HAVE Design Diagram Gate Architecture"
status: draft
created_at: 2026-05-29
updated_at: 2026-05-29
related_stories:
  - story-vibepro-must-have-diagram-gate
---

# VibePro MUST-HAVE Design Diagram Gate Architecture

## Intent

SPEC が表現する「不変条件 (clause)」と並んで、変更タイプに応じた「設計図 (diagram)」を SPEC の必須要素として組み込む。
変更内容に応じて DAG が "この変更には ER 図と状態遷移図が MUST" のように要求し、SPEC.diagrams[] に含まれていない場合は Gate がブロックする。

これは "AI が必要そうだから描く" nice-to-have モデルではなく、"トリガーが発火したら描かないと PR を作れない" must-have モデルである。

## Boundary

| Boundary | Responsibility | Must Not Do |
|----------|----------------|-------------|
| diagram-requirement-resolver | change signals → required_diagrams[] を返す純関数 | mermaid を生成する / clause を書く |
| spec-schema | diagrams[] の構造定義 (kind enum, mermaid string, entities[]) | mermaid 構文の完全パース |
| spec-validator | diagrams 配列の構造・kind・mermaid prefix・entity↔clause交差を検証 | mermaid render の視覚検証 |
| gate (gate:design_diagrams) | required_diagrams \ spec.diagrams[].kind が空かを判定し pass/blocked を返す | required の判定ロジックを内側で再実装 |
| spec-prompt-template | 呼び出し AI に diagrams[] 出力ルールを伝える | 図の中身を生成する |

## Component Diagram

```
┌────────────────────┐    ┌──────────────────────────────┐
│ story-fingerprint  │───▶│ diagram-requirement-resolver │
└────────────────────┘    │                              │
                          │  detect:                     │
┌────────────────────┐    │   - schema diff (er)         │
│ code-fingerprint   │───▶│   - status enum (state)      │
└────────────────────┘    │   - webhook/queue (sequence) │
                          │   - multi-step AC (flow)     │
┌────────────────────┐    │   - service boundary (c4)    │
│ AC count from Story│───▶│   - IaC diff (deployment)    │
└────────────────────┘    │   - auth/PII (threat_model)  │
                          │   - async pipeline (dfd)     │
                          └─────────────┬────────────────┘
                                        │ required_diagrams[]
                                        ▼
                          ┌──────────────────────────────┐
                          │ spec.json (AI authored)      │
                          │   clauses[], diagrams[]      │
                          └─────────────┬────────────────┘
                                        ▼
                          ┌──────────────────────────────┐
                          │ spec-validator               │
                          │   - schema ok                │
                          │   - diagrams structure ok    │
                          │   - mermaid prefix ok        │
                          │   - entities ↔ clauses cross │
                          └─────────────┬────────────────┘
                                        ▼
                          ┌──────────────────────────────┐
                          │ gate:design_diagrams         │
                          │   required \ provided == ∅ ? │
                          │     yes → pass               │
                          │     no  → blocked            │
                          └──────────────────────────────┘
```

## Trigger → Required Diagram Matrix

| Trigger Signal | Detection Source | Required Diagram | Mermaid kind |
|---|---|---|---|
| Prisma schema diff / `db/migrations/*` 追加 / `*.sql` の `CREATE TABLE`/`ALTER TABLE` | code diff (file path + content) | ER 図 | `er` |
| 新規 `status` / `state` 列または enum、XState/Symfony Workflow 定義 | code diff (regex on schema + xstate config) | 状態遷移図 | `state` |
| 新規 webhook route、queue producer/consumer、3rd party SDK import | code diff (file patterns + package.json deps diff) | シーケンス図 | `sequence` |
| Story.AC が 3 step 以上、または `checkout`/`onboarding`/`wizard` キーワード | story-fingerprint | 業務フロー図 | `flow` |
| 新規 package、新規 lambda/container 定義、新規 external system import | code diff (new dirs in src/) | C4 Context/Container | `c4_context` |
| IaC ファイル差分 (Terraform/Pulumi/k8s manifest)、新規 region/queue/cache | code diff | 配置図 | `deployment` |
| auth/authz関連ファイル、PII列追加、決済 SDK、暗号関数追加 | code diff (path keywords + crypto deps) | 脅威モデル | `threat_model` |
| 新規 queue/topic、cron 追加、stream 処理 (Kafka/Kinesis) | code diff (deps + file patterns) | DFD | `dfd` |

## Data Model

### Change Signal Input

```jsonc
{
  "story": {
    "ac_count": 5,
    "ac_keywords": ["checkout", "payment"]
  },
  "code_diff": {
    "files": [
      { "path": "prisma/schema.prisma", "status": "modified" },
      { "path": "src/api/stripe/webhook.ts", "status": "added" }
    ],
    "deps_added": ["stripe"]
  }
}
```

### Required Diagrams Output

```jsonc
{
  "required_diagrams": ["er", "sequence", "threat_model", "flow"],
  "reasons": [
    { "kind": "er", "signal": "prisma/schema.prisma modified" },
    { "kind": "sequence", "signal": "webhook route added: src/api/stripe/webhook.ts" },
    { "kind": "threat_model", "signal": "payment SDK added: stripe" },
    { "kind": "flow", "signal": "Story.AC count 5 (>= 3)" }
  ]
}
```

### spec.json Extension

```jsonc
{
  "schema_version": "0.1.0",
  "story_id": "...",
  "clauses": [...],
  "diagrams": [
    {
      "kind": "er",
      "mermaid": "erDiagram\n  USER ||--o{ SUBSCRIPTION : has\n  ...",
      "entities": ["USER", "SUBSCRIPTION"],
      "rationale": "Story acceptance_criteria[2] schema change"
    }
  ]
}
```

## Backward Compatibility

- `diagrams` フィールドは optional (required から外す)
- 既存 SPEC で `diagrams` 未定義 → 空配列扱い
- `required_diagrams` が空 (= 該当トリガー無し) なら gate は pass
- 既存テストは無回帰

## Integration with Existing Modules

- `change-risk-classifier.js` の隣に `diagram-requirement-resolver.js` を新設
- gate 集約箇所 (おそらく `pr-manager.js` または `gate-dag.js`) で `gate:design_diagrams` を追加
- `spec-validator.js` の clause 検証ループの後ろに diagrams 検証ブロックを追加
