---
story_id: story-vibepro-oss-apache2-readiness
title: Apache-2.0でVibeProをOSS公開できる状態にする
status: active
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
