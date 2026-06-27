# 検証・判断・CI証跡

現在の変更に属する検証を記録します。

```bash
vibepro verify record . \
  --id <story-id> \
  --command "npm run typecheck" \
  --status passed
```

リスクが残る場合は判断を記録します。

```bash
vibepro decision record . \
  --id <story-id> \
  --status waived \
  --reason "<why this risk is accepted>"
```

CI出力は、review対象のcommit、branch、artifactに結びついている場合にだけ証跡として扱います。
