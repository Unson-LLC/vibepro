# AI PRの進め方

AIエージェントが作業している間も、変更の理由が見えるようにVibeProを使います。VibeProが用意するのは通常のGit運用でレビューする材料であり、承認やマージではありません。

## 基本の流れ

最初に、[ひとつの変更からPR準備まで](/ja/guide/control-loop)に沿って初期化とStory本文の作成を行います。以下は流れの概要であり、入力の作成や実際のレビューを省いて一括実行するスクリプトではありません。

```bash
vibepro story list /path/to/repo
vibepro story diagnose /path/to/repo --id story-example
vibepro spec write /path/to/repo --id story-example --draft --input /path/to/spec.json
vibepro verify run /path/to/repo --id story-example --kind unit -- npm test
vibepro review prepare /path/to/repo --id story-example --role reviewer
vibepro pr prepare /path/to/repo --story-id story-example --base main --json
```

この例の下書きSpecは `pr prepare` の要約には入りません。含めるにはGraphify・Story診断・readinessの条件を満たし、`spec write --final` で確定する必要があります。[詳しい手順](/ja/guide/control-loop)を参照してください。また、`review prepare` はレビューを実施するコマンドではありません。変更を確認し、実際の結果を記録します。

この流れで、次の境界を明確にします。

- **Story**: 変更の理由と、実現したい結果。
- **Spec**: 検証可能な振る舞いと、Story・関連ファイルへの参照。
- **検証**: 実際に実行したコマンド、または `verify record` で記録した外部結果。
- **レビュー**: 確認した対象、要約、問題点。
- **PR準備**: `.vibepro/pr/<story-id>/` に作る機械可読の要約とPR本文。

`pr prepare` は証跡が一部でも要約できます。成功しても、作業の完了・実装の正しさ・マージの安全性・承認を意味しません。参照検査が確認するのは宣言したファイルや対応アンカーの存在であり、実装が振る舞いを満たすことではありません。Graphifyやコード構造の文脈は調査範囲を絞る補助情報であり、正しさの証明ではありません。

`pr-prepare.json` と `pr-body.md` を読み返した後は、通常のGitHub運用で差分を確認し、ブランチをpushしてPRを作成・更新します。権限を持つ人がレビューとマージを行います。`vibepro pr create` は任意のGitHub CLI連携であり、VibeProがマージ権限を持つわけではありません。

現在の手順は[制御ループ](/ja/guide/control-loop)、機能の境界は[機能マップ](/ja/guide/feature-map)を参照してください。
