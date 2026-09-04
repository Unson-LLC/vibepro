# Brainbase成果ケースv2紐付けの設計

## 境界

```
Brainbase handoff v1 ──> v1検証 ──> v1 context（変更なし）
signed managed handoff v2（outcome_caseを署名）──> v2検証 ──> durable journal
                                                        │
                                                        └─> 既存Story または標準CLIのStory先行宣言
                                                             + config + context + bind receipt + ledger
                                                             └─> commit marker ──> PR metadata
                                                                  （OutcomeCaseをcloseしない）
unmanaged handoff v2 ──> 拒否（Story/PRの権威メタデータへ投影しない）
```

## 契約

v2は `brainbase-vibepro-managed-handoff.v2` の署名済み `outcome_case` として、v1の既存判断・ナレッジ契約に次の必須フィールドを追加する。

- `case_id`
- `outcome_case_ref`
- `judgment_receipt_ref`
- `decision_digest`
- `user_observable_outcome`
- `technical_acceptance`: `{ id, criterion }` の空でない配列
- `production_probe`: `{ id, procedure, terminal_receipt_target }`

成果ケース参照は `brainbase://outcome-cases/<case_id>`、判断受領参照は署名済みhandoffの `resolution_id` に一致する `brainbase://judgment-receipts/<resolution_id>`、運用確認は `brainbase://production-probes/<probe_id>/receipt` でなければならない。これにより、caseをまたぐ参照や未知issuerをネットワーク照会なしで拒否する。判断ダイジェストは小文字SHA-256、IDは機械識別子として検証する。v1にはこの検証を適用しない。

## 投影と完了境界

成果ケース契約はv2 contextの `outcome_case`、Storyの `outcome_case`、PR準備の `outcome_case` に投影する。既存Storyがない一般bindは書込み前に失敗し、任意の `storyDeclaration` も拒否する。公開されたStory追加契約は正規化済みCLI項目だけを受け、Story重複検査とtraceability作成を含む完全な `story add` 処理を行う。その同じモジュール内でだけ非exportの宣言capabilityを使い、署名済みhandoffを検証してStory宣言を取引に含める。したがって一般bind APIも公開importも任意または不完全なStory宣言を渡せない。managed bindはconfig、Context、bind receipt、消費ledgerを1つの耐久ジャーナルへ記録し、全ファイルの置換後にcommit markerを書き込む。中断時はmarkerのない部分投影をPR準備が信頼せず、次のbindが同じジャーナルを前進回復するため、`bound` を返さない。

PR準備は、Context・Story・receipt・markerの局所一致だけを信頼しない。receiptに保持した署名済みmanaged handoff v2を設定済み信頼鍵で再検証し、canonical `outcome_case`、receipt/context digest、Story ID、project、repository、repository root、base SHA、resolution/turn、ledgerを照合できた場合だけStory値を投影する。ローカルの `signature_trusted` のような自己申告フラグは権威にしない。v1 ContextだけのStoryは成果ケース未連携であり、`outcome_case_status: none` / `not_linked` と表示して復旧判断を付けない。v2を示す投影を信頼できない場合は、改ざん・期限切れを `untrusted`、marker欠落や不足値を `partial`、読出し不能を `unknown` と安全なreason code・再bind/復旧判断をPR準備JSONとPR本文へ表示する。PR準備の `technical_completion` は信頼済み検証証跡の有無を明示するが、受入条件と証跡の対応が不明な場合は `technical_complete: false` と `status: unknown` を返す。

OutcomeCaseの状態値、close要求、外部書込み経路は追加しない。production probeは実行せず、宣言された終端証跡の参照先だけを保持する。

## 後方互換と失敗時

v1入力は従来のcontext v1を生成する。v1 ContextだけのPR準備は `none` / `not_linked` であり、v2回復を要求しない。v2だけがcontext v2を生成する。v2の必須値が欠ける、または証跡が未信頼なら、成功・完了を推測せず明示的に拒否またはunknownを返す。v2を一度投影したStoryはv1へ再bindできないため、古いv2投影だけが残る状態を作らない。

## Codexからの直接利用

Codexが直接v2を投入してStory/PRへ権威ある成果ケースを投影することはできない。Brainbase管理ホストが `outcome_case` を含むcanonical payloadへHMAC署名した managed handoff v2をinboxへ渡し、VibeProが設定済みの信頼鍵で検証してからbindする。これは外部API呼出しを増やさず、署名済みhandoffを受け取ったCodexのローカル作業を可能にする契約である。
