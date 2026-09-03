# Brainbase成果ケースv2紐付けの設計

## 境界

```
Brainbase handoff v1 ──> v1検証 ──> v1 context（変更なし）
Brainbase handoff v2 ──> v2検証 ──> context + Story metadata + PR metadata
                                                    │
                                                    └─> technical_complete / evidence
                                                         （OutcomeCaseをcloseしない）
```

## 契約

v2はv1の既存判断・ナレッジ契約に、次の必須フィールドを追加する。

- `case_id`
- `outcome_case_ref`
- `judgment_receipt_ref`
- `decision_digest`
- `user_observable_outcome`
- `technical_acceptance`: `{ id, criterion }` の空でない配列
- `production_probe`: `{ id, procedure, terminal_receipt_target }`

すべての参照は非ローカルの正規URIでなければならない。判断ダイジェストは小文字SHA-256、IDは機械識別子として検証する。v1にはこの検証を適用しない。

## 投影と完了境界

成果ケース契約はv2 contextの `outcome_case`、既存Storyの `outcome_case`、PR準備の `outcome_case` に投影する。PR準備の `technical_completion` は信頼済み検証証跡の有無を明示するが、受入条件と証跡の対応が不明な場合は `technical_complete: false` と `status: unknown` を返す。

OutcomeCaseの状態値、close要求、外部書込み経路は追加しない。production probeは実行せず、宣言された終端証跡の参照先だけを保持する。

## 後方互換と失敗時

v1入力は従来のcontext v1を生成する。v2だけがcontext v2を生成する。v2の必須値が欠ける、または証跡が未信頼なら、成功・完了を推測せず明示的に拒否またはunknownを返す。
