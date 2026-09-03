# Brainbase成果ケースv2紐付けの設計

## 境界

```
Brainbase handoff v1 ──> v1検証 ──> v1 context（変更なし）
signed managed handoff v2（outcome_caseを署名）──> v2検証 ──> context + existing Story metadata + PR metadata
                                                    │
                                                    └─> technical_complete / evidence
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

成果ケース契約はv2 contextの `outcome_case`、既存Storyの `outcome_case`、PR準備の `outcome_case` に投影する。既存Storyがない場合はContextを書き込む前に失敗する。configとContextの個別原子的置換の間に失敗した場合はconfigを復元し、`bound` を返さない。PR準備は、同じ値を持つmanaged v2 Contextと署名済みbind receiptをローカルで照合できた場合だけStory値を投影する。PR準備の `technical_completion` は信頼済み検証証跡の有無を明示するが、受入条件と証跡の対応が不明な場合は `technical_complete: false` と `status: unknown` を返す。

OutcomeCaseの状態値、close要求、外部書込み経路は追加しない。production probeは実行せず、宣言された終端証跡の参照先だけを保持する。

## 後方互換と失敗時

v1入力は従来のcontext v1を生成する。v2だけがcontext v2を生成する。v2の必須値が欠ける、または証跡が未信頼なら、成功・完了を推測せず明示的に拒否またはunknownを返す。v2を一度投影したStoryはv1へ再bindできないため、古いv2投影だけが残る状態を作らない。

## Codexからの直接利用

Codexが直接v2を投入してStory/PRへ権威ある成果ケースを投影することはできない。Brainbase管理ホストが `outcome_case` を含むcanonical payloadへHMAC署名した managed handoff v2をinboxへ渡し、VibeProが設定済みの信頼鍵で検証してからbindする。これは外部API呼出しを増やさず、署名済みhandoffを受け取ったCodexのローカル作業を可能にする契約である。
