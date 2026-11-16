# deploy-handoff.v1 契約

## 契約本体

Producerは、呼び出し元が入力ファイルを明示したときだけ、Storyごとに1つのJSONオブジェクトを`.vibepro/pr/<story-id>/deploy-handoff.json`へ書き出す。

```json
{
  "schema_version": "deploy-handoff.v1",
  "source": "vibepro",
  "handoff_id": "dh-0123456789abcdef0123456789abcdef",
  "created_at": "2026-10-10T00:00:00.000Z",
  "story_id": "story-example",
  "head_sha": "0123456789abcdef0123456789abcdef01234567",
  "story_ref": {
    "path": "docs/stories/story-example.md",
    "sha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  },
  "verification_ref": {
    "path": ".vibepro/pr/story-example/verification-evidence.json",
    "sha256": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
  },
  "pr_prepare_ref": {
    "path": ".vibepro/pr/story-example/pr-prepare.json",
    "sha256": "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"
  },
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

これは未マージの`head_sha`に対する意図（intent）である。`merge_sha`、`merge_commit_sha`、`request_id`、`deployed`、受入判定は意図的に含めない。`authority_ref`は監査用の不透明な参照文字列であり、記載されているだけでは権限を付与しない。

3つの`*_ref.path`はリポジトリ相対のPOSIXパスで、`sha256`はProducerが参照したバイト列を固定する。ProducerはPR本文、個人の知識、秘密情報、絶対パスをコピーしない。

## 二段階の責任

| 段階 | 担当 | 責任 | 表明できる状態 |
| --- | --- | --- | --- |
| 1. Intent | VibePro Producer | 入力を検証し、ローカルの`deploy-handoff.v1`を書き出す | source HEADと参照証跡のバイト列 |
| 2. Request | Operatorが管理するbridge | policyを認証し、GitHubのmerged PR、main、repository、approved head、non-zeroの`merge_commit_sha`を検証して`deployment-request.v1`を作る | 固定されたmerge commitとqueue request |

VibeProはbridgeを呼び出さない。bridgeはenqueue時にhandoffの参照を補足情報として保持してよい。既存enqueue consumerへ渡すのは必要なcriteriaのIDとconditionだけで、証跡の受入は別の責任として扱う。

入力を指定しない通常の`pr prepare`は、既存の`deploy-handoff.json`を削除しない。consumerはhandoffの`head_sha`を現在の対象HEADと照合し、残っているファイルだけを新しい意図として扱ってはならない。

## モードと緊急手動監査

契約の`mode`は`normal`と`standalone`の2値だけである。

- `normal`: 明示されたpolicyとmerged PRの検証に合格した後、bridgeが他の依頼と同じqueue処理へ進める。
- `standalone`: 他の依頼と集約せずに扱う配備を表す。bridgeは既存queueのfenceとruntimeの完全一致を検証し、単独の依頼として受け入れる。

Brainbase単独、VibePro単独、両者を接続した利用形態は`mode`では表さない。これらは製品の利用経路であり、どの経路でもProducerはBrainbaseへの接続を必須にしない。

緊急手動監査は3つ目のJSON enumではない。別の権限と監査手順として、担当者が対象PR、approved head、検証証跡、health確認を照合し、その監査証跡を別に記録する。handoff単体から`deployed`や`accepted`を記録してはならない。

## 拒否規則

次の入力は拒否する。

- 未知のversion、40桁hexでない`head_sha`、または全ゼロの`head_sha`
- 絶対パス、親ディレクトリ参照、リポジトリ外へ解決される参照、存在しない参照ファイル
- 空のcriteria、重複したcriteria ID、長さ制限を超える参照・criteria
- `owner/name`形式でないtarget、必須値が空のtarget、未知のmode
- 後段の状態を意味する追加フィールド（`merge_sha`、`merge_commit_sha`、`request_id`、`deployed`、`accepted`）

`head_sha`と各ダイジェストは小文字へ正規化する。criteriaの件数やverificationの成功数から、意味上のacceptedを推論しない。

## Bridgeでの引き渡し例

merged PRを独立して読み戻した後、bridgeはtarget、approved head、実際の`merge_commit_sha`、criteriaのIDとcondition、独自のrequest identityを持つ新しい`deployment-request.v1`を作成できる。GitHubが未merge、main以外、別repository、head不一致、空のmerge commitを返した場合は拒否する。同じ検証済みpayloadの再照合は冪等に扱い、同じrequest identityでpayloadが変わる場合は競合として拒否する。
