# VibePro

[![Language: English](https://img.shields.io/badge/Language-English-blue)](README.md)
[![Language: Japanese](https://img.shields.io/badge/Language-%E6%97%A5%E6%9C%AC%E8%AA%9E-green)](README.ja.md)
[![Node.js >=20](https://img.shields.io/badge/Node.js-%3E%3D20-339933)](package.json)
[![License: Apache-2.0](https://img.shields.io/badge/License-Apache--2.0-blue)](LICENSE)

VibePro は、AI 駆動開発の PR を安全に進めるための CLI 制御基盤です。Feature Story から Architecture、Spec、Verification、Agent Review、PR Evidence を生成・整理し、必要な Gate が揃うまで PR 作成を止めます。

VibePro は対象アプリを自動で書き換えるツールではありません。対象リポジトリ内に `.vibepro/` 作業領域を作り、変更・レビュー・マージの前に必要な証跡を保存します。

## なぜ VibePro か

AI コーディングは速い一方で、最後の 20% に手間がかかります。要求の抜け、UI フローの未確認、API 契約破壊、曖昧なレビュー範囲、見た目は完成しているが実際には触れない PR が起きやすいからです。さらに、広いワークフロー変更が通常の Unit/API 変更のように見えてしまうリスクがあります。

VibePro はその最後の詰めを明示します。

- Story: どんなユーザー価値を満たすべきか。
- Architecture: どの境界・責務・依存方向を守るべきか。
- Spec: どの振る舞い・不変条件を満たすべきか。
- Responsibility Authority: 状態、worker、権限、課金、送信などの横断責務で、どの repo/domain contract が正本か。
- Code: 実際に何が変わったか。
- Gates: Unit、Integration、E2E、Performance、Security、Review の何が未解決か。
- Risk profile: 軽い変更か、API契約か、画面操作か、複数の導線をまたぐ重い変更か。
- PR Evidence: 人間と AI エージェントが作業前に読むべき共通文脈。

基本の流れは次の通りです。

```text
Story -> Architecture -> Spec -> Code -> Responsibility Authority -> Risk-Adaptive Gates -> PR Evidence -> VibePro PR Create
```

Story と Architecture が確定できれば、実装は AI エージェントへ渡しやすくなります。変更が workflow state、runtime contract、verification evidence、review orchestration にまたがる場合、VibePro は通常の軽いGateではなく重い Gate DAG へ自動で切り替えます。

## 主な機能

- Story / Architecture / Spec を踏まえた PR 準備
- 横断責務の Domain Contract を解決する Responsibility Authority Registry 検査
- 変更コードに対する Requirement Consistency 検査
- 完了条件と workflow-heavy release check を示す、リスクに応じた Gate DAG
- 大きい変更や危険な変更の PR 分割計画
- Unit / Integration / E2E / Build / Type-check の検証証跡記録
- Playwright による UI フロー検証とネットワークエラー検知
- Performance metric 定義、run 記録、before/after 比較
- UI、Security、Performance、Architecture、PR Readiness、Launch Readiness の診断パッケージ
- サブエージェントレビュー依頼とリスクに応じたレビュー結果の記録
- 未解決Gateとwaiver理由を記録する `vibepro pr create` 経路強制
- 既存情報構造を壊さずUIを改善する `design-modernize` planning と Derived Design System 生成
- Skills / Codex instructions の導入による AI 駆動開発ワークフロー標準化

## インストール

VibePro は Node.js 20 以上が必要です。

VibePro は現在 early beta OSS リリースです。安定版 1.0 公開前に CLI、report schema、diagnosis pack は変わる可能性があるため、明示的に `beta` dist-tag を指定してください。

global install せずに試す場合:

```bash
npx vibepro@beta --help
```

beta CLI を global install する場合:

```bash
npm install -g vibepro@beta
vibepro --help
```

VibePro本体を開発する場合は、source checkout を使います。

```bash
git clone https://github.com/Unson-LLC/vibepro.git
cd vibepro
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

PR前の確認が目的なら、見るべき入口は check report ではなく PR prepare の機械可読なreadiness summaryです。

```bash
vibepro pr prepare /path/to/repo \
  --story-id <story-id> \
  --base <base-branch>
```

見る順番:

1. `.vibepro/pr/<story-id>/pr-prepare.json`
2. `.vibepro/pr/<story-id>/decision-index.json`
3. `.vibepro/pr/<story-id>/evidence-plan.json`
4. `.vibepro/pr/<story-id>/pr-body.md`
5. 選択された evidence depth で生成された場合のみ `review-cockpit.html`、`gate-dag.html`、`split-plan.html`

`pr-body.md` はGitHubに載せる判断ブリーフです。PR単体で Story の解釈、発生経緯、根本原因、解決、レビュー観点、最終確認が読めることを優先します。監査ログの保管場所ではありません。Gate、Agent Review、split-plan、検証、PRライフサイクルの詳細証跡は `.vibepro/pr/<story-id>/` のartifactを正本にします。

`<base-branch>` はリポジトリごとに異なります。`origin/main`、`main`、`origin/develop`、`develop` など、そのリポジトリの既定 branch を指定してください。

`pr prepare` は Gate DAG を作る前に変更リスクを分類します。狭い docs / UI 変更は軽いGateに留まります。一方、複数surfaceにまたがる workflow 変更は `workflow_heavy` となり、workflow replay、production path coverage、release confidence、より広い Agent Review role が必要になります。横断責務では Requirement Gate の前に `responsibility-authority.json` / `docs/responsibility-authority/*.json` と `contracts/*.json` / `docs/contracts/*.json` を解決し、未登録なら `no_registered_authority`、証跡不足なら `gate:responsibility_authority` として出します。必須Gateが未解決の間、VibePro の `next_commands` は PR 作成ではなく review / verification / prepare の再実行を案内します。

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

final Specへ昇格する前にPre-Spec Readinessを記録します。

```bash
npx vibepro spec readiness /path/to/repo --id story-internal-beta --base <base-branch>
npx vibepro spec write /path/to/repo --id story-internal-beta --final --input spec.json
```

探索中の仮説Specは `spec write --draft` で保存します。draftは実装やPR Gateの正本にはなりません。

PR 証跡を生成します。

```bash
npx vibepro pr prepare /path/to/repo \
  --base <base-branch> \
  --story-id story-internal-beta
```

現在の git 状態で実際に走らせた検証証跡を記録します。

```bash
npx vibepro verify record /path/to/repo \
  --id story-internal-beta \
  --kind unit \
  --status pass \
  --command "npm test"
```

実装完了扱いにする前に checkpoint を通します。

```bash
npx vibepro checkpoint verification /path/to/repo \
  --base <base-branch> \
  --story-id story-internal-beta
```

必要な Agent Review を準備・記録し、Gate DAG が ready になるまで PR preparation を再実行します。

```bash
npx vibepro review prepare /path/to/repo --id story-internal-beta --stage gate
npx vibepro review status /path/to/repo --id story-internal-beta
npx vibepro pr prepare /path/to/repo --base <base-branch> --story-id story-internal-beta
```

`pr prepare` が ready を返した後、VibePro 経由で PR を作成します。

```bash
npx vibepro pr create /path/to/repo \
  --base <base-branch> \
  --head <feature-branch> \
  --story-id story-internal-beta
```

通常の PR 作成経路として直接 `gh pr create` は使わないでください。VibePro の Gate DAG と waiver audit を通らないためです。

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

- `pr-prepare.json`: AI エージェント向けのPR readiness正本。PR-ready扱いの前に `gate_status` を確認します。
- `decision-index.json`: Story、判断点、証跡参照、レビュー経路のcompact index。
- `evidence-plan.json`: evidence-depth policy、生成artifact、skipされたartifact、追加証跡要求。
- `verification-evidence.json`: 現在headに紐づく検証コマンドと外部CI取り込み証跡。
- `pr-body.md`: `判断`、`経緯`、`原因`、`解決`、`レビュー観点`、`確認`、`詳細` を載せるGitHub判断ブリーフ。
- `review-cockpit.html`: 選択された evidence depth で生成された場合の人間レビュー画面。
- `gate-dag.json` / `gate-dag.html`: 完了条件の依存関係。JSONが永続的な契約で、HTMLは任意の表示面です。
- `split-plan.json` / `split-plan.html`: PR 分割レーンと merge order。JSONが永続的な契約で、HTMLは任意の表示面です。
- `pr-create.json`: PR作成または既存PR refresh のライフサイクル証跡。
- `pr-merge.json`: `vibepro execute merge` が書く merge ライフサイクル証跡。

人間は短いPR本文と、生成されている場合はcockpitから読み始めます。AI エージェントには full JSON artifact ではなく、まず `vibepro pr prepare . --story-id <story-id> --summary-json` または `--view readiness|blocking-gates|gate-evidence|traceability|design-ssot|senior-gap` の限定viewを渡します。full JSON artifact は永続正本として保存し、必要な gate id / artifact path だけを対象に drill-down します。HTML artifact はレビュー面であり、正本ではありません。

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

### Architectureをfinalへ昇格する

正本として扱うArchitectureは、その前提になる証跡を集めた後で昇格します。draftはゲート前でも許可されますが、final Architectureは現在の `HEAD` に対してreadiness bundleがreadyになるまでブロックされます。

```bash
npx vibepro graph /path/to/repo --run-graphify
npx vibepro story diagnose /path/to/repo --id <story-id> --run-graphify
npx vibepro check architecture /path/to/repo --story-id <story-id> --base <base-branch>
npx vibepro architecture readiness /path/to/repo --id <story-id> --base <base-branch>
npx vibepro architecture write /path/to/repo --id <story-id> --draft < architecture.md
npx vibepro architecture write /path/to/repo --id <story-id> --final --output docs/architecture/<topic>.md < architecture.md
```

`architecture readiness` はStory、Graphify、Story diagnosis、Architecture check、Engineering Judgmentの証跡を `.vibepro/architecture/<story-id>/architecture-readiness.json` に記録します。`architecture write --final` はこのartifactが存在しない、blocked、または現在のgit `HEAD` に対してstaleな場合に失敗します。

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

workflow-heavy 変更では Unit/API 証跡だけでは不十分です。VibePro は current git に紐づいた Story E2E / Flow evidence、実行可能な assertion、Gate DAG が要求する risk-adaptive review role も確認します。

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

### Journey Handoff を作成する

`journey derive` は Story、Spec、Architecture、Graphify、Gate evidence から
機械的な Journey context pack を集めます。ただし、それ自体はプロダクト Journey
の正本ではありません。プロダクト loop の解釈が必要な場合は、UI/UX gate が
Journey を確定扱いする前に `journey handoff` で AI または人間に渡す材料を作ります。

```bash
npx vibepro journey handoff /path/to/repo --id <journey-id>
npx vibepro journey status /path/to/repo --json
```

handoff は `.vibepro/journey/latest-handoff.md` を生成し、候補step、衝突、
walking skeleton gap、未解決の問いを残します。curated Journey は
`.vibepro/journeys/<journey-id>.json` に保存できます。それが存在するまでは
`journey status` は `available` ではなく `needs_curated_journey` を返します。

### VibePro 経由で PR を作成する

```bash
npx vibepro spec readiness /path/to/repo --id <story-id> --base <base-branch>
npx vibepro pr prepare /path/to/repo --story-id <story-id> --base <base-branch>
npx vibepro pr create /path/to/repo --story-id <story-id> --base <base-branch> --head <feature-branch>
```

`pr create` は `pr prepare` が生成した PR 本文を使い、branch push と GitHub PR 作成を実行します。critical Gate が未解決の場合、PR作成前に失敗します。非critical Gate だけが未解決の場合は、`--allow-needs-verification` と `--verification-waiver <reason>` の両方が必要です。

PR作成後は、merge前にライフサイクル証跡を最新化します。

```bash
gh pr checks <pr-number> --watch
npx vibepro verify import-ci /path/to/repo --id <story-id> --pr <pr-number>
npx vibepro pr prepare /path/to/repo --story-id <story-id> --base <base-branch>
npx vibepro pr create /path/to/repo --story-id <story-id> --base <base-branch> --head <feature-branch>
npx vibepro execute merge /path/to/repo --story-id <story-id> --pr <pr-number> --strategy squash
```

2回目の `pr create` は、base/head が一致する既存open PRを検出した場合に重複PRを作らず、PR本文と `pr-create.json` を現在head向けにrefreshします。`execute merge` はVibeProのmerge境界であり、readinessを確認し、GitHub上でmergeし、`pr-merge.json` と `docs/management/audit-artifacts/<story-id>/` のcanonical audit artifactを残します。

### 既存UIをModernizeする

```bash
npx vibepro design-system derive /path/to/repo \
  --id <ds-id> \
  --product <name> \
  --routes /home,/map,/detail \
  --brief "日本語ホテル探索アプリ。地図探索とプロダクト固有CTAを重視する" \
  --from-code

npx vibepro design-system ingest-design-md /path/to/repo \
  --id <ds-id> \
  --file DESIGN.md

npx vibepro design-system lint /path/to/repo \
  --id <ds-id>

npx vibepro design-system diff /path/to/repo \
  --id <ds-id> \
  --base origin/main

npx vibepro design-system export /path/to/repo \
  --id <ds-id> \
  --format design-md

npx vibepro design-ssot init /path/to/repo \
  --id <root-id> \
  --root-doc docs/architecture/central-design.md \
  --required-child-kinds story,spec

npx vibepro design-ssot link /path/to/repo \
  --id <root-id> \
  --kind story \
  --path docs/management/stories/active/story-example.md

npx vibepro design-ssot reconcile /path/to/repo \
  --id <root-id> \
  --base origin/main

npx vibepro design-modernize derive-system /path/to/repo \
  --id <story-id> \
  --product <name> \
  --routes /home,/map,/detail \
  --brief "日本語ホテル探索アプリ。地図探索とプロダクト固有CTAを重視する"

npx vibepro design-modernize plan /path/to/repo \
  --id <story-id> \
  --product <name> \
  --routes /home,/map,/detail \
  --base-url http://127.0.0.1:3000
```

`derive-system` は product brief と現行UI証跡から、VibePro内の Derived Design System を作ります。product semantics、semantic color roles、component responsibilities、composition rules、visual-hypothesis policy、明示的なDS gateを生成し、画面候補を作る前に「そのプロダクトで許されるデザイン判断の空間」を固定します。

`design-modernize` は、既存のルート、情報構造、CTA、状態、データ依存を保ったまま実プロダクト画面を改善するための workflow です。Design System bundle や生成された visual hypothesis は参照材料であり、VibePro が作った派生デザインシステム、現行スクリーンショット、Graphify/Codex evidence、Gate DAG が実装判断の正本です。

`design-system ingest-design-md` は、DESIGN.mdのYAML tokensとMarkdown rationaleをVibePro-native DSへreference evidenceとして取り込みます。`.vibepro/design-system/<ds-id>/DESIGN.md` と `design-md.json` を保存し、token reference、prose intent、Do/Don't、contrast、diff evidenceのDS gateを追加します。DESIGN.mdは現行コード、Story、Spec、Architecture、VibePro gatesを上書きする実装正本ではありません。

`design-ssot` は visual design authority ではなく、設計ドキュメントの親子関係を扱う lineage layer です。正本 registry は `design-ssot.json` や `docs/design-ssot/*.json` のように repo に commit し、`.vibepro/design-ssot/` と `.vibepro/pr/<story-id>/design-ssot-reconciliation.json` は生成証跡として使います。`pr prepare` では `gate:path_surface_matrix` と `gate:responsibility_authority` の間に `gate:design_ssot_reconciliation` を出し、root-only変更、必須child欠落、frontmatter不足、stale root hash、accepted ADR supersession矛盾をPR前に見える化します。

主な成果物は `.vibepro/design-modernize/<story-id>/` 配下に出力されます。

- `design-system-derivation.json` / `.md`: product semantics と Derived Design System の要約
- `derived-design-system.json`: semantic token、component role map、CTA hierarchy、anti-pattern、visual hypothesis policy
- `design-modernize.json`: 画面別modernization plan と Design Quality DAG
- `ds-gate.json`: fallbackを禁止した明示的なDS drift / UX regression clause

外部Design Systemや画像生成案は visual hypothesis として扱います。実装前に、spec が現行route、情報構造、CTA優先度、状態、データ依存を保持していることを確認してください。PR作成前には `vibepro pr prepare` で Design / Requirement / Unit / Integration / Agent Review gate が現HEADに対して解消されている必要があります。

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
npx vibepro skills lint /path/to/repo
```

同梱 Skills:

- `vibepro-workflow`: Story / Architecture / Spec / Graphify / Gate の実行順。design-modernize と Agent Review flow も含む。
- `vibepro-codebase-memory`: 任意の `codebase-memory-mcp` impact context をVibeProで使い、topologyを正しさの証明として扱わないための手順。
- `vibepro-story-refactor`: Story、Architecture、Spec、Task、Code、Gate evidence を揃えながら進める refactor workflow。
- `vibepro-diagnosis-packages`: UI、security、performance、architecture、PR、launch readiness の目的別check。
- `vibepro-human-review`: PR readiness artifact、split plan、review cockpit、waiver 判断の読み方。
- `vibepro-meeting-minutes-editor`: トランスクリプト、Slack添付、見本から日本語のビジネス議事録を作る時に、入力欠落を隠さず、固定テンプレートへ押し込まないための編集基準。

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

VibePro は現在 early beta OSS リリースです。安定版 1.0 公開前に API、report schema、diagnosis pack は変わる可能性があります。

## License

VibePro は [Apache License 2.0](LICENSE) で公開されています。
