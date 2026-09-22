# リリース境界

VibeProでは4種類の証明を分けます。

1. `package.json` のversionはrelease sourceを示します。
2. package workflowの成功はworkflowが完了したことだけを示します。`release_required=false` の場合はpublish stepがskipされ、`npm=skipped (package version unchanged)` と記録されます。workflow成功だけではpublish実行を証明しません。
3. `release_required=true` のときのpublish stepの完了記録はpublish処理が実行されたことを示します。npm registryのversion、dist-tags、`gitHead` のreadbackはregistryへの反映を示します。
4. 公開manualのsource-commit meta tagはliveなdocument buildを示します。

version bumpのmergeやpackage workflowの成功だけでnpm公開済みとはせず、publish stepの実行記録とregistryのreadbackを独立に確認します。registryへの反映も、実際の利用者環境でのinstall、起動、下流処理や利用者成果までは証明しません。VitePress build成功だけでlive deployment済みとはしないのと同じく、必要な利用者側readbackを別に確認します。

## 最小コアのaudit境界

VibeProはローカル証跡を保存しますが、canonical audit bundleを生成せず、証跡が十分かも判定しません。保存期間、access control、review policy、CI要件、最終承認は利用側の責任です。

## 0.2.0-beta.29へのupgrade

これはbeta段階のbreaking cleanupです。廃止commandを呼ぶautomationは `vibepro help` にあるcommandへ移行してください。従来の広いworkflowを一時的に残す場合は `vibepro@0.2.0-beta.2` にpinします。
