---
story_id: story-vibepro-oss-apache2-readiness
title: Apache-2.0でVibeProをOSS公開できる状態にする
status: active
view: dev
horizon: month
period: 2026-05
category: product
started_at: 2026-05-26
source:
  type: user_request
  id: oss-apache2-readiness
architecture_docs:
  - docs/architecture/vibepro-oss-apache2-readiness.md
spec_docs:
  - docs/specs/vibepro-oss-apache2-readiness.md
reason: OSS readiness task breakdown refines existing release-readiness documentation and does not change runtime architecture.
---

# Story

VibeProをOSSとして公開するために、Apache-2.0ライセンス、公開用package metadata、README、CI、GitHub運用テンプレート、配布物の安全確認を揃える。

VibeProはGraphifyを任意の外部CLIとして利用できるが、Graphify本体を同梱しない。Graphifyの利用者はGraphify側のライセンスに従う。

## 事業価値

OSS公開前の権利・配布物・検証証跡を揃えることで、公開判断と公開後の保守導線を効率化し、外部利用者が安全にVibeProを選択できる状態にする。

## 成功指標

- npm dry-run package が `.vibepro/`、`docs/`、`docs/releases/`、local logs、Graphify source を含まない。
- OSS公開前のCI相当コマンド (`npm run typecheck`、`npm test`、`npm run pack:dry-run`) が通る。
- PR evidence はStory正本のtitle / backgroundを使い、汎用fallback文言を不要に出さない。
- Agent Review Gate はdevelopment phase reviewとPR-final reviewを分離し、PR直前に全フェーズを一括要求しない。

## Acceptance Criteria

- `LICENSE` が Apache License 2.0 で追加されている。
- `package.json` に `license: Apache-2.0` と公開用metadataがある。
- README / README.ja に Apache-2.0 と Graphify optional integration が明記されている。
- npm package に `.vibepro/`、Graphify本体、社内release noteが含まれない。
- `CONTRIBUTING.md`、`SECURITY.md`、`CODE_OF_CONDUCT.md`、`CHANGELOG.md` がある。
- GitHub issue / PR template と CI がある。
- CI相当の `typecheck`、`test`、`npm pack --dry-run` が通る。
- VibeProが生成するPR本文は、内部状態の汎用title (`Story` など) ではなくStory正本のtitle / requirement titleを優先して表示する。
- Story正本に `## 背景` がない場合でも、`# Story` 直下の導入文からレビュー可能な背景を抽出し、`背景: Story文書から抽出できませんでした` を不要に出さない。
- サブエージェントレビューはPR直前に全フェーズを一括要求せず、`implementation-start` / `test-plan` / `implementation-complete` checkpointで各フェーズをGate化する。
- `pr prepare` / `pr create` のAgent Review Gateは、PR直前に必要なfinal `gate` / `preview` 系レビューだけを要求する。

## タスク

1. OSS公開メタデータと運用ドキュメントの最終確認
   - `LICENSE` / `NOTICE` / `package.json` / README / README.ja / GitHub templates / CI / contribution docs がOSS公開前提と矛盾しないことを確認する
   - Apache-2.0表記、Graphify optional integration、public npm metadata、security/contact導線を一覧で証跡化する
   - 不足があれば該当ドキュメントまたはmetadataを修正する

2. npm package boundaryのクリーン検証
   - clean worktreeで `npm run pack:dry-run` を実行し、`.vibepro/`、Graphify本体、`docs/releases/`、local logs、customer/dogfood evidence がtarballに含まれないことを確認する
   - `package.json#files` とpack出力の差分を照合し、公開packageに入るファイルをレビュー可能なartifactに残す
   - 意図しないファイルが入る場合は `files` または配置を修正する

3. OSS release verificationの再実行
   - clean worktreeで `npm run typecheck`、`npm test`、`npm run pack:dry-run`、CLI smokeを実行する
   - 失敗があればOSS公開blockerとして分類し、修正またはdecision recordに残す
   - 成功したコマンドをVibePro verification artifactに記録する

4. PR evidence canonical story contextの確認
   - `vibepro pr prepare` がStory正本のtitle / requirement titleをPR本文に使うことを確認する
   - `## 背景` がないStoryでも `# Story` 直下の導入文から背景を抽出し、汎用の欠落文言を不要に出さないことを確認する
   - 該当fixtureまたは既存テストでpre-fixなら失敗する証跡を残す

5. Agent Review Gate phase separationの確認
   - `implementation-start` / `test-plan` / `implementation-complete` checkpointが各フェーズのreviewをGate化することを確認する
   - `pr prepare` / `pr create` がPR直前のfinal `gate` / `preview` 系reviewだけを要求することを確認する
   - phase reviewの未実行がPR直前にまとめて要求されないことをテストまたはVibePro artifactで証跡化する

6. KPI / Period metadataの補完
   - Story正本frontmatterに `view` / `horizon` / `period` / `category` / `started_at` を明示する
   - OSS公開readyの事業価値と成功指標をStory本文に残す
   - `story derive` でperiod未確定やKPI未確認のopen questionが残らないことを確認する

## 進捗

- [x] 2026-05-26: `story-vibepro-oss-apache2-readiness-01-oss`
  - `LICENSE` は Apache License 2.0 本文、`NOTICE` は VibePro copyright / Apache-2.0 / Graphify optional integration を記載している。
  - `package.json` は `license: Apache-2.0`、GitHub repository / bugs / homepage、public npm `publishConfig.access`、CLI `bin`、runtime-focused `files` を持つ。
  - README / README.ja は Apache-2.0、alpha OSS release candidate、npm公開前後のinstall方法、Graphify optional integration と外部ライセンス扱いを記載している。
  - `CONTRIBUTING.md`、`SECURITY.md`、`CODE_OF_CONDUCT.md`、`CHANGELOG.md`、GitHub issue templates、PR template、CI workflow を確認した。
  - `SECURITY.md` に private GitHub Security Advisory の具体導線を追加した。
- [x] 2026-05-26: `story-vibepro-oss-apache2-readiness-02-npm-package-boundary`
  - clean worktreeで `npm run pack:dry-run` を実行し、74 files のtarball候補を確認した。
  - tarball候補は `package.json#files` に沿った runtime/package files のみで、`.vibepro/`、`docs/`、`docs/releases/`、local logs、Graphify source は含まれていない。
  - VibePro verification artifact: `.vibepro/pr/story-vibepro-oss-apache2-readiness/verification-evidence.json`
- [x] 2026-05-26: `story-vibepro-oss-apache2-readiness-03-oss-release-verification`
  - clean worktreeで `npm run typecheck`、`npm test`、`npm run pack:dry-run`、CLI smokeを実行した。
  - `npm test` は 215 tests / 0 failures。
  - CLI smokeは `node bin/vibepro.js --version`、`node bin/vibepro.js help --language en`、`node bin/vibepro.js checkpoint --json` を確認した。
  - VibePro verification artifact: `.vibepro/pr/story-vibepro-oss-apache2-readiness/verification-evidence.json`
- [x] 2026-05-26: `story-vibepro-oss-apache2-readiness-04-pr-evidence-canonical-story-context`
  - `vibepro pr prepare` がStory正本のtitle / requirement titleをPR本文とGate DAGに使うことを確認した。
  - Story正本に `## 背景` がない場合でも、`# Story` 直下の導入文から背景を抽出し、`背景: Story文書から抽出できませんでした` を出さないことを確認した。
  - pre-fix回帰を捕まえる既存テスト: `pr prepare uses story source title and intro when explicit background heading is absent`
  - VibePro PR artifact: `.vibepro/pr/story-vibepro-oss-apache2-readiness/pr-body.md`
- [x] 2026-05-26: `story-vibepro-oss-apache2-readiness-05-agent-review-gate-phase-separation`
  - `implementation-start` / `test-plan` / `implementation-complete` checkpoint が、それぞれ `planning_spec` / `architecture_spec`、`test_plan`、`implementation` reviewをGate化することを確認した。
  - `pr prepare` / `pr create` のAgent Review Gateは、PR直前のfinal `gate` reviewだけを要求し、development phase reviewをPR直前にまとめて要求しないことを確認した。
  - pre-fix回帰を捕まえる既存テスト: `checkpoint lists available phase gates`、`checkpoint blocks implementation start before design gates and staged reviews pass`、`pr prepare requires only final agent review gates; phase reviews are checkpoint-gated`
  - VibePro PR artifact: `.vibepro/pr/story-vibepro-oss-apache2-readiness/gate-dag.json`
- [x] 2026-05-26: `story-vibepro-oss-apache2-readiness-06-planning-metadata`
  - Story正本frontmatterに `view: dev`、`horizon: month`、`period: 2026-05`、`category: product`、`started_at: 2026-05-26` を追加し、VibePro / NocoDB連携で管理期間が未確定にならないようにした。
  - `## 事業価値` と `## 成功指標` を追加し、OSS公開readyの事業上の意味と判定を package boundary、CI相当検証、PR evidence、Agent Review Gate phase separation の4点に固定した。
