# Story / Spec / 追跡性

StoryとSpecは意図の層です。なぜ変更するのか、何が満たされるべきかを説明します。

```bash
vibepro story list .
vibepro story derive . --json
vibepro story diagnose . --id <story-id>
```

追跡性は、StoryとSpecの条項、変更ファイル、検証結果、PRの要約をつなぎます。影響範囲の分析は関連コードを示せますが、プロダクトの意図は決められません。Specの下書きと参照の確認は、[ひとつの変更からPR準備まで](/ja/guide/control-loop)を参照してください。
