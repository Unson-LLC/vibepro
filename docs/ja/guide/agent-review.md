# レビューの記録

VibeProのレビュー記録は、Storyに対する軽量な確認結果を保存します。レビューの役割は必要に応じて指定できます。`prepare` は確認対象と記録方法を示し、`record` は判定と具体的な証跡を保存します。

```bash
vibepro review prepare . --id <story-id> --role reviewer
```

複数の役割を準備する場合は `--roles reviewer,security` または `--role` の繰り返しを使います。レビュー結果を記録する例は次のとおりです。

```bash
vibepro review record . \
  --id <story-id> --role reviewer \
  --status pass --summary "StoryとSpec、変更対象を確認済み" \
  --inspection-input src/example.js \
  --artifact .vibepro/verification/unit.json
```

標準入力からレビュー結果を渡す場合は `--from-stdin` を使います。利用できる状態は `pass`、`needs_changes`、`block`、`runtime_failed` です。`agent-system` と `agent-id` は、別のレビュー実行元を記録する場合に指定できます。

```bash
vibepro review record . --id <story-id> --role reviewer \
  --status needs_changes --summary "入力検証に具体的な不足がある" \
  --inspection-input src/example.js --agent-system codex --agent-id reviewer-1
```

```bash
vibepro review status . --id <story-id>
```

合格の記録には、実在する `.vibepro` 外の確認対象ファイルが必要です。確認したファイルの内容が変わると、記録は古い状態になります。未記録や古い記録だけではPR準備を止めません。具体的な未解決指摘を `needs_changes` または `block` で記録すると、解消するまでPR準備を止めます。

以前のレビュー段階や実行履歴・コスト・strict-headの設定は、軽量レビューでは参照せず無視します。PRの準備では、Story、Spec、検証、レビューの記録を人間が確認できる要約として扱います。

問題を修正したら、最新の変更箇所を確認してレビューを記録し直してください。
