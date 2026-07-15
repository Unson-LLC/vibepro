# リリースと監査

## 公開packageとcurrent main

| Surface | 意味 | 確認方法 |
| --- | --- | --- |
| npm `latest` / `beta` | 公開済みearly beta: `0.1.0-beta.0` | `npm view vibepro dist-tags --json` と `vibepro version` |
| GitHub `main` | unreleased changeを含む現在のsource | `git rev-parse HEAD` と `CHANGELOG.md` のUnreleased |
| このmanual build | footerと `vibepro-source-commit` meta tagに出るcommit | GitHub `main` と比較 |
| Local artifact | 特定repo / Story / headの証跡 | `.vibepro/` とGit headを確認 |

packageはearly betaです。install対象を明示する場合:

```bash
npm install -g vibepro@beta
vibepro version
```

current `main` のmanualにあるcommandが古いinstalled binaryにもあるとは限りません。生成済み[CLIリファレンス](/ja/reference/cli)はmanual source commitに一致し、差がある場合は実行中binaryの `vibepro help` が正本です。

## PR・CI・mergeのfreshness

Evidenceとreviewはhead-boundです。treeを確定してcommitし、verificationと独立reviewを記録してから `pr prepare` / `pr create` を実行します。CI完了後はimportし、prepareと既存PRをrefreshしてから `execute merge` します。

## Canonical auditとROI

`audit replay` は出荷したStoryをcanonical artifactから再構成できるか確認します。`usage report --gate-roi --subagent-roi` はGateや独立reviewがコストに見合う判断を生んだかを示します。blocked sourceはblockedのまま扱い、活動0に見せません。

Cloudflare Pagesのdeploy詳細はproduct modelではなく[hosting reference](/ja/reference/cloudflare-pages)に置きます。
