# 非マルチテナント適用証拠仕様

## Contract

```json
{ "applicability": "not_applicable" }
```

この宣言は`status: not_applicable`を決めるが、implementation readinessを決めない。

## Caller evidence

```json
{
  "source": "caller",
  "status": "verified",
  "head_commit": "<exact 40-character commit>",
  "required_surfaces": ["story", "spec", "implementation"],
  "verified_surfaces": ["story", "spec", "implementation"]
}
```

全条件が揃い、`head_commit`がcallerの`expectedHeadCommit`と一致した場合だけ`implementation_readiness.status=ready`とする。それ以外は`needs_review`かつ`evidence_status=inconclusive`とする。

強いmulti-tenantシグナルと非該当証拠の矛盾は`applicability_evidence_inconsistent`として構造化する。final Specでは不完全な非該当証拠を`multi_tenant_applicability_evidence_inconclusive`として拒否する。
