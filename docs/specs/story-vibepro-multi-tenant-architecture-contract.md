# Multi-tenant Architecture Contract仕様

## Spec項目

適用StoryのSpecはトップレベルに`multi_tenancy`を持つ。

```json
{
  "multi_tenancy": {
    "schema_version": "0.1.0",
    "tenancy_model": "pooled",
    "tenant_identity": {
      "canonical_key": "tenant_id",
      "resolved_from": ["authenticated_claim"],
      "resolution_point": "request_ingress",
      "missing_behavior": "deny",
      "ambiguity_behavior": "deny"
    },
    "propagation": {
      "required_surfaces": ["http", "queue", "storage"],
      "verified_surfaces": ["http", "queue", "storage"]
    },
    "resources": [{
      "name": "database",
      "sharing": "tenant_partitioned",
      "tenant_key": "tenant_id",
      "partition_key": "tenant_id/id",
      "trust_zone": "managed_data",
      "residue_policy": "delete_by_tenant",
      "data_owner": "tenant_database",
      "credential_scope": "tenant"
    }],
    "credentials": {
      "lookup_key": "tenant_id",
      "scope": "tenant",
      "raw_secret_in_artifacts": "forbidden",
      "cross_tenant_fallback": "forbidden"
    },
    "data": {
      "canonical_owners": ["tenant_database"],
      "residency": "tenant_selected_region",
      "migration": "copy_then_verify_by_tenant",
      "rollback": "restore_tenant_snapshot",
      "operator_action": "quarantine_tenant_and_restore_snapshot"
    },
    "failure_semantics": {
      "unknown_tenant": "deny",
      "ambiguous_tenant": "deny",
      "unavailable_connection": "unavailable",
      "no_data": "empty",
      "cross_tenant_candidate": "deny_and_audit"
    },
    "deployment_modes": ["managed_shared"],
    "negative_scenarios": [
      "unknown_tenant",
      "ambiguous_tenant",
      "unavailable_connection",
      "no_data",
      "cross_tenant_candidate"
    ],
    "graph_metadata": {
      "tenant_entities": ["Tenant", "Database"],
      "boundary_edges": ["Tenant->Database"]
    },
    "verification": {
      "scanner_coverage": "verified",
      "evidence": {
        "propagation_surfaces": ["http", "queue", "storage"],
        "negative_scenarios": ["unknown_tenant", "ambiguous_tenant", "unavailable_connection", "no_data", "cross_tenant_candidate"],
        "scanner_results": {
          "tenant_boundary": "pass",
          "tenant_key_propagation": "pass",
          "cross_tenant_authorization": "pass",
          "state_partitioning": "pass",
          "sandbox_isolation": "pass",
          "connection_routing": "pass",
          "secret_scope": "pass",
          "canonical_data_owner": "pass",
          "deployment_topology": "pass",
          "cross_tenant_negative_evidence": "pass"
        },
        "graph": {
          "tenant_key": "tenant_id",
          "sharing_modes": ["tenant_partitioned"],
          "deployment_modes": ["managed_shared"],
          "tenant_entities": [{
            "name": "Tenant",
            "tenant_scope": "tenant",
            "tenant_key_source": "authenticated_claim",
            "trust_zone": "managed",
            "data_owner": "tenant_database"
          }],
          "boundary_edges": [{
            "from": "Tenant",
            "to": "Database",
            "tenant_scope": "tenant",
            "tenant_key_source": "tenant_id",
            "sharing_mode": "tenant_partitioned",
            "credential_scope": "tenant",
            "connection_mode": "managed",
            "deployment_mode": "managed_shared"
          }]
        },
        "spec": { "tenant_key": "tenant_id", "sharing_modes": ["tenant_partitioned"], "deployment_modes": ["managed_shared"] },
        "implementation": { "tenant_key": "tenant_id", "sharing_modes": ["tenant_partitioned"], "deployment_modes": ["managed_shared"] }
      }
    }
  }
}
```

## 列挙値

- `tenancy_model`: `pooled | dedicated | hybrid | customer_managed | self_hosted`
- resource `sharing`: `pooled | shared | tenant_partitioned | dedicated | tenant_or_session_isolated | connection_defined`
- `deployment_modes`: `managed_shared | managed_dedicated | customer_managed | self_hosted`
- scanner result: `pass | fail | inconclusive`

`tenant_partitioned` resourceはcanonical keyを含む`partition_key`を必須とする。`tenant_or_session_isolated` resourceはdestroy、delete、expire、verified resetのいずれかを示すresidue policyを必須とする。`connection_defined` resourceは`connection_modes`を必須とする。

## 証拠照合

- `verification.evidence.propagation_surfaces`はContractの必須伝播面をすべて含む。
- Graphのentity/edgeは文字列名だけでなく境界metadataを持つ。
- Contract、Graph、Spec、実装のtenant key、sharing mode、deployment modeを同値比較する。
- scannerが対象を確認できない場合は`inconclusive`とし、確認済みpassとは区別する。
- negative scenarioの契約定義と実行証拠を別々に検証する。

## 状態

| 状態 | 意味 |
|---|---|
| `not_applicable` | Story固有のテナント境界シグナルがない |
| `ready` | 必須契約と検証範囲がそろう |
| `needs_review` | 契約は整合するが検証範囲が未確認 |
| `invalid` | 必須契約が欠落または矛盾する |

## review lens

- `tenant_architecture`: identityが入口から資源境界まで一意に伝播するか。
- `security_boundary`: credential、secret、dataに越境fallbackがないか。
- `operations_and_migration`: 配備、移行、rollback、削除、接続不能の意味が維持されるか。

## 互換性

非適用Storyでは`multi_tenancy`を要求しない。PR証拠要約は情報表示であり、旧Gate DAGや新しいreview lifecycleを構成しない。
