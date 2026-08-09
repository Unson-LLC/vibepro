# 機能マップ

| 目的 | Command family | 保存結果 |
| --- | --- | --- |
| リポジトリの初期化と確認 | `init`, `doctor`, `status` | `.vibepro/` の設定とhealth context |
| 影響範囲の文脈調査 | `graph`, `env graph`, `diagnose` | Graphとdiagnosis artifact |
| プロダクト意図の保存 | `story`, `spec`, `trace` | Story、Spec、trace記録 |
| 実行証跡の保存 | `verify` | リポジトリ状態に結びついた検証記録 |
| 人間またはagentの判断保存 | `review`, `decision` | レビューと判断記録 |
| シニアエンジニア判断の評価 | `judgment evaluate` | 助言型の判断DAGと上書きしない実行履歴 |
| 採用済みbatchの証跡から次のStory intentを制御 | `judgment status`, `judgment snapshot`, `judgment outcome record` | Development Control mode、immutable snapshot、outcome履歴 |
| command guardrailの追加 | `guard` | ローカルguard設定とreport |
| PRへの引き渡し準備 | `pr prepare`, `pr create` | PR contextと人間向け本文 |
| coding agentの設定 | `skills`, `codex`, `harness` | 導入済みinstructionsと学習記録 |
| 連携・artifact保守 | `brainbase`, `artifacts` | integrationとmigrationの出力 |

## 最小コアから廃止したもの

過去のrelease noteには次の概念が登場しますが、現行機能ではありません。Gate DAG、check pack、checkpoint、managed execution/merge、自動adjudication、一般的なreadiness/blocking判定、review lifecycle会計、Story単位のdelivery-efficiency budget enforcement、design modernization pipeline、usage/ROI report、自動audit bundle。より狭いDevelopment Control Loopはbudgetから次intentへのfeedback経路だけを置き換え、`shadow`から開始し、明示的な`enforced`時だけStory plan、`pr prepare`、`pr create`のintent不一致をblockできます。

installed versionの正確なcommandは `vibepro help --language ja` で確認してください。
