---
story_id: story-vibepro-node20-e2e-ts-ci-visibility
parent_design: vibepro-node20-e2e-ts-ci-visibility
status: final
created_at: 2026-07-22
updated_at: 2026-07-22
---

# Spec: Node 20 CIレーンのe2e .ts spec偽passを可視化しNode 22+必須ゲートで実行する

機械可読の正本は `.vibepro/spec/story-vibepro-node20-e2e-ts-ci-visibility/spec.json`。本書はそのhuman-readableミラー。

## Clauses

- **S-001 (invariant / AC-1)**: `scripts/run-e2e-ts-specs.mjs` は `test/e2e/*.spec.ts` を決定的（sorted）に列挙し、0件なら `::error::` annotationを出してexit 1する。silent no-opは禁止。
- **S-002 (contract / AC-2)**: 実行NodeがType Stripping対応（>= 22.6.0）の場合、列挙した全specファイルを `node --test` へ明示的に渡し、子プロセスのexit statusを伝播する。これによりNode 22 CIレーンがe2e .ts specの必須ゲートになる。
- **S-003 (contract / AC-3)**: Type Stripping非対応（< 22.6.0）の場合、偽装実行しない。スキップ件数入りの `::warning::` annotationを出してexit 0し、`node --test` をspawnせず、`ERR_UNKNOWN_FILE_EXTENSION` を発生させない。
- **S-004 (contract / AC-4)**: `package.json` の `test:e2e:ts` script と `.github/workflows/ci.yml` の全matrixレーンでの `npm run test:e2e:ts` step 配線。
- **S-005 (scenario / AC-5)**: 両レーンで実行される `.js` 回帰テストが、runner状態機械（Enumerating / Running / Passed / Failed / Skipped / FailedClosed）・22.6.0境界・プロセスレベル再現・CI配線を固定する。

## Diagrams

### CI lane flow

```mermaid
flowchart LR
  A[CI matrix lane starts] --> B[npm test / node --test]
  B --> C[npm run test:e2e:ts]
  C --> D{test/e2e/*.spec.ts count}
  D -- 0 files --> E[::error:: annotation, exit 1]
  D -- N files --> F{Node >= 22.6.0?}
  F -- yes --> G[node --test with explicit spec files]
  G -- child exit 0 --> H[lane pass: e2e .ts gate satisfied]
  G -- child exit != 0 --> I[lane fail: spec regression blocked]
  F -- no --> J[::warning:: Skipped N e2e .ts specs, exit 0]
  J --> K[lane pass with visible coverage gap]
```

### Runner state machine

```mermaid
stateDiagram-v2
  [*] --> Enumerating
  Enumerating --> FailedClosed: zero spec files
  Enumerating --> Skipped: Node < 22.6.0
  Enumerating --> Running: Node >= 22.6.0
  Running --> Passed: child exit 0
  Running --> Failed: child exit != 0
  FailedClosed --> [*]
  Skipped --> [*]
  Passed --> [*]
  Failed --> [*]
```

## Rollback

`.github/workflows/ci.yml` の `npm run test:e2e:ts` step、`package.json` の `test:e2e:ts` script、`scripts/run-e2e-ts-specs.mjs`、`test/node20-e2e-ts-ci-visibility.test.js` を削除すれば従来挙動（Node 20レーンの黙殺スキップ）へ戻る。
