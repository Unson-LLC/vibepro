# 非マルチテナント適用判定と実装証拠分離の設計

## 結論

`status: not_applicable`は適用範囲の判定、`implementation_readiness`は実装証拠の判定として分離する。前者を後者の代用にしない。

## 境界

- `detectMultiTenantApplicability`は強いシグナルと明示宣言を判定する。actorまたはboundaryの単独出現は、明示的な非該当を覆さない。
- `assessMultiTenantArchitecture`はcallerから渡された証拠だけを評価する。Contract内の自己申告はimplementation readinessへ昇格させない。
- fresh exact-HEADは`source=caller`、`status=verified`、expected HEAD一致、story/spec/implementation全表面の一致で構成する。
- 強いシグナルとの矛盾、構造エラー、証拠の欠落・鮮度不一致はfail-closedを維持する。

## 投影

`spec-store`はreadyな非該当証拠だけを保存可能にする。`spec-validator`は同じ証拠がなければfinalを拒否する。`pr-manager`は現在HEADをexpected HEADとして同じassessmentを要約する。

廃止済みGate DAGや`.vibepro`アーカイブには書き込まない。
