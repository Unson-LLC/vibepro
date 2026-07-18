---
story_id: story-vibepro-pr-driven-continuous-release
title: PR-driven Continuous Release Architecture
parent_design: pr-driven-continuous-release
---

# Architecture

## Decision

`pull_request.closed`（`merged == true`、base=`main`）を単一の開始点とする。マージ後にLLMは呼ばず、VibeProがPR作成時に生成した `Release Notes` 契約を決定的なNode scriptで抽出する。抽出結果は同一PR番号のmarkerで月次リリース履歴と `CHANGELOG.md` にupsertし、bot commitを `main` へpushする。

docsは最新main上のbot commitとして公開する。一方、GitHub Releaseとnpm packageの `gitHead` は必ずeventが示す当該PRのmerge commitへ固定する。これにより、後続PRが先にmainへ入っても別versionのpackageを誤って公開しない。version不変ならdocs deployで終了し、base SHAとmerge SHA間で `package.json` のSemVerが増加した場合だけRelease/npm段へ進む。

## Boundaries

- PR authoring: `src/pr-manager.js` とPR templateが `Change Summary`、`Compatibility`、`User Action` を一度だけ記述する。
- Deterministic projection: `scripts/post-merge-release.mjs` がevent payloadを検証し、日英月次履歴、index到達性、CHANGELOG、Release bodyを生成する。
- Delivery: `.github/workflows/post-merge-release.yml` がdocs commitとCloudflare deployを最新mainで実行後、当該merge commitをdetached checkoutしてRelease/npmを実行する。各段はActions summaryへ状態を追記する。
- npm reconciliation: 公開済みversionは再publishせず `gitHead` とdist-tagを照合する。未公開時のみpublishし、上限付きbackoffでregistry反映を待つ。

## Compatibility and rollback

通常PRはversionを変えないためnpm公開されない。既存の手動 `npm-publish.yml` は緊急時のdry-run/recovery入口として残し、共通scriptを使う。rollbackはpost-merge workflowを無効化し、生成docs commitをrevertする。公開済みnpm versionは削除・上書きしない。Cloudflareは既存手順でlast-known-good deploymentへ戻す。

## Security

`NPM_TOKEN`、`CLOUDFLARE_API_TOKEN`、`CLOUDFLARE_ACCOUNT_ID` はGitHub environment secretからのみ注入する。scriptはtokenを引数、生成物、summaryへ書かない。PR bodyはMarkdownとして扱い、workflow command/outputへ直接評価しない。
