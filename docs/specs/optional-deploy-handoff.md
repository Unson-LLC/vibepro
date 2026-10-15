# 任意デプロイhandoff仕様

## 目的

VibeProのPR準備から、必要なときだけデプロイ担当へ渡せる小さなローカル契約を追加する。対象は配備意図の保存までで、配備キュー、認可、GitHub API、Brainbase APIをVibeProへ持ち込まない。

## フロー

```text
pr prepare + 明示した入力JSON
    -> VibeProが入力を検証し、ローカルのdeploy-handoff.v1を記録
    -> operator/bridgeがmerged PR、target main、repository、approved head、non-zero merge commitを確認
    -> bridgeがdeployment-request.v1を固定してenqueue
```

`deploy-handoff.v1`は未マージのlocal intentである。後段でマージ済みcommitへ結び付けるまでは、配備依頼でも権威でもない。

## Producerの入力

入力JSONは必要最小限にする。

```json
{
  "schema_version": "deploy-handoff.v1",
  "target": {
    "repository": "owner/service",
    "environment": "staging"
  },
  "acceptance_criteria": [
    {
      "id": "AC-1",
      "condition": "ヘルスエンドポイントが期待するサービス状態を返す。",
      "evidence_method": "bridgeが管理する配備後にエンドポイントを読み取り、証跡を保存する。"
    }
  ],
  "mode": "normal",
  "authority_ref": "authority://operator-approval/example",
  "external_refs": ["https://example.invalid/runbook"]
}
```

`schema_version`は省略時も`deploy-handoff.v1`として扱うが、指定する場合は一致しなければならない。`target.repository`、`target.environment`、1件以上のcriteria、`mode`、`authority_ref`は必須である。`external_refs`は任意の文字列配列で、最大20件。秘密情報や本文のコピーには使わない。

Producerが導出する値は、現在のgit `head_sha`と、Story、検証証跡、`pr-prepare.json`のリポジトリ相対参照（各ファイルのSHA-256付き）である。絶対path、`..`、改行、個人知識、secret、PR本文は出力しない。参照文字列は512文字以内、criteriaのIDは128文字以内、conditionとevidence_methodはそれぞれ1024文字以内とする。

## 2つの契約modeと利用形態

JSONの`mode`は次の2値だけを受け付ける。

- `normal`: 明示されたpolicyとmerged PRの検証に合格した後、bridgeが他の依頼と同じqueue処理へ進める。
- `standalone`: 他の依頼と集約せずに扱う配備を表す。bridgeは既存queueのfenceとruntimeの完全一致を検証し、単独の依頼として受け入れる。

Brainbase単独、VibePro単独、両者を接続した利用形態は`mode`とは別である。入力JSONを指定しない通常の`pr prepare`を含め、どの利用形態でもVibePro単体の動作を維持する。

入力を指定しない通常の`pr prepare`は、既存の`deploy-handoff.json`を削除しない。consumerはhandoffの`head_sha`を現在の対象HEADと照合し、残っているファイルだけを新しい意図として扱ってはならない。

### 緊急手動監査

緊急手動監査はJSONの第三のmodeではない。別の権限と監査手順として、担当者が`standalone` handoffを対象PR、approved head、検証証跡、health確認と照合し、監査証跡を別に記録する。照合が終わるまで`deployed`や`accepted`を記録しない。

## 検証

Validatorはunknown version、40桁hexでない`head_sha`、全ゼロの`head_sha`、repo相対でない参照、リポジトリ外へ解決される参照、存在しない参照ファイル、空criteria、重複criteria ID、長さ制限超過、空のcriteria field、無効なtarget、未知のmode、制御文字を拒否する。criteriaの件数やverificationの成功数から、意味上のacceptedを推論しない。

## 対象外

- Brainbaseへの送信・認証・タスク同期
- GitHubのPR取得やmerge確認
- 配備queueへのenqueue、health probe、rollback
- `merge_sha`、`request_id`、配備済み状態の生成
- 通常の`pr prepare`への必須入力化
