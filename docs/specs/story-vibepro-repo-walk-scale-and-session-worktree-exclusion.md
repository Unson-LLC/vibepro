---
story_id: story-vibepro-repo-walk-scale-and-session-worktree-exclusion
title: pr-manager walkFiles iterative rewrite and shared scanner ignore-set Spec
status: active
parent_design: story-vibepro-repo-walk-scale-and-session-worktree-exclusion
last_reviewed_root_hash: 18a2201bd2220f60e71801d3546d92e203ac3894970d0991a3ba2450b4642abc
---

# pr-manager walkFiles iterative rewrite and shared scanner ignore-set Spec

正本のSpec artifactは `.vibepro/spec/story-vibepro-repo-walk-scale-and-session-worktree-exclusion/spec.json`
（clauses: INV-001 / S-001 / C-001 / INV-002 / S-002 / INV-003、diagrams: flow / threat_model）。
clause idは `vibepro spec write` が入力idを安定化した結果であり、以下では入力時のAC対応名（RWS-1〜RWS-6）を
括弧で併記する。本ファイルはDesign SSOTのlineage束縛用のspec pointerであり、Storyの受け入れ基準・
Inherited Behavior・Failure Mode Assessmentは
`docs/management/stories/active/story-vibepro-repo-walk-scale-and-session-worktree-exclusion.md` を参照する。

## Contract Summary

- INV-001 (RWS-1): `src/pr-manager.js` の `walkFiles` は spread-push (`files.push(...await walkFiles(sub))`) を
  使わず、明示キュー (`pending` 配列 + index) と単一アキュムレータ (`files` 配列) による反復走査で実装される。
- S-001 (RWS-2): spread引数上限相当のサブツリー (`--stack-size=200` × 30000 files) でも `walkFiles` が
  `RangeError` を投げずに完走し、正しい件数を返す。
- C-001 (RWS-3): `walkFiles` の外部契約は変更前と同一 — ネスト配下も含む絶対パスのフラット配列を返す／存在しない
  ディレクトリでは空配列を返す／ENOENT以外のエラーは伝播する。
- INV-002 (RWS-4): `architecture-profiler` / `code-quality-scanner` / `database-access-scanner` は単一の共有定数
  `src/scan-ignored-dirs.js` の `SCAN_IGNORED_DIRS` を参照し、各ファイルに個別の `IGNORED_DIRS` リテラルを
  持たない。
- S-002 (RWS-5): 共有された除外集合は `.claude` と `.worktrees` を含み、3スキャナのいずれも `.claude/worktrees`
  配下および `.worktrees` 配下のファイルを走査結果に含めない。
- INV-003 (RWS-6): 除外集合の共有と拡張の後も、3スキャナの検出ロジック・gate判定・出力スキーマは変わらない。
  ここに `!authorizationLine` / `queryLine < authorizationLine` / `!signature`
  (src/code-quality-scanner.js) と `dependencies.has('next-auth')` / `dependencies.has('@auth/core')` /
  `hasNextAuthRoute(fileSet)` (src/architecture-profiler.js) の6件の構造化 `inherited_behavior` 宣言が
  紐づく。

## Public Contract Delta (for gate:judgment_axis_public_contract)

このStoryが公開面（CLI外部利用者から見える契約）に与える変更点を明示する。

1. **新規exportの追加**: `src/pr-manager.js` の `walkFiles(dir)` は非exportの内部関数から `export async function
   walkFiles(dir)` へ変わった。これはVibePro CLIの利用者向けコマンド・フラグ・出力形式には現れない、モジュール内部
   API面の追加である。追加した理由はテスト容易性のみ（spread引数上限の回帰テストと外部契約テストを、
   `buildStoryE2eCoverage` / `readVisualQaRun` が要求するフルのstory/git/repoフィクスチャなしに直接駆動するため）。
   既存の2つの呼び出し元（`buildStoryE2eCoverage`, `readVisualQaRun`）の呼び出し方・戻り値の使い方は変更していない。
2. **挙動契約は不変**: `walkFiles` の戻り値（ネスト配下も含む絶対パスのフラット配列）、存在しないディレクトリに
   対する空配列フォールバック、ENOENT以外のエラー伝播は、書き換え前後で同一である（INV-001 / C-001）。
3. **走査順序の変更（ベニン）**: 実装が再帰（深さ優先）から明示キューの反復（幅優先）に変わったため、
   `walkFiles` が返す配列内の要素順序は深さ優先から幅優先に変わる。この順序変化は無害と判断した根拠:
   - `readVisualQaRun`（`src/pr-manager.js:7136`付近の呼び出し元）は `walkFiles` の結果を mtime でソートして
     から使用しており、入力順序に依存しない。
   - `residual-analysis.md` は qaDir ごとに1本だけ生成され（`src/visual-verifier.js:100`）、複数ファイルの
     出力順序を消費しない。
   - `buildStoryE2eCoverage` は `walkFiles` の結果を非順序集合（存在判定・カウント）として使っており、
     この構成のリポジトリの e2e ディレクトリはフラットなので、順序変化がテスト結果に影響しない。
4. **スキャナ側は出力スキーマ・検出ロジックへの変更なし**: `architecture-profiler` / `code-quality-scanner` /
   `database-access-scanner` の変更は、各ファイルのローカル `IGNORED_DIRS`/`PROFILER_IGNORED_DIRS` 定数の
   参照先を共有定数 `SCAN_IGNORED_DIRS` に差し替えたことのみ。除外対象ディレクトリ名の集合が広がる
   （`.claude` が新規追加、`code-quality-scanner`/`database-access-scanner` に `.worktrees` が新規追加）ため
   走査スコープは縮小するが、スコープ内ファイルに対する検出ロジック・出力フィールド・gate effect分類は
   一切変更していない。既存のテストは無改変で通る（RWS-S-6）。

## Threat Model Rationale

このStoryで唯一セキュリティ上意味を持つ変更は「走査スコープの縮小」である。想定される脅威は2つ:

- スキャナの検出を意図的または偶発的に回避する目的で、本来スキャンされるべきソースコードが除外ディレクトリ名
  （`.claude` / `.worktrees` など）の配下に置かれるケース。除外はディレクトリ名の完全一致であり、
  製品ソースが慣習的に置かれるディレクトリ名（`src` / `app` / `pages` / `lib` 等）とは重ならないため
  リスクは低いが、ゼロではない。
- 共有された除外集合が可変であることによる「サイレントな検出範囲のドリフト」。呼び出し側が `.add()` /
  `.delete()` で集合を書き換えられると、3スキャナ全体の検出範囲が気づかれないまま変わる
  （実際に `Object.freeze(new Set(...))` はこれを防げないことが `src/scan-ignored-dirs.js` のコメントに
  記録されている — Setの内部slotはfreezeされないため）。

対策として、`SCAN_IGNORED_DIRS` は `has()` のみを公開する凍結済みプレーンオブジェクトのファサードとし
（`Object.freeze({ has })`）、呼び出し側からの変異を構造的に不可能にした。除外対象は「走査コストの高い
ツール/セッション状態ディレクトリ」に限定し、製品ソースが置かれる規約的ディレクトリは対象にしていない。

## Traceability

各節は下表のAC/clauseに対応する。証跡の記録（`vibepro verify record`/`verify run`）は本Story doc/Spec doc
の記述対象外であり、別途オペレーターが行う。

| AC | Spec clause | 要旨 |
|----|-------------|------|
| RWS-S-1 | INV-001 | walkFiles: 明示キュー＋単一アキュムレータ |
| RWS-S-2 | S-001 | spread上限規模でのRangeError非発生（回帰テスト） |
| RWS-S-3 | C-001 | walkFiles外部契約の不変性 |
| RWS-S-4 | INV-002 | 3スキャナの除外集合の単一定数への集約 |
| RWS-S-5 | S-002 | `.claude` / `.worktrees` の3スキャナ共通除外 |
| RWS-S-6 | INV-003 | 検出ロジック・出力スキーマの不変性、既存テスト無改変、6件の構造化inherited_behavior宣言 |
