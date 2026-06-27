# チェックポイントと実行

VibeProのcheckpointは、複数段階の作業を監査可能にします。

代表的なcheckpoint:

- Storyを選択または作成した
- ArchitectureとSpecの文脈を確認した
- 実装が完了した
- 検証を記録した
- レビューを記録した
- PR準備を行った
- マージまたはリリース判断を記録した

managed executionを使う場合は、停止または失敗したrunを再開する前に `.vibepro/executions/` とPR artifact directoryを確認します。
