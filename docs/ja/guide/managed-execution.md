# Managed Execution

Managed executionはStory、target、branch、worktree、base commit、progress DAGを結びつけます。長時間のagent workflowを、無関係な作業と混ぜずに検査・再開できます。

```bash
vibepro execute start . \
  --story-id <story-id> \
  --target pr_create \
  --base origin/main

vibepro execute status . --story-id <story-id>
vibepro execute next . --story-id <story-id>
vibepro execute reconcile . --story-id <story-id>
```

VibeProが返したworktree pathとnext commandを使います。CLIはinstalled `vibepro` binary、またはrepo rootの `node bin/vibepro.js` entrypointから実行します。

## 再開ルール

1. execution status、記録済みbranch、worktree、headを確認する
2. worktreeに対象Storyの差分だけがあることを確認する
3. 外部PR / CI / merge状態が変わった可能性があればreconcileする
4. commit後はhead-boundなverification、review、adjudication、PR prepareを再実行する
5. provider unavailable、CI import失敗、runtime欠落を「結果0の成功」に変換しない

Managed executionは `.vibepro/executions/` にorchestration stateを記録します。codeとPR状態の正本はrepositoryとGitHubです。
