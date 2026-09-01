# Production verification scope architecture
## Decision

検証の実行結果と利用者価値を確認した範囲を分離する。

- accepted Spec clauseが`verification.required_scopes`でAC成立に必要な範囲を宣言する。
- verification evidence commandは`scope`と`evidence_state`を持つ。
- traceabilityがtest refへの結合後、ACごとにscope stateを集約する。
- PR rendererは集約済みの構造化値だけを表示し、Story/AC本文から状態を推測しない。

## Public contract

```json
{
  "verification": {
    "status": "mapped-but-unverified",
    "required_scopes": ["local_test", "production"],
    "scopes": {
      "local_test": { "status": "verified" },
      "production": { "status": "not_collected" }
    }
  }
}
```

scopeは`local_test`または`production`。evidence stateは`verified`、`failed`、`partial`、`not_collected`。required scopeがmissing、`partial`、`not_collected`、`failed`なら総合状態は`mapped-but-unverified`とする。

scopeを持たない既存commandは`local_test`、`status=pass`は`verified`として読む。既存の`verification_status`は総合状態の互換aliasとして保持する。

## Rejected alternatives

- AC本文に`production`や`not_collected`が含まれるかを正規表現で推測する: 文言変更で状態が変わるため不採用。
- ローカルpassを`verified`のまま表示し注記だけ足す: machine consumerが誤昇格を続けるため不採用。
- production evidence専用artifactを別系統で作る: traceabilityとPR本文の正本が分裂するため不採用。
