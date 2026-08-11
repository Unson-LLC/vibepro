# リリース境界

VibeProでは4種類の証明を分けます。

1. `package.json` のversionはrelease sourceを示します。
2. package workflowの成功はnpm publish処理の完了を示します。
3. npm registryのversion、dist-tags、`gitHead` は利用者がinstallする内容を示します。
4. 公開manualのsource-commit meta tagはliveなdocument buildを示します。

version bumpのmergeだけでnpm公開済みとはせず、VitePress build成功だけでlive deployment済みとはしません。それぞれを独立に確認します。

## 最小コアのaudit境界

VibeProはローカル証跡を保存しますが、canonical audit bundleを生成せず、証跡が十分かも判定しません。保存期間、access control、review policy、CI要件、最終承認は利用側の責任です。

## 0.2.0-beta.6へのupgrade

これはbeta段階のbreaking cleanupです。廃止commandを呼ぶautomationは `vibepro help` にあるcommandへ移行してください。従来の広いworkflowを一時的に残す場合は `vibepro@0.2.0-beta.2` にpinします。
