# Brainbaseへの送信と受信確認

VibeProの検証から作られた学習候補を、明示的な `reconcile` 操作で送信します。送信の正常終了と、Brainbaseで検索可能になったことの確認を分けて保存します。

## 設定と実行

次の環境変数は、この送信経路用に新設した設定です。既存のBrainbase内部サービス用設定や内部共有シークレットは流用しません。

| 環境変数 | 値 |
| --- | --- |
| `BRAINBASE_KNOWLEDGE_API_URL` | 承認済みBrainbaseのオリジン。HTTPS必須。ループバックのテストだけHTTP可 |
| `BRAINBASE_KNOWLEDGE_API_TOKEN` | 対象プロジェクトへのアクセス権を持つBearerトークン |
| `BRAINBASE_KNOWLEDGE_ORGANIZATION_ID` | 対象組織のID |

トークンは環境変数で渡し、リポジトリや送信記録に保存しません。送信先・権限が未確定の場合は設定せず、送信待ちのままにします。検証コマンドはこの設定だけで自動送信を始めません。

```sh
node /path/to/vibepro/bin/vibepro.js integration brainbase reconcile /path/to/project --json
node /path/to/vibepro/bin/vibepro.js integration brainbase status /path/to/project --id STORY_ID --json
```

`PATH` の `vibepro` と修正候補のCLIが同じバージョン表示でも、実装が同じとは限りません。候補の検証では上記のように対象の `bin/vibepro.js` を直接指定します。

## 既存の受信契約

Brainbase `4d04fa5c2` の `server/routes/knowledge-events.js`、`server/services/knowledge-event-service.js`、`server/services/knowledge-cycle-query-service.js` と照合しています。

1. `POST /api/knowledge/events` に非昇格の `knowledge_event.v1` を渡し、202応答の `event_id` と `candidate_id` を保存します。
2. `GET /api/knowledge/cycles/:eventId?project_code=...` で `knowledge_cycle_receipt.v1` を読み戻します。
3. 両IDの一致、`semantic_state=active`、失敗理由なし、`processing_stage=retrievable`、検索可能になった時刻と段階履歴を確認します。

両リクエストはBearer認証を使います。組織ヘッダーはサービス認証の組織指定に使われます。POST本文にも設定した `organization_id` を付加し、受信側に認証組織との一致を検証させます。利用者認証の組織は受信側が認証情報から決め、ヘッダーで権限を上書きしません。元のローカル候補は変更しません。

## 保存状態と再試行

`.vibepro/integrations/brainbase/outbox/<event_id>.json` に送信先、送信状態、受信応答のID、受信記録、確認時刻を保存します。

| 状態 | 意味 |
| --- | --- |
| `delivery_status=pending` | 未送信、または送信失敗。設定・待機時間を満たすと再試行 |
| `delivery_status=sent`, `receiver_status=unknown` | 送信関数は正常終了。受信確認は未完了 |
| `receiver_status=failed` | 読戻し失敗、ID不一致、隔離・無効状態など |
| `receiver_status=confirmed` | 同じ候補の受信記録と検索可能な状態を確認済み |

送信後の再試行はGETだけを行います。受信応答を返さない旧senderは `sent/unknown` のままで、勝手に再送しません。送信自体の失敗で再送する場合は同じイベントIDを使い、Brainbaseの既存の冪等処理に委ねます。送信先が途中で変わった場合は処理を止めます。

`reconcile` の終了コードは、全件受信確認済み（または対象なし）が0、送信待ち・受信未確認が2、失敗が1です。JSONには送信件数と受信確認件数を別々に出します。

この受信確認は、判断エピソードやOutcomeの完了ではありません。VibeProは `value proof` や `complete` を呼びません。

## 受入条件と検証

利用者が送信成功だけで全件完了と誤認せず、失敗から重複送信せずに復旧できることを受入条件とします。実装は `src/brainbase-transport.js` と `src/brainbase-integration.js`、CLIの終了コードに限定します。旧Gate、Resolver、Host、本番設定は変更しません。

```sh
node --test test/brainbase-integration.test.js test/brainbase-receiver-ack.test.js test/brainbase-transport.test.js test/brainbase-receiver-cli.test.js
```

固定fixtureで未設定、送信失敗・再送、読戻し失敗・再確認、隔離、ID不一致、重複抑止を検証します。ループバックHTTPテストは実際のCLI入口から保存までを確認します。本番Brainbaseへの配送は、このテストの合格とは別に確認が必要です。
