# VibePro

[![Language: English](https://img.shields.io/badge/Language-English-blue)](README.md)
[![Language: Japanese](https://img.shields.io/badge/Language-%E6%97%A5%E6%9C%AC%E8%AA%9E-green)](README.ja.md)
[![Node.js >=20](https://img.shields.io/badge/Node.js-%3E%3D20-339933)](package.json)
[![License: Apache-2.0](https://img.shields.io/badge/License-Apache--2.0-blue)](LICENSE)

VibeProは、**人間が意図したプロダクト**と**AI支援開発が実際に作るもの**のズレを減らすためのシステムです。

AIコーディングエージェントは、技術的には正しいコードを書きながら、そもそも違う問題を解くことがあります。VibeProは、Story、Spec、実装証跡、検証、レビュー、判断、PR引き渡しまでの因果関係をリポジトリ内に明示し、人間とコーディングエージェントが同じプロダクト意図と証跡を確認できるようにします。

```text
Intent
  -> Story
    -> Spec
      -> Implementation
        -> Verification
          -> Review / Decision
            -> PR handoff
```

VibeProは、主としてAIエージェントのサンドボックスやツール権限制御を行う製品ではありません。Bash、Edit、deployなどをAIに使わせるかどうかは、実行能力の境界に属します。VibeProが扱うのは意図とトレーサビリティの境界です。危険な操作を制限されたAIでも、作るもの自体を間違えることはあります。VibeProは、そのズレを変更が受け入れられる前に見える状態にすることを目的とします。

現行の最小コアは意図的に小さく保っています。Story、Spec、検証結果、レビュー記録、判断、trace、PR要約を `.vibepro/` に保存します。一方で、アプリそのものを実装したり、プロダクトの意味を自律的に決めたり、変更の安全性を判定したり、コードをマージしたりはしません。従来の広範なGate DAG、managed execution、lifecycle会計、budget enforcement、自動audit bundleは最小コア再構築の際に削除しました。

プロダクト思想と現在のアーキテクチャ境界は [Product Intent Traceability](docs/architecture/product-intent-traceability.md) を参照してください。

## インストール

Node.js 20以上が必要です。現在はbeta channelで公開しています。

```bash
npx vibepro@beta --help
# または
npm install -g vibepro@beta
```

## 最小ワークフロー

```bash
# 1. 意図した変更をStoryとして登録
vibepro init /path/to/repo \
  --story-id story-example \
  --title "変更内容" \
  --language ja

# 2. コードベースを調査し、追跡可能なSpecを書く
vibepro story diagnose /path/to/repo --id story-example --run-graphify
vibepro spec write /path/to/repo --id story-example --draft --input spec.json

# 3. 検証証跡を実行または記録
vibepro verify run /path/to/repo --id story-example --kind unit -- npm test

# 4. レビュー証跡を準備・記録
vibepro review prepare /path/to/repo --id story-example --stage gate
vibepro review record /path/to/repo --id story-example --stage gate \
  --role implementation --status pass --summary "StoryとSpecに照らして確認済み"

# 5. 意図から実装までの証跡をPR向けに要約
vibepro pr prepare /path/to/repo --story-id story-example --base origin/main
```

`pr prepare` は `.vibepro/pr/<story-id>/` に機械可読な要約とPR本文を書きます。そこでは記録された内容と、実装がStory / Specへどう紐づいているかを要約しますが、自律的な安全性承認ではありません。`pr create` は選択したbranchをpushしてGitHub CLIを呼べますが、最終レビューとmerge権限はVibeProの外にあります。

バグ修正ではStoryを `--contract-type bug_fix` 付きで登録します。VibeProは再現から同経路再検証までの順序付き診断証拠を要求します。詳しくは[バグ診断への移行](docs/ja/guide/bug-diagnosis-migration.md)を参照してください。

base branchは `origin/main` に固定せず、対象リポジトリの実際の既定branchを指定してください。

## 現行コマンド群

- 初期化と健全性: `init`, `config language`, `doctor`, `status`
- エージェント設定: `skills`, `codex`, `harness`
- 文脈調査: `graph`, `env graph`, `diagnose`
- プロダクト意図とトレーサビリティ: `story`, `spec`, `trace`, `decision`
- 証跡: `verify`, `review`, `guard`
- PR引き渡し: `pr prepare`, `pr create`
- 旧NocoDBポートフォリオ連携: `brainbase`
- artifact保守: `artifacts`

`brainbase`コマンドは、過去のNocoDB Story／ポートフォリオ連携を互換維持するために残しています。現行BrainbaseのJudgment Resolver、Knowledge Resolver、Graph、Knowledge Event APIとStoryを接続するコマンドではありません。新しいBrainbase連携は、この旧コマンドを暗黙に拡張せず、明示的にversion化したadapter契約として実装します。

正確なコマンド一覧は `vibepro help --language ja` を正本としてください。1.0まではCLIと証跡schemaが変わる可能性があります。

## 任意のGraphify連携

Graphifyは任意で、VibeProには同梱しません。外部の `graphify` コマンドがあれば、`story diagnose --run-graphify` と `graph --run-graphify` で影響範囲の文脈を追加できます。Graphifyがなくても残りの最小ワークフローは使えます。

## ドキュメント

- マニュアル: https://vibepro.pages.dev/ja/
- English README: [README.md](README.md)
- プロダクト思想: [Product Intent Traceability](docs/architecture/product-intent-traceability.md)
- CLIリファレンス: https://vibepro.pages.dev/ja/reference/cli
- リリースノート: https://vibepro.pages.dev/ja/releases/

## 開発

```bash
npm install
npm run typecheck
npm test
npm run test:e2e:ts
npm run pack:dry-run
npm run docs:build
```

VibeProはApache-2.0で公開しています。

<!-- BRAINBASE_RUNTIME_HANDOFF_START -->
## Brainbase runtime handoff

`vibepro brainbase`は旧NocoDB Story/portfolio adapterのまま残します。現在のBrainbase連携は別namespaceを使い、VibeProからJudgmentを再計算しません。

```bash
vibepro integration brainbase bind . --id <story-id> --input <handoff.json>
# 実装し、同じgit状態へcomputed verificationを記録
vibepro integration brainbase event . --id <story-id> --summary "<検証済みの再利用可能な学習>"
```

`bind`はBrainbase Hostが確定したmanaged Judgment receipt、対応する`knowledge.resolve` routing receipt、実取得したcanonical参照を検証します。`.vibepro/integrations/`へ保存するのはpointerとcontent digestだけで、本文やPersonal Knowledgeは複製しません。

`event`はcontext束縛後に実行され、current git fingerprintと一致するcomputed passing verificationがなければ失敗します。生成するのはGraph昇格とexternal actionを禁止したlocal `knowledge_event.v1`候補です。Brainbaseへの記録は`brainbase_knowledge_event_record` MCP toolへ委譲し、global Hostの監査を通します。
<!-- BRAINBASE_RUNTIME_HANDOFF_END -->
