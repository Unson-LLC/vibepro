# VibePro

[![Language: English](https://img.shields.io/badge/Language-English-blue)](README.md)
[![Language: Japanese](https://img.shields.io/badge/Language-%E6%97%A5%E6%9C%AC%E8%AA%9E-green)](README.ja.md)
[![Node.js >=20](https://img.shields.io/badge/Node.js-%3E%3D20-339933)](package.json)
[![License: Apache-2.0](https://img.shields.io/badge/License-Apache--2.0-blue)](LICENSE)

VibeProは、AI支援開発の文脈を追跡可能に保つ、小さなリポジトリローカルCLIです。Story、Spec、検証結果、レビュー記録、判断、PR要約を `.vibepro/` に保存し、人間とコーディングエージェントが同じ証跡を確認できるようにします。

VibeProはアプリを実装せず、変更の安全性を判定せず、PR作成をブロックせず、コードをマージしません。最小コアへの再構築により、従来のGate DAG、readiness/blocking判定、managed execution、lifecycle会計、budget enforcement、自動audit bundleは廃止しました。

## インストール

Node.js 20以上が必要です。現在はbeta channelで公開しています。

```bash
npx vibepro@beta --help
# または
npm install -g vibepro@beta
```

## 最小ワークフロー

```bash
# 1. リポジトリローカルの文脈を初期化
vibepro init /path/to/repo \
  --story-id story-example \
  --title "変更内容" \
  --language ja

# 2. 調査し、追跡可能なSpecを書く
vibepro story diagnose /path/to/repo --id story-example --run-graphify
vibepro spec write /path/to/repo --id story-example --draft --input spec.json

# 3. 検証を実行または記録
vibepro verify run /path/to/repo --id story-example --kind unit -- npm test

# 4. レビュー証跡を準備・記録
vibepro review prepare /path/to/repo --id story-example --stage gate
vibepro review record /path/to/repo --id story-example --stage gate \
  --role implementation --status pass --summary "確認済み"

# 5. PR向けに証跡を要約
vibepro pr prepare /path/to/repo --story-id story-example --base origin/main
```

`pr prepare` は `.vibepro/pr/<story-id>/` に機械可読な要約とPR本文を書きます。これは記録内容の要約であり、安全性の承認ではありません。`pr create` は選択したbranchをpushしてGitHub CLIを呼べますが、最終レビューとmerge権限はVibeProの外にあります。

base branchは `origin/main` に固定せず、対象リポジトリの実際の既定branchを指定してください。

## 現行コマンド群

- 初期化と健全性: `init`, `config language`, `doctor`, `status`
- エージェント設定: `skills`, `codex`, `harness`
- 文脈調査: `graph`, `env graph`, `diagnose`
- プロダクト意図: `story`, `spec`, `trace`
- 証跡: `verify`, `review`, `decision`, `guard`
- PR引き渡し: `pr prepare`, `pr create`
- 連携とartifact保守: `brainbase`, `artifacts`

正確なコマンド一覧は `vibepro help --language ja` を正本としてください。1.0まではCLIと証跡schemaが変わる可能性があります。

## 任意のGraphify連携

Graphifyは任意で、VibeProには同梱しません。外部の `graphify` コマンドがあれば、`story diagnose --run-graphify` と `graph --run-graphify` で影響範囲の文脈を追加できます。Graphifyがなくても残りの最小ワークフローは使えます。

## ドキュメント

- マニュアル: https://vibepro.pages.dev/ja/
- English README: [README.md](README.md)
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
