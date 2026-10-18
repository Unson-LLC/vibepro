---
story_id: story-vibepro-release-oidc-push-trigger
title: post-merge release を push トリガーへ移し npm Trusted Publishing を通す
status: active
view: dev
period: 2026-10
started_at: 2026-10-18
owner_repository: vibepro
spec_docs:
  - .vibepro/spec/story-vibepro-release-oidc-push-trigger/spec.json
---

# post-merge release を push トリガーへ移し npm Trusted Publishing を通す

## Storyと利用者成果

#592 で npm 公開は GitHub-hosted runner 上の npm Trusted Publishing (OIDC) へ移ったが、post-merge release workflow は `pull_request_target` で起動している。npm は `pull_request_target` イベントの OIDC トークンを Trusted Publishing に使わせないため、同じ構成の brainbase#824 では公開が ENEEDAUTH で失敗した（run 39046945726 / 39031355466、npm/cli#8739）。main への push（PR の merge commit）と `workflow_dispatch`（実行時点の main 先端を公開）で起動するように変え、merge 済み PR の解決、validation、npm 公開、GitHub Release、docs 投影の順序と内容はこれまで通り保つ。

## 受入条件

- AC-1: `.github/workflows/post-merge-release.yml` は `pull_request_target` ではなく `main` への `push` と `workflow_dispatch` で起動する。merge 判定・merge SHA・PR 番号は pull_request イベントの値ではなく、push された commit（`github.sha`）に紐づく merge 済み PR から解決し、それ以外の挙動は変えない。
- AC-2: release ジョブは validation と release-candidate の成功を必要とし、docs ジョブは npm 公開成功後（または version 不変時）だけ動く。release ジョブの `if:` に `always()` が入るとテストが失敗する。
- AC-3: `PCR-CON-013` のテスト ID は重複しない。#592 が追加した Trusted Publishing のテストは別の ID を持つ。
- AC-4: Story、Spec（全 clause に ac_id と具体的な test_refs、invariant に test_pattern）、`.vibepro/pr` の記録があり、pr-prepare.json の lineage は全 AC で `resolved` になる。
- AC-5: PR 本文に「佐藤さんが確認すること」節があり、npm Trusted Publisher 登録（workflow filename、environment、Allow npm dist-tag）の確認を依頼する。Trusted Publisher 設定の 2 日失効と OIDC の対応イベントは npm 公式ドキュメントで確認した内容だけを書く。
- AC-6: `workflow_dispatch` で起動した run の RELEASE_SHA（release-candidate と release が checkout・照合・公開する SHA）は、実行時点の main の先端（ref main での dispatch の `github.sha`）である。PR の merge SHA や入力で渡された古い SHA は使わない。古い SHA を公開しようとすると VibePro の runtime manifest が `behind` で止まり、merge 後の beta.33 は dispatch run で初めて公開されるため。

## 対象外

- npm の Trusted Publisher 設定そのものの変更
- `npm-publish.yml`（手動公開 workflow）の変更
- validation / publish / docs 投影の処理内容の変更
