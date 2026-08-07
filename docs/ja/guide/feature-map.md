# 機能マップ

| 目的 | Command family | 保存結果 |
| --- | --- | --- |
| リポジトリの初期化と確認 | `init`, `doctor`, `status` | `.vibepro/` の設定とhealth context |
| 影響範囲の文脈調査 | `graph`, `env graph`, `diagnose` | Graphとdiagnosis artifact |
| プロダクト意図の保存 | `story`, `spec`, `trace` | Story、Spec、trace記録 |
| 実行証跡の保存 | `verify` | リポジトリ状態に結びついた検証記録 |
| 人間またはagentの判断保存 | `review`, `decision` | レビューと判断記録 |
| command guardrailの追加 | `guard` | ローカルguard設定とreport |
| PRへの引き渡し準備 | `pr prepare`, `pr create` | PR contextと人間向け本文 |
| coding agentの設定 | `skills`, `codex`, `harness` | 導入済みinstructionsと学習記録 |
| 連携・artifact保守 | `brainbase`, `artifacts` | integrationとmigrationの出力 |

## 最小コアから廃止したもの

過去のrelease noteには次の概念が登場しますが、現行機能ではありません。Gate DAG、check pack、checkpoint、managed execution/merge、自動adjudication、readiness/blocking判定、review lifecycle会計、delivery-efficiency budget、design modernization pipeline、usage/ROI report、自動audit bundle。

installed versionの正確なcommandは `vibepro help --language ja` で確認してください。
