---
story_id: story-vibepro-pr-driven-continuous-release
title: PR-driven Continuous Release Architecture
parent_design: pr-driven-continuous-release
---

# Architecture

## Decision

`pull_request.closed`（`merged == true`、base=`main`）を単一の開始点とする。マージ後にLLMは呼ばず、VibeProがPR作成時に生成した `Release Notes` 契約を決定的なNode scriptで抽出する。抽出結果は同一PR番号のmarkerで月次リリース履歴と `CHANGELOG.md` にupsertし、bot commitを `main` へpushする。

docsは最新main上のbot commitとして公開する。一方、GitHub Releaseとnpm packageの `gitHead` は必ずeventが示す当該PRのmerge commitへ固定する。これにより、後続PRが先にmainへ入っても別versionのpackageを誤って公開しない。version増加時はnpm versionとdist-tag、GitHub Releaseの順に収束させてから公開済みversionをdocsへ投影し、version不変ならその段をskipしてdocs deployへ進む。npmが失敗した実行ではGitHub Releaseを新規公開・更新しない。

## Boundaries

- PR authoring: `src/pr-manager.js` とPR templateが `Change Summary`、`Compatibility`、`User Action` を一度だけ記述する。
- Deterministic projection: `scripts/post-merge-release.mjs` がevent payloadを検証し、日英月次履歴、index到達性、CHANGELOG、Release bodyを生成する。
- Delivery: `.github/workflows/post-merge-release.yml` が当該merge commitをdetached checkoutし、依存もそのSHAで再構築してnpm、GitHub Releaseの順に実行する。成功後に最新mainへ戻り、docs commitとCloudflare deployを行う。各段と再実行手順は成功・失敗を問わずActions summaryへ追記する。
- Queueing: concurrency keyはPR番号単位とし、mergeが集中しても別PRのpending runを置換しない。docs pushが競合した場合は一時commitを破棄し、最新`origin/main`へresetして同じPR markerを決定的に再投影してから再pushする。deploy直前にも最新mainへfast-forwardして全投影済みノートを含める。
- npm reconciliation: 公開済みversionは再publishせず `gitHead` とdist-tagを照合する。dist-tagはその実行のversionへ無条件に戻さず、registryで可視な対象channelの全versionから最大SemVerを再計算して収束させるため、古いrunが後から完了してもtagを巻き戻さない。404だけを未公開と判定し、認証・通信・rate-limit・不正JSONは上限付きbackoff後にmutationなしで停止する。

## Compatibility and rollback

通常PRはversionを変えないためnpm公開されない。既存の手動 `npm-publish.yml` は緊急時のdry-run/recovery入口として残し、共通scriptを使う。rollbackはpost-merge workflowを無効化し、生成docs commitをrevertする。公開済みnpm versionは削除・上書きしない。Cloudflareは既存手順でlast-known-good deploymentへ戻す。

## Security

`NPM_TOKEN`、`CLOUDFLARE_API_TOKEN`、`CLOUDFLARE_ACCOUNT_ID` はGitHub environment secretからのみ注入する。scriptはtokenを引数、生成物、summaryへ書かない。PR bodyとtitleを含むPR由来の表示値はuntrusted Markdownとして扱い、workflow command/outputへ直接評価せず、raw HTMLとVue interpolationをescapeしてからVitePressへ渡す。
