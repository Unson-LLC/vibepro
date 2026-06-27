# エージェントレビュー

Agent Reviewは、PR作成またはマージ前に役割別のレビュー証跡を残します。

```bash
vibepro review prepare . --id <story-id>
vibepro review record . --id <story-id> --role <role> --status passed --summary "<summary>"
vibepro review status . --id <story-id>
```

レビュー記録は、準備中のdiffに対して現在有効である必要があります。stale、missing、blocked、手動停止されたreview lifecycleは、PR readinessを `needs_review` に保つことがあります。
