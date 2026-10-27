# GA4/GTM 実装結果

- 実装ツール: DeepSeek (opencode)
- 承認スコープ: Draft PR の作成のみ（マージ・配備・force push は行わない）
- 期限: 2026-10-29 18:00 JST
- 参考方式: brainbase #892

## 変更ファイル

- `docs/.vitepress/config.mjs`
  - `VITEPRESS_GTM_ID` → `GTM_CONTAINER_ID` の順で環境変数を解決し、空でない場合のみ GTM スクリプトを `head` に追加
  - ID が空の場合は `head` に何も追加しない（no-op）
  - noscript iframe は追加しない
  - テーマ側で ID の有無を判定できるよう `vite.define.__GTM_CONTAINER_ID__` を設定
- `docs/.vitepress/theme/gtm-outbound.js`（新規）
  - outbound click を `dataLayer` へ push
  - SSR 時は何もしない
  - コンテナ ID が空の場合は click listener を登録しない
- `docs/.vitepress/theme/index.js`
  - `installOutboundClickTracking()` を `enhanceApp` で呼び出し
- `_ga4_task/impl-result.md`（本ファイル）

`_headers` は変更していない。実 ID のハードコードもない。

## イベント

`outbound_click`

| パラメータ | 内容 |
|---|---|
| `outbound_url` | 遷移先 URL |
| `outbound_domain` | 遷移先ホスト名 |
| `link_text` | リンクテキスト（最大 100 文字） |
| `link_target` | `target` 属性 |

同一ホストへのリンク、および `http:` / `https:` 以外のリンクは送信しない。

## ID 空時の no-op

`env -u VITEPRESS_GTM_ID -u GTM_CONTAINER_ID npm run docs:build` でビルドし、生成された `docs/.vitepress/dist` に `googletagmanager` / `GTM-` が含まれないことを確認した。テーマ側も ID 空時は listener を登録せず、バンドルから `outbound_click` の処理が除去されることを確認した。

## 検証

clone 内 `_ga4_task/` にのみ出力を保存した。

| 検証 | 結果 |
|---|---|
| ID 未設定ビルド | 成功（exit 0、公開マニュアル契約 pass / 438 files） |
| ID 未設定 dist の `googletagmanager` / `GTM-` 検索 | 0 件（`rg` exit 1） |
| ID 未設定 dist の `outbound_click` 検索 | 0 件（listener 未登録） |
| ダミー ID 設定ビルド | 成功。`head` に GTM スクリプトとダミー ID を確認 |
| ダミー ID 設定 dist の `outbound_click` 検索 | 検出（テーマバンドルに含まれる） |
| 構文チェック（`node --check`） | config / theme index / gtm-outbound すべて成功 |

証跡ファイル:

- `_ga4_task/build-no-id.log`
- `_ga4_task/rg-no-gtm.log`
- `_ga4_task/rg-no-id-outbound.log`
- `_ga4_task/build-with-id.log`
- `_ga4_task/rg-with-id-html.log`
- `_ga4_task/rg-with-id-outbound.log`

## 未確認事項

- 実コンテナ ID が未提供のため、GA4 DebugView / Realtime でのイベント到達確認は未実施。ID 受領後に Draft PR のプレビュー環境または本番前確認で `outbound_click` を確認する。
- 本番配備は本承認スコープ外。Draft PR のレビュー後に別途判断する。
