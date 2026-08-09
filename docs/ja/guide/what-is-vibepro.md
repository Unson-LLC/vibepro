# VibeProとは

VibeProは、AI支援ソフトウェア開発のためのリポジトリローカル証跡ワークスペースです。CLIが `.vibepro/` に構造化した文脈を書き、人間とコーディングエージェントが同じStory、Spec、検証、レビュー、判断、trace、PR記録を共有できるようにします。

## できること

- ローカルワークスペースと出力言語の初期化
- Storyの記録と診断
- code/test参照を持つSpecの記録
- リポジトリ状態に結びついた検証証跡の実行・記録
- role別レビュー証跡の準備・記録
- 明示的な判断とtrace宣言の記録
- 採用済みbatchの構造・消費を計測し、Development Control Loopで次のStory intentだけを制約
- PR引き渡し向けの証跡要約
- 任意のagent instructions導入と外部Graphify context連携

## しないこと

VibeProはアプリケーションコードを実装せず、証跡の十分性を認定せず、PRを承認せず、コードをmergeしません。最小コアにはGate DAG、一般的なblocking readiness判定、managed execution controller、review lifecycle会計、Story単位のdelivery-efficiency budget enforcement、自動audit bundleがありません。

代替のDevelopment Control Loopは、より狭い仕組みです。`shadow`ではintent不一致を可視化するだけで作業をblockしません。active Storyの移行後にrepositoryが明示的に`enforced`へ切り替えた場合だけ、不一致がStory plan、`pr prepare`、`pr create`をblockできます。並列agent実行は制限せず、PRの承認・merge権限も付与しません。

この境界は意図的です。VibeProは確認可能な事実と文脈を残し、判断と権限は人間、リポジトリルール、CIに残します。

## 正本

CLI契約の正本はinstalled binaryの `vibepro help` です。versionの正本は `package.json` です。公開マニュアルには過去のrelease historyも含まれるため、最小コアで廃止された機能への言及が残る場合があります。
