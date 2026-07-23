# Architecture: PR作成時のGate waiverをexecute mergeへ伝播する

## 判断

`execute merge` はcurrent HEADに束縛された `pr-create.json` をPR lifecycle authorityとして既に解決している。そのartifact内の `gate_override` を、Gate DAGの通常ready判定に次ぐ唯一の代替authorizationとして評価する。

## データフロー

1. `pr create` が非critical unresolved gateだけを許可し、理由・policy・対象Gateを `gate_override` へ永続化する。
2. `execute merge` が `artifact_freshness` とHEAD SHAの一致を検証し、currentな `pr-create.json` だけを採用する。
3. `gate_dag.overall_status=ready_for_review` なら通常authorizationを返す。
4. 通常readyでない場合、`gate_override.allowed=true`、空でないreason/policy、`critical_unresolved_gates=[]` をすべて満たす場合だけwaiver authorizationを返す。
5. merge artifactへauthorization sourceとwaiver監査情報を記録し、その他のGitHub preconditionとANDでmerge可否を決める。

## Threat model

```mermaid
flowchart LR
  Current["current HEAD pr-create artifact"] --> Validate["schema + reason + policy + critical=0"]
  Ready["ready_for_review Gate DAG"] --> Authorize["merge gate authorization"]
  Validate --> Authorize
  Stale["stale / missing artifact"] --> Reject["gate_not_ready"]
  Malformed["missing reason or policy"] --> Reject
  Critical["critical unresolved gate"] --> Reject
  Authorize --> Preconditions["GitHub checks + review + base freshness"]
  Preconditions --> Merge["host-owned GitHub merge"]
```

`pr-create.json` のHEAD bindingを信頼境界とし、stale・欠落・schema不正・critical gateを
理由だけで昇格させない。VibeProはauthorization policyと監査artifactを所有し、GitHubは
外部preconditionと実mergeを所有する。

## Authority / compatibility / rollback

- Authority: Gate waiverの正本は同一HEADの `pr-create.json`。`execute merge` のCLI引数や推測では再生成しない。
- Compatibility: `ready_for_review` の既存経路、GitHub checks、review policy、base freshness、remote HEAD一致は変更しない。
- Fail-closed: stale artifact、schema不足、critical unresolvedありは `gate_not_ready`。
- Rollback: merge authorization helperとprecondition配線を戻せば従来のGate DAG only判定へ戻る。永続artifactの追加フィールドはreader互換を保つ。

## 影響範囲

- `src/merge-gate-authorization.js`: pure policy evaluation
- `src/merge-manager.js`: current PR lifecycle artifactとのbindingと監査出力
- `test/merge-gate-authorization.test.js`: contract matrix
- `test/vibepro-cli.test.js`: `execute merge` dry-run/integration contract

PR #381のruntime lifecycleおよびPR #370のbudget policyは依存先でも変更対象でもない。
