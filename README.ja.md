# VibePro

[![Language: English](https://img.shields.io/badge/Language-English-blue)](README.md)
[![Language: Japanese](https://img.shields.io/badge/Language-%E6%97%A5%E6%9C%AC%E8%AA%9E-green)](README.ja.md)
[![Node.js >=20](https://img.shields.io/badge/Node.js-%3E%3D20-339933)](package.json)
[![License: Apache-2.0](https://img.shields.io/badge/License-Apache--2.0-blue)](LICENSE)

VibePro は、AI 駆動開発のための CLI 制御基盤です。Feature Story から Architecture、Spec、Task、Verification、PR Evidence を生成・整理し、人間が安心して AI エージェントへ実装を任せられる状態を作ります。

VibePro は対象アプリを自動で書き換えるツールではありません。対象リポジトリ内に `.vibepro/` 作業領域を作り、変更・レビュー・マージの前に必要な証跡を保存します。

## なぜ VibePro か

AI コーディングは速い一方で、最後の 20% に手間がかかります。要求の抜け、UI フローの未確認、API 契約破壊、曖昧なレビュー範囲、見た目は完成しているが実際には触れない PR が起きやすいからです。

VibePro はその最後の詰めを明示します。

- Story: どんなユーザー価値を満たすべきか。
- Architecture: どの境界・責務・依存方向を守るべきか。
- Spec: どの振る舞い・不変条件を満たすべきか。
- Code: 実際に何が変わったか。
- Gates: Unit、Integration、E2E、Performance、Security、Review の何が未解決か。
- PR Evidence: 人間と AI エージェントが作業前に読むべき共通文脈。

基本の流れは次の通りです。

```text
Story -> Architecture -> Spec -> Code -> Gate -> PR Evidence
```

Story と Architecture が確定できれば、実装は AI エージェントへ渡しやすくなります。

## 主な機能

- Story / Architecture / Spec を踏まえた PR 準備
- 変更コードに対する Requirement Consistency 検査
- 完了条件の依存関係を示す Gate DAG
- 大きい変更や危険な変更の PR 分割計画
- Unit / Integration / E2E / Build / Type-check の検証証跡記録
- Playwright による UI フロー検証とネットワークエラー検知
- Performance metric 定義、run 記録、before/after 比較
- UI、Security、Performance、Architecture、PR Readiness、Launch Readiness の診断パッケージ
- サブエージェントレビュー依頼とレビュー結果の記録
- Skills / Codex instructions の導入による AI 駆動開発ワークフロー標準化

## インストール

VibePro は Node.js 20 以上が必要です。

VibePro は現在 alpha OSS 公開候補です。まだ public npm registry に存在しない場合、`npm install -D vibepro` や `pnpm add -D vibepro` を実行しても npm からは解決できません。

利用方法は次のどれかです。

```bash
# このリポジトリをcloneしてローカルから使う
cd /path/to/vibepro
npm install
node bin/vibepro.js --help

# npm公開前にGitHubからinstallする
npm install -g git+https://github.com/Unson-LLC/vibepro.git
vibepro --help
```

npm公開後は次の形で使えます。

```bash
npx vibepro --help
```

VibePro本体を開発する場合:

```bash
npm install
node bin/vibepro.js --help
```

## 任意連携: Graphify

Graphify は任意ですが、影響範囲調査の精度を上げるため推奨です。VibePro は Graphify 本体や Graphify のコードを同梱しません。`--run-graphify` を使う場合は、外部インストール済みの `graphify` コマンドを呼びます。`--from graphify-out` を使う場合は、Graphify が生成済みの成果物を取り込みます。

```bash
uv tool install graphifyy
```

Graphify のインストールと利用は Graphify 側のライセンスに従ってください。Graphify がなくても、多くの Story / Diagnosis / Checkpoint / PR Gate ワークフローは利用できます。ただし、変更ファイルの隣接調査は弱くなります。

以下の例では `vibepro` コマンドを使います。global install していない場合は、`vibepro` を `node /path/to/vibepro/bin/vibepro.js` に置き換えてください。

## 初回: 目的別にこれだけ実行

まずリポジトリ全体を診断したいだけなら、既存の Story ID は不要です。

```bash
vibepro check all /path/to/repo --base <base-branch>
```

終わったら次を共有してください。

- `.vibepro/checks/all/<run-id>/check.md`
- 先頭の `Status`
- `needs_review` / `fail` になっている項目

特定の機能や不具合に紐づけて診断する場合は、まずローカル Story を作ります。

```bash
vibepro init /path/to/repo \
  --story-id story-<short-name> \
  --title "<機能名または不具合名>" \
  --language ja

vibepro check all /path/to/repo \
  --story-id story-<short-name> \
  --base <base-branch>
```

すでに VibePro Story があるリポジトリでは、先に一覧や map を確認します。

```bash
vibepro story list /path/to/repo
vibepro story map /path/to/repo
```

PR前の確認が目的なら、見るべき入口は check report ではなく PR prepare の成果物です。

```bash
vibepro pr prepare /path/to/repo \
  --story-id <story-id> \
  --base <base-branch>
```

見る順番:

1. `.vibepro/pr/<story-id>/review-cockpit.html`
2. `.vibepro/pr/<story-id>/gate-dag.html`
3. `.vibepro/pr/<story-id>/split-plan.html`
4. `.vibepro/pr/<story-id>/pr-body.md`

`<base-branch>` はリポジトリごとに異なります。`origin/main`、`main`、`origin/develop`、`develop` など、そのリポジトリの既定 branch を指定してください。

## Quick Start

対象リポジトリを初期化します。

```bash
npx vibepro init /path/to/repo \
  --story-id story-internal-beta \
  --title "社内β診断" \
  --view dev \
  --period 2026-W18 \
  --language ja
```

Story 診断を実行します。

```bash
npx vibepro story diagnose /path/to/repo --id story-internal-beta --run-graphify
```

PR 証跡を生成します。

```bash
npx vibepro pr prepare /path/to/repo \
  --base <base-branch> \
  --story-id story-internal-beta
```

実装完了扱いにする前に checkpoint を通します。

```bash
npx vibepro checkpoint verification /path/to/repo \
  --base <base-branch> \
  --story-id story-internal-beta
```

`<base-branch>` はリポジトリごとに異なります。`origin/main`、`main`、`origin/develop`、`develop` など、そのリポジトリの既定 branch を指定してください。VibePro は `init` や `pr prepare` の出力で候補 branch も表示します。

## VibePro が作るもの

VibePro は対象リポジトリの `.vibepro/` に作業領域を作ります。

```text
.vibepro/
  config.json
  vibepro-manifest.json
  diagnostics/
  graphify/
  pr/
  qa/
  raw/
  stories/
```

PR 前に見る主な成果物:

- `pr-body.md`: Story、リスク、Gate、検証文脈を含む PR 本文ドラフト。
- `review-cockpit.html`: 人間が見るレビュー画面。
- `gate-dag.html`: 完了条件の依存関係。
- `split-plan.html`: PR 分割レーンと merge order。
- `pr-prepare.json`: AI エージェント向けの機械可読な正本。

人間は Markdown / HTML を読みます。AI エージェントには `pr-body.md`、`review-cockpit.html`、`gate-dag.html`、`split-plan.html`、関連 JSON を渡すのが基本です。

## よく使うワークフロー

### リポジトリを診断する

```bash
npx vibepro check all /path/to/repo --story-id <story-id> --base <base-branch>
```

診断パッケージを絞る場合:

```bash
npx vibepro check ui /path/to/repo --story-id <story-id>
npx vibepro check security /path/to/repo --story-id <story-id>
npx vibepro check oss-readiness /path/to/repo --story-id <story-id>
npx vibepro check performance /path/to/repo --story-id <story-id>
npx vibepro check architecture /path/to/repo --story-id <story-id>
npx vibepro check pr-readiness /path/to/repo --story-id <story-id> --base <base-branch>
```

### UI フローを検証する

```bash
npx vibepro verify flow /path/to/repo \
  --base-url http://127.0.0.1:3000 \
  --id <story-id>
```

VibePro は Playwright 証跡を記録し、API `4xx` / `5xx`、console error、unhandled rejection、既知の画面エラー文言を Gate finding として扱います。

### 検証証跡を記録する

```bash
npx vibepro verify record /path/to/repo \
  --id <story-id> \
  --kind unit \
  --status pass \
  --command "npm test"
```

記録した証跡は `pr prepare` と PR Gate で再利用されます。

### Agent Review を準備する

```bash
npx vibepro review prepare /path/to/repo --id <story-id> --stage implementation
```

レビュー結果を記録します。

```bash
npx vibepro review record /path/to/repo \
  --id <story-id> \
  --stage implementation \
  --role regression_risk \
  --status pass \
  --summary "変更フローに回帰リスクは見つからなかった。" \
  --agent-system codex \
  --execution-mode parallel_subagent \
  --agent-id <spawned-subagent-id> \
  --agent-thread-id <thread-id> \
  --agent-model <model> \
  --agent-closed
```

`gate:agent_review` は、required review に Codex/Claude Code の並列サブエージェント
証跡と close 済み lifecycle 証跡がある場合だけ検証済みレビューとして扱います。
各レビュー結果を受け取ったら、記録前にレビューに使ったサブエージェントを close/shutdown し、
`--agent-closed` を渡して記録してください。Claude Code の場合は `--agent-system claude_code`
と Task/subagent id、session id、または transcript artifact を渡してください。
人間レビューは監査用の文脈として記録できますが、required subagent review の代替にはなりません。

```bash
npx vibepro review record /path/to/repo \
  --id <story-id> \
  --stage implementation \
  --role regression_risk \
  --status pass \
  --summary "手動レビューで問題は見つからなかった。" \
  --agent-system human \
  --execution-mode manual_review \
  --recorded-by <reviewer>
```

手動レビュー証跡は監査文脈としては有用ですが、required Agent Review Gate は通しません。
実行環境がサブエージェントを起動できない場合、coordinator は gate を通した扱いにせず、
block するか別の waiver decision として記録します。

### Performance を測る

Story ごとの metric を定義します。

```bash
npx vibepro performance define /path/to/repo \
  --id <story-id> \
  --metric-id session-switch.user-terminal-ready \
  --user-story "ユーザーがsessionを切り替え、terminalに入力できる" \
  --start-condition "session row click" \
  --completion-condition "owner and inputReady=true" \
  --evidence-source browser_e2e \
  --readiness-kind user_perceived
```

before / after の run を記録します。

```bash
npx vibepro performance record /path/to/repo \
  --id <story-id> \
  --metric-id session-switch.user-terminal-ready \
  --label before \
  --status completed \
  --duration-ms 2400

npx vibepro performance compare /path/to/repo --id <story-id>
```

VibePro は同じ `metricId` と互換性のある completion condition の run だけを比較します。比較できない場合は、その理由を表示します。

## AI Agent Setup

Claude / Claude Code 向けの同梱 Skills を対象リポジトリへ導入します。

```bash
npx vibepro skills list
npx vibepro skills install /path/to/repo
npx vibepro skills verify /path/to/repo
```

Codex 向け instructions を導入します。

```bash
npx vibepro codex install /path/to/repo
npx vibepro codex verify /path/to/repo
```

目的は、agent が Story を読み、証跡を作り、レビューを実行し、PR Gate を守る流れを標準化することです。

## 出力言語

VibePro は人間が読む CLI 出力とレポートで日本語・英語を切り替えられます。

```bash
npx vibepro init /path/to/repo --language ja
npx vibepro config language /path/to/repo --language en
npx vibepro pr prepare /path/to/repo --language en --base <base-branch>
```

機械可読 JSON のキーは安定性のため英語系のまま維持します。

## ドキュメント

- [English README](README.md)
- [Changelog](CHANGELOG.md)
- [Contributing guide](CONTRIBUTING.md)
- [Security policy](SECURITY.md)
- [OSS readiness architecture](https://github.com/Unson-LLC/vibepro/blob/main/docs/architecture/vibepro-oss-apache2-readiness.md)
- [OSS readiness spec](https://github.com/Unson-LLC/vibepro/blob/main/docs/specs/vibepro-oss-apache2-readiness.md)

## プロジェクト状態

VibePro は現在 alpha OSS 公開候補です。安定版公開前に API、report schema、diagnosis pack は変わる可能性があります。

## License

VibePro は [Apache License 2.0](LICENSE) で公開されています。
