# ひとつの変更からPR準備まで

[リポジトリの初期化](/ja/guide/getting-started)後の手順です。`story-example` と `/path/to/repo` は実際の値に置き換えてください。自動承認の工程ではなく、人がレビューする材料を揃える流れです。

## 1. Story

`init` はStoryのIDを登録しますが、Story本文は生成しません。標準設定では、対象リポジトリ内の `docs/management/stories/active/story-example.md` を作り、要求と受け入れ条件を書きます。

```markdown
# 絞り込み条件を反映したCSV出力

利用者は、絞り込み後に画面で見ている行をそのままCSVに出力したい。

## Acceptance Criteria
- CSVには、選択した絞り込み条件に合う行だけを出力する。
```

Storyの保存先を変更している場合は、その設定先を使ってください。本文を用意したら診断します。

```bash
vibepro story diagnose /path/to/repo --id story-example
```

Storyには、利用者が実現したいことと受け入れ条件を書きます。たとえば「CSVには、選択した絞り込み条件に合う行だけを出力する」です。診断は内容を見直す材料であり、正しさの保証ではありません。Graphify連携を使う場合だけ `--run-graphify` を追加します。

## 2. Spec

```bash
vibepro spec write /path/to/repo --id story-example --draft --input /path/to/spec.json
```

Specには期待する振る舞いと参照先を書きます。上のコマンドを実行する前にJSONファイルを用意し、`/path/to/spec.json` をその絶対パスに置き換えます。相対パスは対象リポジトリではなく、コマンドを実行した場所から解決されます。以下はStoryの最初の受け入れ条件を参照する例です。ID・文言・参照先を、実際の変更に合わせてください。

```json
{
  "schema_version": "0.1.0",
  "story_id": "story-example",
  "clauses": [{
    "id": "INV-EXAMPLE-1",
    "type": "invariant",
    "statement": "CSVには、選択した絞り込み条件に合う行だけを出力する。",
    "origin": {
      "story_refs": [{ "kind": "acceptance_criteria", "index": 0 }]
    }
  }]
}
```

これは最初の下書きであり、実装済み・テスト済みの証拠ではありません。実装を進めながら、実際のコードとテストへの参照も追加します。`--draft` は下書きとして保存する指定であり、Specの確定ではありません。

確定は別の手順です。現行の `spec readiness` にはStory登録、Graphifyのノード・エッジ、Story診断、現在のHEADに一致するreadinessが必要です。`vibepro spec readiness /path/to/repo --id story-example --base origin/main` の結果を確認し、条件を満たしてから `spec write --final` を使います。この下書き中心の手順ではGraphifyは任意ですが、現行の確定時検査では必要です。

**SpecをPRのサマリーに含めるには、確定が必要です。** `pr prepare` が読むのは確定済みの `spec.json` だけです。下書きだけでは `no accepted spec found` と表示されます。Graphifyの情報を用意してStoryを診断した後、次を実行します。

```bash
vibepro spec readiness /path/to/repo --id story-example --base origin/main
vibepro spec write /path/to/repo --id story-example --final --input /path/to/spec.json
vibepro spec show /path/to/repo --id story-example
```

readinessで前提の不足が示された場合は、確定へ進まず解消してください。準備方法は[Graphifyによる影響範囲の確認](/ja/guide/graphify-impact)を参照してください。

下書きを保存したら、対象リポジトリ内の `.vibepro/spec/story-example/draft.json` を開いて読み返します。`spec show` が読むのは確定済みの `spec.json` であり、下書きではありません。確定後に使ってください。

参照検査で確認できるのは、宣言したファイルや対応するアンカーの存在です。実装が要求を満たすかは別に確認します。普段のエディターやコーディングエージェントで実装し、参照先も更新してください。

## 3. 検証

```bash
vibepro verify run /path/to/repo --id story-example --kind unit -- npm test
```

`npm test` は、その変更に適したテストコマンドに置き換えてください。`verify run` は指定コマンドを実行し、結果を記録します。成功しただけで受け入れ条件のすべてを確認したことにはなりません。テストが何を確かめているかも確認します。外部で得た結果には `verify record` を使え、記録の出所を区別できます。

## 4. レビューと判断

レビュー用の文脈を用意し、Story・Spec・変更コード・テスト結果を実際に確認します。以下の `pass` は、レビューで問題が見つからなかった場合だけ使う例です。要約と参照先は、実際に確認した内容へ置き換えてください。問題があれば `needs_changes` または `block` として記録します。

```bash
vibepro review prepare /path/to/repo --id story-example --role reviewer
vibepro review record /path/to/repo --id story-example --role reviewer \
  --status pass --summary "StoryとSpec、変更対象を確認済み" \
  --inspection-input src/example.js
vibepro review status /path/to/repo --id story-example
vibepro decision status /path/to/repo --id story-example
```

これらのコマンドで軽量なレビュー記録を保存します。選択理由を明示する必要があれば判断記録も使いますが、すべての変更で別の判断を作り出す必要はありません。

## 5. PRへの引き渡し

```bash
vibepro pr prepare /path/to/repo --story-id story-example --base origin/main
```

`.vibepro/pr/story-example/pr-prepare.json` と同じ場所の `pr-body.md` を確認します。変更の目的、実施した確認、未確認の点が伝わるかを読み返してから、普段のPR運用で使ってください。このコマンドはStory本文・Spec・検証・レビューがすべて揃わなくても出力できるため、出力されたことを作業の完了と取り違えないでください。具体的な問題を示す `needs_changes`・`block` のレビューがあれば、引き渡しが止まる場合があります。準備ができたことは、承認済み・マージ可能という意味ではありません。`pr create` は任意のGitHub CLI連携であり、安全性を認定するものではありません。
