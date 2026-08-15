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
      "trust_zone": "managed_data",
      "residue_policy": "delete_by_tenant"
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
      "rollback": "restore_tenant_snapshot"
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
    "verification": { "scanner_coverage": "verified" }
  }
}
```

## 列挙値

- `tenancy_model`: `pooled | dedicated | hybrid | customer_managed | self_hosted`
- resource `sharing`: `pooled | shared | tenant_partitioned | dedicated | tenant_or_session_isolated | connection_defined`
- `deployment_modes`: `managed_shared | managed_dedicated | customer_managed | self_hosted`

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
