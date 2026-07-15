---
story_id: story-vibepro-public-discovery-live-targets
title: "Public Discoveryをビルド成果物・公開URLで検証し、0対象を判定不能にする"
view: dev
period: 2026-07
source:
  type: manual-site-gap-audit
  id: VP-GAP-2026-07-15-PUBLIC-DISCOVERY-VACUUM
  title: "vibepro.pages.devの改訂監査で、Public Discoveryが公開ページを0件しか見ずに項目別passを表示した"
parent_design: vibepro-public-discovery-live-targets
related_stories:
  - story-vibepro-scanner-inconclusive-coverage
  - story-vibepro-manual-control-plane-refresh
architecture_docs:
  - ../../../architecture/vibepro-public-discovery-live-targets.md
spec_docs:
  - ../../../specs/vibepro-public-discovery-live-targets.md
status: active
created_at: 2026-07-15
updated_at: 2026-07-15
reason: >-
  ソース規約の探索だけを広げる案ではビルド変換後・公開後の実体を証明できず、外部SEO専用ツールへ
  委譲する案ではVibeProのcheck packと監査証跡が分断されるため採用しない。既存呼び出しとの互換性を
  保ったまま明示入力を追加し、live・built・sourceの責務境界と件数上限を固定する。問題時は新しい
  入力を外して従来source走査へ戻せ、公開URLへの検査はGETのみ・同一origin・件数/サイズ/時間制限内に留める。
---

# Public Discoveryをビルド成果物・公開URLで検証し、0対象を判定不能にする

## User Story

**As a** 公開サイトの説明・検索発見性・AI向け情報をVibeProで出荷判定する運用者
**I want to** Public Discoveryがソース候補だけでなく、ビルド済みHTMLまたは実際の公開URLを明示入力として検査し、ページを1件も検査できない場合は判定不能と示してほしい
**So that** 「公開ページを見ていないのに合格」というvacuum passを排除し、公開実体に基づいて改訂結果を判断できる

## 背景

`vibepro check public-discovery` は現在、`scanPublicDiscovery(repoRoot)` がリポジトリ内を走査し、
`app/`・`pages/`・`public/`等のソース規約に合う候補だけを対象にする。静的サイトジェネレータの
ビルド成果物が `dist/` に出る構成やCloudflare Pagesの公開URLは入力できず、公開ページ走査0件でも
各リスク群はfinding 0件として `pass` 相当になる。robots.txt欠落等のリポジトリ項目が
`needs_review` を発生させても、メタデータ・構造化データ・本文を1ページも検査していない事実が
独立したcoverage状態として残らない。

既存の `story-vibepro-scanner-inconclusive-coverage` は「0対象はpassではない」という共有契約を
導入したが、Public Discoveryは明示的に非目標だった。本Storyではその契約をPublic Discoveryへ
展開し、公開対象を与える入力面も同時に閉じる。

## Scope

- `vibepro check public-discovery|all` に `--public-dir <dir>` と `--base-url <url>` を追加する
- `--base-url` 指定時はHTTP(S)の同一origin内に限定し、rootとsitemapから発見した公開HTMLを件数・サイズ・時間上限付きGETで検査する
- `--public-dir` 指定時は指定ディレクトリ配下のHTMLを再帰走査し、robots.txt / llms.txtも同じ公開成果物から読む
- 入力優先順位を `base-url > public-dir > repository source` とし、結果へ実際に選択したmodeとrootsを記録する
- Public Discoveryへ `scan_coverage` と0対象時の `inconclusive` を追加し、findingによるfail/needs_reviewは常に優先する
- check pack summaryにPublic Discovery coverageを独立行で表示し、項目別finding 0件とページ走査済みを混同しない
- 日本語/英語help、JSON artifact、回帰テストを更新する

## 非目標

- JavaScript実行後のDOM、認証ページ、フォーム操作、変更系HTTPメソッドの検査
- 外部originへのクロール、robots.txtを無視した無制限クロール、完全なSEOクローラの実装
- `inconclusive` をGate DAGのblocking状態へ変更すること
- 既存findingのseverityや抑制契約の全面変更

## 実装タスク

1. Public Discoveryの対象解決とcoverage契約
   - `base-url > public-dir > repository source` の優先順位で検査対象を解決する
   - live/built/sourceの制限、失敗理由、検査件数を `scan_coverage` に記録する
   - 0対象を `inconclusive` とし、既存findingのfail/needs_reviewを優先する
2. CLIとcheck pack成果物の公開入力対応
   - `check public-discovery|all` へ `--base-url` と `--public-dir` を伝播する
   - JSON/Markdown summaryへPublic Discovery coverageを独立表示する
   - CLI helpと診断Skillに入力mode・上限・0対象の意味を記載する
3. Public Discoveryのlive/built/source回帰検証
   - 再帰ビルド走査、同一origin sitemap、到達不能、過大応答をtargeted testで検証する
   - 従来source走査、CLI引数、check pack成果物の互換性を検証する
   - targeted test、full suite、Skill lint、AGENTS同期を完了する

## 受け入れ基準

- [ ] PDLT-AC-001: `--public-dir <dir>` を指定すると、その配下のHTMLを再帰走査し、ソース規約に依存せず公開ページを検査する
- [ ] PDLT-AC-002: `--base-url <url>` を指定すると、rootとsitemapから発見した同一originのHTTP(S)ページだけを上限付きで検査し、外部URL・非HTTP(S) URL・過大応答を対象外または明示エラーにする
- [ ] PDLT-AC-003: `base-url > public-dir > repository source` の優先順位と、選択mode・root・発見数・検査数・取得失敗が `scan_coverage` に機械可読で残る
- [ ] PDLT-AC-004: ページ検査数0件かつblock/review findingなしの場合、Public Discovery coverageは `inconclusive` であり `pass` を返さない
- [ ] PDLT-AC-005: ページ検査数1件以上かつfindingなしの場合のみcoverageは `pass` になり、既存block/needs_review findingは0件判定より優先される
- [ ] PDLT-AC-006: `check.json` / `check.md` はPublic Discovery coverageを独立表示し、項目別finding 0件を「ページ検査済み」の証拠として扱わない
- [ ] PDLT-AC-007: 明示したpublic directoryが存在しない、base URLへ到達できない、または取得可能ページが0件の場合、理由と次の修正入力が成果物に残りsilent fallbackしない
- [ ] PDLT-AC-008: 従来の引数なしsource走査、suppression、robots/llms、メタデータ/構造化データfindingは互換性を維持する
- [ ] PDLT-AC-009: CLI helpと診断Skillは新しい入力と0対象の意味を説明し、targeted testとfull suiteが成功する

## 検証メモ

ローカルfixtureでsource/built/liveの3mode、同一origin制限、0件inconclusive、到達不能、
findings優先、CLI引数伝播、JSON/Markdown表示を自動検証する。公開サイトへの最終確認は
本Storyマージ後のCloudflare Pagesデプロイ監査で別途実施する。
