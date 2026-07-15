---
story_id: story-vibepro-public-discovery-live-targets
title: Public Discovery Live Targets Architecture
parent_design: vibepro-public-discovery-live-targets
---

# アーキテクチャ

## 判断

Public Discoveryの検査対象を、従来のrepository sourceだけでなく、明示されたbuild成果物と公開URLへ拡張する。入力の優先順位は `base-url > public-dir > repository source` とし、選択したmode以外へsilent fallbackしない。明示入力が壊れている場合は、その入力を検査できなかった事実を `scan_coverage` へ残して `inconclusive` にする。

公開URL modeは小規模なread-only検査に限定する。HTTP(S)のbase URL、同一origin、GET、rootと `/sitemap.xml` から得たURL、最大40ページ、1応答2 MiB、1要求10秒を境界とする。JavaScript実行後DOM、リンク巡回、外部origin、認証、変更系メソッドは扱わない。build modeは指定directory配下のHTMLを最大400件まで再帰走査し、`robots.txt` と `llms.txt` は同じ成果物rootから読む。

既存のfinding判定は変更しない。block findingは `fail`、review findingは `needs_review` とし、常にcoverageより優先する。coverageは独立した `scan_coverage.status` として `pass / inconclusive` を返し、ページ検査0件を項目別finding 0件と区別する。top-level statusは強いfindingがなければcoverage statusを採用する。`inconclusive` は既存Storyの契約どおり非ブロッキングで、check aggregateはpassを維持しつつ `inconclusive_count` を持つ。

## 入力

- `scanPublicDiscovery(repoRoot, { baseUrl, publicDir, fetchImpl })`
- CLI: `vibepro check public-discovery|all [repo] [--base-url <url>] [--public-dir <dir>]`
- source mode: repository内の既存public page規約、robots/llms/header config、suppression config
- built mode: repository境界内の明示directoryと、その配下のHTML/robots/llms
- live mode: HTTP(S) base URL、同一originのroot/sitemap page、root response headers

`fetchImpl` はテスト用依存性注入でありCLIには露出しない。`check all` は `--base-url` または `--public-dir` が指定された時だけPublic Discoveryを暗黙追加する。引数なしの `check all` は互換性を維持する。

## 出力

- Public Discovery artifact schema `0.2.0`
- `scan_coverage`:
  - `mode`: `source | built | live`
  - `roots`: 実際に選択したdirectoryまたはURL
  - `discovered_count`: 候補として発見したページ数
  - `eligible_count`: protocol・origin・重複除外後に検査可能だった一意ページ数
  - `selected_count`: 件数上限内で取得対象に選んだページ数
  - `scanned_count`: 内容を取得・解析できたページ数
  - `omitted_count` / `omission_summary` / `omissions[]`: cap・外部origin・重複・不正URLによる除外件数、理由別集計、最大25件のsample
  - `failed_count`: 取得・読込失敗数
  - `errors[]`: `{ target, reason }`
  - `limits`: page/response byte/timeout上限
  - `status`: `pass | inconclusive`
  - `reason`: 判定不能時の理由と修正入力
- `check.json` / `check.md` の `public_discovery.coverage` 独立行
- live modeではroot response headersを `header_config` と同じfinding契約へ正規化

## 実行フロー

1. 入力優先順位からmodeを1つだけ選ぶ。
2. mode固有collectorがページ候補、robots、llms、header evidence、collector errorsを返す。
3. 取得できたページだけ既存 `classifyPublicDiscoveryTarget` / `inspectPage` へ渡す。
4. repository-level inspectionとsuppressionを従来どおり適用する。
5. finding risk summaryを先に確定し、次に `resolveScanConclusiveness` でcoverageを判定する。
6. top-levelは `fail > needs_review > coverage status`、check summaryはrisk行とcoverage行を別々に出す。

## エラー設計

- 不正なprotocol、repository外public directory、存在しないdirectory、fetch timeout、非2xx、過大response、壊れたsitemapはartifactへ記録する。sitemap XMLは対応rootと閉じtag、loc tag対を最低限検証し、壊れた入力を空sitemapとして扱わない。
- 上限適用前の発見数と選択数を分離し、cap超過・外部origin・重複・不正URLは除外集計とbounded sampleへ残す。
- 明示入力エラーでsourceへfallbackしない。
- sitemapが取得できなくてもrootが検査できればcoverageはconclusiveとし、sitemap errorは残す。
- rootを含め検査可能ページが0件ならcoverageは `inconclusive`。findingが同時にある場合もcoverage行は `inconclusive` のまま、top-levelは強いfindingを優先する。

## 互換性・rollback

- オプション無しのsource collector、suppression、finding ID/severityは維持する。
- `scan_coverage` は追加フィールドであり既存consumerを壊さない。
- rollbackはCLIから新入力を外し、`scanPublicDiscovery(root)` を呼ぶことでsource modeへ戻せる。
- live crawling拡張やblocking化は運用実績を見て別Storyで判断する。
