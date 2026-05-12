# VibePro 社内βリリース 2026-05-05

## Release Decision

VibePro は 2026-05-05 時点で社内βとして共有する。

位置づけは、実装修正ツールではなく Story / Architecture / Spec / Graphify / Gate 証跡を揃える制御基盤。検出結果は候補であり、自動承認や自動修正の根拠にはしない。

## Distribution

当面は npm public publish ではなく、GitHub tag からの社内利用にする。

推奨インストール:

```bash
npm install -g git+ssh://git@github.com/Unson-LLC/vibepro.git#v0.1.0-internal-beta.1
vibepro --help
```

開発者がローカルで試す場合:

```bash
git clone git@github.com:Unson-LLC/vibepro.git
cd vibepro
git checkout v0.1.0-internal-beta.1
npm install
npm link
vibepro --help
```

## Shared Materials

- Drive: `雲孫ドライブ/unson/brainbase/社内共有資料/VibePro_社内活用ガイド_2026-05-05.pdf`
- README: `README.md`
- Help: `vibepro --help`

## Feedback

フィードバック口は Slack `#0230-vibepro` に固定する。

広めの告知は `#9980-tech-lab` に投稿し、フィードバックは `#0230-vibepro` の固定スレッドへ誘導する。

フィードバックは次の形式で受ける。

```text
【repo】
対象リポジトリ名 / branch

【実行コマンド】
例: vibepro story diagnose . --id <story-id> --run-graphify
例: vibepro pr prepare . --base origin/develop --story-id <story-id>

【見た成果物】
pr-body.md / review-cockpit.html / architecture-review.json / human-review.json / gate-dag.html / split-plan.html / pr-prepare.json など

【期待したこと】

【実際に起きたこと】

【分類】
concept / command / false_positive / detector_gap / requirement_consistency / graphify_scope / gate_dag / split_plan / e2e_gate / docs
```

## Rollout Scope

最初の対象は3リポジトリまでに絞る。

1. Aitle
   - 既に実リファクタと `pr prepare` まで検証済み。
   - 社内βの実例として扱う。
2. Brainbase
   - VibeProの思想に近く、Story / Architecture / Spec の整合性確認に向く。
3. SalesTailor
   - 別ドメインでの汎化確認に使う。

## First Trial Flow

対象repoごとに、まず修正ではなく証跡生成だけを行う。

```bash
vibepro --help
vibepro init . --story-id story-vibepro-internal-beta --title "VibePro社内β診断" --view dev --period 2026-W19
vibepro story diagnose . --id story-vibepro-internal-beta --run-graphify
vibepro story derive . --run-graphify
vibepro story map .
vibepro story plan .
vibepro task create . --from-plan --id story-vibepro-internal-beta --limit 5
vibepro pr prepare . --base origin/develop --story-id story-vibepro-internal-beta
```

既にStoryがあるrepoでは、既存Storyを使う。

```bash
vibepro graph . --run-graphify
vibepro pr prepare . --base origin/develop --story-id <story-id>
```

## Review Checklist

初回利用者は次だけ見ればよい。

- `review-cockpit.html`: PR準備結果、Gate、Split、次コマンドの入口として見る
- `architecture-review.json`: Storyから出たArchitecture判断を人間が承認できる状態か確認する。ここが未承認ならAI実装完了扱いにしない
- `human-review.json`: proceed / split_pr / add_evidence / waive_with_reason / block の判断記録を残す。Architecture承認、Completion Quality、`.vibepro/qa/*` のVisual QA残差も確認する
- `pr-body.md`: 背景、要求、要件整合性、レビュー観点、Completion Qualityが伝わるか
- `gate-dag.html`: 未解決Gateが何か分かるか。Story / Architecture / Spec が未確定なら必須Gateとして止まり、Visual QA Gateが出ている場合は5%しきい値を超える残差がないか確認する
- `split-plan.html`: PRを分けるべき単位とGraphify調査範囲が分かるか

実装者は次を見る。

- `tasks.md`: リファクタ候補がStoryに紐づいているか
- `finding-review.md`: 誤検知、検出漏れ、実装修正候補を分けられるか

運用者は次を見る。

- `evidence.json`
- `pr-prepare.json`
- `gate-dag.json`
- `split-plan.json`

## Success Criteria

社内βは、次を満たしたら成功扱いにする。

- 3 repo 以内で初回導入が完了する
- 2 repo 以上で `pr prepare` 成果物が生成される
- 1件以上、Requirement Consistency / split-plan / Graphify調査範囲がレビュー判断に使われる
- Slack `#0230-vibepro` に3件以上の具体フィードバックが集まる
- README と `vibepro --help` だけで初回利用者が最初の診断まで進める

## Non Goals

- VibeProが対象repoを自動修正すること
- 検出結果を自動でtrue positive扱いすること
- E2E未実行のPRを完了扱いにすること
- npm public publish

## Slack Announcement Draft

`#9980-tech-lab` 向け:

```text
VibeProを社内βとして共有します。

VibeProは、AIにコードを直させるツールではなく、Story / Architecture / Spec / Graphify / Gate証跡を揃えて、AIリファクタリングやPRレビューを安全に進めるための制御基盤です。

まずは Aitle / Brainbase / SalesTailor の範囲で試します。

見るもの:
- README
- Drive: 雲孫ドライブ/unson/brainbase/社内共有資料/VibePro_社内活用ガイド_2026-05-05.pdf
- `vibepro --help`

最初に試すコマンド:
vibepro story diagnose . --id <story-id> --run-graphify
vibepro pr prepare . --base origin/develop --story-id <story-id>

フィードバックは #0230-vibepro に集約します。
特に、概念が伝わるか、コマンドで迷うか、Requirement Consistency / Gate DAG / split-plan がレビューに使えるかを見たいです。
```

`#0230-vibepro` 固定スレッド向け:

```text
VibePro 社内βフィードバックスレッドです。

以下の形式で投げてください。

【repo】
【実行コマンド】
【見た成果物】
【期待したこと】
【実際に起きたこと】
【分類】concept / command / false_positive / detector_gap / requirement_consistency / graphify_scope / gate_dag / split_plan / e2e_gate / docs
```
