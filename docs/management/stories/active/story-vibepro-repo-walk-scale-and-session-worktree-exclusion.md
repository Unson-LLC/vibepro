---
story_id: story-vibepro-repo-walk-scale-and-session-worktree-exclusion
title: "リポジトリ走査層のスケール安全性とセッションworktree除外を揃える"
status: active
view: dev
period: 2026-08
category: quality
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
- The `walkFiles(dir)` external contract in src/pr-manager.js (flat array of absolute paths including files nested at any depth; a missing root directory yields `[]`; ENOENT is tolerated per pending directory; non-ENOENT errors propagate) is unchanged/existing; this Story only rewrites the traversal mechanism (recursion+spread to an explicit queue), not what the function returns or which errors it swallows.
- The `!authorizationLine` guard branch in src/code-quality-scanner.js (`collectAuthorizationOrderRisks` skipping files with no detected authorization line before scanning for bulk queries) is unchanged/existing; this Story only changes where `IGNORED_DIRS` is defined (imported from `scan-ignored-dirs.js` instead of a local literal), not this detection branch.
- The `queryLine < authorizationLine` comparison in src/code-quality-scanner.js (`collectAuthorizationOrderRisks` flagging a bulk query that textually precedes the authorization check) is unchanged/existing; same as above, only the ignore-set import changed, not this comparison.
- The `!signature` guard branch in src/code-quality-scanner.js (`collectQueryShapes` skipping a Prisma call when `buildQueryShapeSignature` cannot derive a signature) is unchanged/existing; the ignore-set consolidation does not touch query-shape signature derivation.
- The `dependencies.has('next-auth')` / `dependencies.has('@auth/core')` / `hasNextAuthRoute(fileSet)` auth-detection branches in src/architecture-profiler.js (`detectAuth` and `buildProfileEvidence` consuming the collected dependency set and file set) are unchanged/existing; this Story only rewrites where `PROFILER_IGNORED_DIRS` is defined, not what auth mechanisms are detected. (PR #409's Story already declared this branch inherited for the file-walk rewrite; it is restated here because this Story independently touches the same file.)

## Failure Mode Assessment

Assessed against the three high-risk failure-mode candidates VibePro's failure-mode-coverage scan derives for this route (`workflow_heavy` profile plus changed files matching `database`/`pr-manager`/`gate` patterns). Executable verification evidence for the applicable modes below exists in `test/story-vibepro-repo-walk-scale-and-session-worktree-exclusion.test.js` but is not yet recorded as current-bound `vibepro verify` evidence against this head; that recording, and any non-applicability decision, is left to the operator closing this Story's gates, not asserted here.

- **persistence_failure** — candidate fired only because the changed-file list contains `src/database-access-scanner.js` (filename token match), not because this Story adds or changes a persistence path. `database-access-scanner.js` is a static-analysis scanner: it reads other files' text with `readFile`/`readdir` and pattern-matches for risky Prisma call shapes in *other* code; it opens no database connection and writes no persisted state itself, before or after this Story's change (the only edit to that file is pointing `IGNORED_DIRS` at the shared `scan-ignored-dirs.js` import). This mode does not apply to this Story's diff.
- **evidence_lifecycle_regression** — narrowly applicable. `architecture-profiler` / `code-quality-scanner` / `database-access-scanner` outputs are consumed elsewhere in `src/pr-manager.js` as gate evidence (architecture axis quality, responsibility-authority candidates, code-quality risk surfaces). A scan-scope narrowing bug — real source accidentally landing under an excluded directory name, or a future caller silently widening `SCAN_IGNORED_DIRS` — could make a scanner under-report and produce a misleadingly clean gate evidence artifact. Mitigations: the shared set only removes directories that hold tooling/session state (`.claude`, `.worktrees`, `.git`, `.next`, `.turbo`, `.vibepro`, `coverage`, `graphify-out`, `node_modules`), never product source directories; and `SCAN_IGNORED_DIRS` is a frozen `has()`-only facade (`src/scan-ignored-dirs.js`), so no call site can mutate the shared set at runtime. Test coverage: the test titled `story-vibepro-repo-walk-scale-and-session-worktree-exclusion architecture-profiler, code-quality-scanner, and database-access-scanner all skip .claude and .worktrees` asserts a real source file under `src/` is still scanned while decoy source under `.claude/worktrees/**` and `.worktrees/**` is excluded from all three scanners' findings.
- **workflow_state_regression** — narrowly applicable to the walker's own internal traversal state, not to any VibePro workflow/gate state machine. `walkFiles`'s rewrite replaces recursion+spread with an explicit `pending` array and index, i.e. each directory transitions from queued (pushed onto `pending`) to processed (its entries read and its files accumulated) exactly once; a regression here would mean a directory is processed zero or multiple times. Test coverage: the spread-argument-limit regression test (`--stack-size=200`, 30000 files) and the nested/missing-directory contract test both assert the terminal accumulated-file-count and set are correct, which only holds if the queued→processed transition happens exactly once per directory.

## Non Goals

- PR #409 で反復化済みの8 walker の再修正。
- `static-site-scanner` / `flow-design-scanner` / `story-catalog-generator` など、本Storyが対象としない他スキャナの除外集合の統合。
- スキャナの検出ロジック・gate 判定・出力スキーマの変更。
- `.gitignore` / `.vibeproignore` を解釈する汎用 ignore 機構の新設。
