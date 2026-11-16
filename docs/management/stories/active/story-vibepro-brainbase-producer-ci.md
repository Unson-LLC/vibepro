---
story_id: story-vibepro-brainbase-producer-ci
title: Brainbase producer契約テストを別ディレクトリでも実行する
status: active
contract_type: bug_fix
view: dev
period: 2026-10
requirement_id: 3ba9773b-eae0-45c2-a664-260b1841671e
requirement_task: RQ-051
---

# Brainbase producer契約テストを別ディレクトリでも実行する

## 背景

関連要件は `3ba9773b-eae0-45c2-a664-260b1841671e`（要件タスク RQ-051）。佐藤さんの承認は 2026-10-15 08:19 JST（DevDirector経由）。

`test/brainbase-producer-contract.test.js` の4件は `BRAINBASE_PRODUCER_MODULE` が無いと skip する。指定されたモジュールと同じディレクトリの `outcome-case-service.js` と `vibepro-handoff-issuer.js` だけを読む。producer（`createVibeproManagedHandoff` を出すモジュール）、issuer（`vibepro-handoff-issuer.js`）、outcome-case-service（`outcome-case-service.js`）の3部品は、非公開の Unson-LLC/brainbase-organization main の `packages/server-parts/` にしか無い。

2026-10-14 にこの作業環境から確認した事実: その非公開リポジトリは現行の GitHub 資格情報で 404 になる。公開の Unson-LLC/brainbase（develop）と npm の `@unson/brainbase-mcp@0.41.3` にも3部品は無い。`.github/workflows/ci.yml` は他リポジトリを checkout せず、workflow が参照する secret は `NPM_TOKEN`、`CLOUDFLARE_API_TOKEN`、`CLOUDFLARE_ACCOUNT_ID` だけである。

## Story

開発者として、issuer と outcome-case-service が producer と別のディレクトリにあっても、Brainbase の実モジュールに対する4件の契約テストを実行したい。

それにより、同じディレクトリに並んでいる場合も、親をたどって1件だけ見つかる場合も、`BRAINBASE_PRODUCER_ROOT` の下で分かれている場合も、明示パスを渡した場合も、テストは目的のファイルを読む。非公開リポジトリを取るための secret は足さない。

## Acceptance Criteria

- BPC-AC-001: `BRAINBASE_PRODUCER_MODULE` と同じディレクトリに `outcome-case-service.js` と `vibepro-handoff-issuer.js` があるとき、解決結果はその2ファイルである。
- BPC-AC-002: その2ファイルが producer と別のディレクトリにあっても、producer の親をたどるか `BRAINBASE_PRODUCER_ROOT` の下を探して1件だけならそのパスを使う。`server-parts` というディレクトリで探索を止め、その外は見ない。
- BPC-AC-003: `BRAINBASE_OUTCOME_CASE_SERVICE` と `BRAINBASE_HANDOFF_ISSUER` があるときは探索よりそのパスを使う。
- BPC-AC-004: 同じファイル名が複数あるとき、または探索上限を超えたときは失敗し、パスを推測しない。
- BPC-AC-005: `BRAINBASE_PRODUCER_MODULE` が無いとき、契約テスト4件は skip する。非公開 org を clone する secret や読み取り資格情報は追加しない。実モジュールの代わりの fixture で4件を pass にしない。

## Boundary

- judgment prepare、判断 DAG、採択、判断 JSON の手書きはしない。
- 非公開の producer ソースをこのリポジトリへコピーしない。
- CI で4件を pass にするには3部品の取得が要る。現行の資格情報では取得できないため、この変更では secret を足さず、checkout も足さない。取りうる選択は Options に書く。

## Problem Frame

- status: valid
- statement: 契約テストは producer、issuer、outcome-case-service が同一ディレクトリにある前提で、CI はその3部品を読めず4件を skip する。
- reason: 3部品は非公開の brainbase-organization の packages/server-parts/ にしか無く、現行の GitHub 資格情報と公開 brainbase、公開 npm パッケージからは届かない。新しい secret は追加しない。

## Constraints

### no-new-secret
- kind: invariant
- statement: 非公開 org を読む secret や読み取り資格情報を追加しない。

### separate-directories
- kind: invariant
- statement: issuer と outcome-case-service は producer と別のディレクトリにあっても、1件に定まるなら解決できる。

### real-producer
- kind: invariant
- statement: 契約テスト4件は Brainbase の実モジュールを読む。代わりの fixture で pass にしない。

### unique-match
- kind: invariant
- statement: 同名ファイルが複数あるとき、または探索が上限を超えたときは失敗し、パスを推測しない。

## Options

### option-directory-resolution
- summary: テストが別ディレクトリの issuer と outcome-case-service を見つけられるようにする。producer の取得と secret の追加はしない。
- action: fix
- addresses: separate-directories, unique-match, no-new-secret
- violates:
- residual_risk: medium

### option-org-read-credential
- summary: 組織の読み取り資格情報を追加し、CI が brainbase-organization を clone して4件を実モジュールに対して実行する。別途承認が要る。
- action: measure
- addresses: real-producer, separate-directories
- violates: no-new-secret
- residual_risk: high

### option-publish-modules
- summary: producer、issuer、outcome-case-service の3部品を公開 brainbase へ移し、CI は公開されたファイルを読む。
- action: build
- addresses: no-new-secret, real-producer, separate-directories
- violates:
- residual_risk: medium

### option-producer-repo-ci
- summary: 4件の実行を brainbase-organization の CI に置き、部品があるリポジトリで producer に対して走らせる。
- action: build
- addresses: no-new-secret, real-producer
- violates:
- residual_risk: medium

### option-runner-disk
- summary: 自己ホストランナーのディスクに既にある checkout を CI の環境変数で指す。新しい secret は足さない。
- action: experiment
- addresses: no-new-secret, real-producer, separate-directories
- violates:
- residual_risk: high
