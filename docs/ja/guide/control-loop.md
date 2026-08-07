# 最小コアの流れ

VibeProは5つの明示的な段階で文脈を残します。これらを自動のpass/fail gateには変換しません。

## 1. Story

```bash
vibepro story diagnose /path/to/repo --id story-example --run-graphify
```

Storyには、意図するユーザー価値または運用成果を書きます。Graphifyは任意です。

## 2. Spec

```bash
vibepro spec readiness /path/to/repo --id story-example --base origin/main
vibepro spec write /path/to/repo --id story-example --draft --input spec.json
```

Specはacceptance clauseとcode/test参照を持てます。draftとfinalは明示的に区別します。

## 3. 検証

```bash
vibepro verify run /path/to/repo --id story-example --kind unit -- npm test
```

`verify run` はargv commandを実行して結果を記録します。外部で生成した証跡には `verify record` を使え、証跡の出所は区別されます。

## 4. レビューと判断

```bash
vibepro review prepare /path/to/repo --id story-example --stage gate
vibepro review record /path/to/repo --id story-example --stage gate \
  --role implementation --status pass --summary "確認済み"
vibepro decision status /path/to/repo --id story-example
```

これらのcommandはレビューと判断の記録を残します。merge権限を与えるものではありません。

## 5. PRへの引き渡し

```bash
vibepro pr prepare /path/to/repo --story-id story-example --base origin/main
```

`.vibepro/pr/story-example/pr-prepare.json` と生成されたPR本文を確認します。次に何が必要かは、人間とリポジトリpolicyが判断します。`pr create` は任意のGitHub CLI引き渡しであり、安全gateではありません。
