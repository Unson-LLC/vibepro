# VibePro

[![Language: English](https://img.shields.io/badge/Language-English-blue)](README.md)
[![Language: Japanese](https://img.shields.io/badge/Language-%E6%97%A5%E6%9C%AC%E8%AA%9E-green)](README.ja.md)
[![Node.js >=20](https://img.shields.io/badge/Node.js-%3E%3D20-339933)](package.json)

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

```bash
npm install
node bin/vibepro.js --help
```

パッケージとして使う場合:

```bash
npx vibepro --help
```

Graphify は任意ですが、影響範囲調査の精度を上げるため推奨です。

```bash
uv tool install graphifyy
```

Graphify がなくても、多くの Story / Diagnosis / PR Gate ワークフローは利用できます。ただし、変更ファイルの隣接調査は弱くなります。

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
  --summary "変更フローに回帰リスクは見つからなかった。"
```

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
- [社内βリリースノート](docs/releases/internal-beta-2026-05-05.md)
- [Operating philosophy](docs/frames/vibepro-operating-philosophy.md)
- [Repo-local control plane frame](docs/frames/vibepro-repo-local-control-plane-frame.md)

## プロジェクト状態

VibePro は現在 internal beta です。安定版公開前に API、report schema、diagnosis pack は変わる可能性があります。

## License

現在 license file は含まれていません。OSS として配布する前に license を追加してください。
