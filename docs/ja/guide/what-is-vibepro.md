# VibeProとは

VibeProは、**人間が意図したプロダクト**と**AI支援開発が実際に作るもの**を一致させ続けるためのシステムです。

AIコーディングエージェントは、技術的には正しいコードを書きながら、そもそも違う問題を解くことがあります。VibeProは、StoryからSpec、実装参照、検証、レビュー、明示的な判断、trace、PR引き渡しまでの因果関係をリポジトリローカルに残し、人間とコーディングエージェントが同じプロダクト意図と同じ証跡をレビューできるようにします。

```text
Intent
  -> Story
    -> Spec
      -> Implementation
        -> Verification
          -> Review / Decision
            -> PR handoff
```

## 解決する問題

ツール権限制御やagent sandboxは、AIにBashを使わせるか、ファイル編集を許すか、deployを許すか、といった実行能力を制御します。これらは有用ですが、その結果として作られたプロダクトが、変更を始めたときの意図に合っているかまでは保証しません。

VibeProが扱うのは、この意図とトレーサビリティの境界です。変更が受け入れられる前に、意図の逸脱を確認可能にすることが目的です。

## 現行コアでできること

- リポジトリローカルworkspaceと出力言語の初期化
- Storyの記録と診断
- code/test参照を持つSpecの記録
- プロダクト意図から実装証跡へ向かうtrace宣言の記録
- リポジトリ状態に結びついた検証証跡の実行・記録
- role別レビュー証跡の準備・記録
- 明示的な判断の記録
- PR引き渡し向けの意図→実装証跡の要約
- 任意のagent instructions導入と外部Graphify context連携

## しないこと

VibeProはアプリケーションコードを実装せず、プロダクトの意味を自律的に決めず、証跡の十分性や変更の安全性を認定せず、PRを承認せず、コードをmergeしません。最小コアには、従来の広範なGate DAG、blocking readiness authority、managed execution controller、review lifecycle会計、delivery-efficiency budget enforcement、自動audit bundleがありません。

この境界は意図的です。VibeProはプロダクト意図、確認可能な事実、レビュー証跡を維持します。AIが何を実行できるかという能力制御はagent/runtime側へ、最終的な意味判断と権限は人間、リポジトリルール、CIへ残します。

## 正本

CLI契約の正本はinstalled binaryの `vibepro help` です。versionの正本は `package.json` です。公開マニュアルには過去のrelease historyも含まれるため、最小コアで廃止された機能への言及が残る場合があります。
