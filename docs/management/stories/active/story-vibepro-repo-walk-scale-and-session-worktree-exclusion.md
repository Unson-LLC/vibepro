---
story_id: story-vibepro-repo-walk-scale-and-session-worktree-exclusion
title: "リポジトリ走査層のスケール安全性とセッションworktree除外を揃える"
status: active
view: dev
period: 2026-08
category: quality
parent_design: vibepro-repo-walk-scale-and-session-worktree-exclusion
related_stories:
  - story-vibepro-test-suite-cost-reduction
reason:
  decision: "PR #409で8 walkerに適用した『明示キュー＋単一アキュムレータの反復走査』を、同型のspread-pushが残る src/pr-manager.js の walkFiles にも適用し、あわせて architecture-profiler / code-quality-scanner / database-access-scanner の除外ディレクトリ集合を共有定数へ集約して `.claude` と `.worktrees` を全スキャナで除外する"
  alternatives: "pr-manager の walkFiles をそのまま残す案は、visual QA ディレクトリが巨大化した時にPR #409と同じ RangeError を再発させるため採用しない。除外を各スキャナのリテラルへ個別追記する案は、3スキャナで既に集合がずれている原因そのものなので採用しない。`.claude/worktrees` だけを除外する案は、`.claude/skills` 等も走査対象として無価値かつ将来同じずれを生むため、`.claude` 単位の除外を採る"
  compatibility: "walkFiles の戻り値（絶対パスのフラット配列）と ENOENT を空配列として扱う挙動は変更しない。除外集合の追加はスキャン対象の縮小のみで、既存の検出結果に対する追加検出は発生しない。`.claude` 配下を意図的に走査していた既存テスト・利用箇所は存在しない"
  rollback: "walkFiles は再帰版へ戻すだけで復旧できる。除外集合は共有定数から `.claude` / `.worktrees` を外せば従来の走査範囲へ戻る"
  boundary: "走査対象の縮小のみを行い、スキャナの検出ロジック・gate判定・出力スキーマは変更しない。`.gitignore` / `.vibeproignore` 由来の除外機構の新設は行わない。PR #409で反復化済みの8 walkerには手を入れない"
created_at: 2026-08-04
updated_at: 2026-08-04
---

# リポジトリ走査層のスケール安全性とセッションworktree除外を揃える

## User Story

**As a** 巨大なセッションworktree置き場を抱えた実リポジトリで VibePro のスキャン系コマンドを回す開発者
**I want** ファイル走査層が(1)サブツリーの大きさでクラッシュせず、(2)走査する価値のないディレクトリを最初から見に行かないこと
**So that** `vibepro check architecture` / `story diagnose` が巨大リポジトリでも完走し、無駄な待ち時間を払わずに済む

## Context and Gap

- PR #409 は `story diagnose` の "Maximum call stack size exceeded" を、8つの walker を `files.push(...await walk(sub))` から「明示キュー＋単一アキュムレータの反復走査」へ書き換えて根治した。原因は spread が V8 の引数個数上限を超えることであり、再帰の深さではない。
- しかし `src/pr-manager.js` の `walkFiles`（`src/pr-manager.js:7136`）には同型の `files.push(...await walkFiles(fullPath))` が残っている。visual QA ディレクトリや `tests/e2e` 配下が十分大きくなれば同じ `RangeError` を起こす。PR #409 の修正はこの経路をカバーしていない。
- 除外ディレクトリ集合が3スキャナでずれている。`architecture-profiler` は `.worktrees` を除外するが、`code-quality-scanner` と `database-access-scanner` は除外しない。3つとも `.claude` を除外しない。
- 実リポジトリの `.claude/worktrees` は Claude セッションworktreeの置き場で、実測 280,852 ファイル / 5.6GB。各スキャナがこれを毎回走査しており、クラッシュはしないがスキャナ1本あたりの実行時間を大きく押し上げている。
- 除外集合が3ファイルにリテラルで重複しているため、片方だけ直す修正が繰り返され、ずれが再発する構造になっている。

## Acceptance Criteria

- [ ] RWS-S-1: `src/pr-manager.js` の `walkFiles` は spread-push を使わず、明示キューと単一アキュムレータによる反復走査で実装される。
- [ ] RWS-S-2: 単一サブツリーが V8 の spread 引数上限を超える規模でも `walkFiles` が `RangeError` を投げずに全ファイルを返すことを、`--stack-size=200` の子プロセスで回帰テストが証明する。
- [ ] RWS-S-3: `walkFiles` の外部契約（ネスト配下も含む絶対パスのフラット配列を返す／存在しないディレクトリでは空配列を返す／ENOENT以外のエラーは伝播する）は変更前と同一である。
- [ ] RWS-S-4: `architecture-profiler` / `code-quality-scanner` / `database-access-scanner` の除外ディレクトリ集合は単一の共有定数に集約され、3スキャナで同一の集合を参照する。
- [ ] RWS-S-5: 共有された除外集合は `.claude` と `.worktrees` を含み、3スキャナのいずれも `.claude/worktrees` 配下および `.worktrees` 配下のファイルを走査結果に含めない。
- [ ] RWS-S-6: 除外集合の共有と拡張の後も、3スキャナの既存の検出結果・出力スキーマは変わらない（既存テストが無改変で通る）。

## Inherited Behavior

- PR #409 が確立した「明示キュー＋単一アキュムレータの反復走査」を walker の標準形として踏襲する。
- 各スキャナの除外は「ディレクトリ名の集合による entry 単位のスキップ」という既存方式のままとし、パターンマッチや ignore ファイル解釈は導入しない。
- `walkFiles` の ENOENT を空配列として扱う fail-soft は維持する。

## Non Goals

- PR #409 で反復化済みの8 walker の再修正。
- `static-site-scanner` / `flow-design-scanner` / `story-catalog-generator` など、本Storyが対象としない他スキャナの除外集合の統合。
- スキャナの検出ロジック・gate 判定・出力スキーマの変更。
- `.gitignore` / `.vibeproignore` を解釈する汎用 ignore 機構の新設。
