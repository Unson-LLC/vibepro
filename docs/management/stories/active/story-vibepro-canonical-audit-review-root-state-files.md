---
story_id: story-vibepro-canonical-audit-review-root-state-files
title: Canonical auditがreview root直下のstory-level state fileでmergeを失敗させないようにする
status: active
view: dev
period: 2026-07
category: quality
related_stories:
  - story-vibepro-review-dispatch-preflight-dag
  - story-vibepro-canonical-audit-artifacts
reason: "src/canonical-audit.jsのsafeReaddirDirectories()は.vibepro/reviews/<story-id>/直下にstageディレクトリと*-final.md以外のエントリがあるとENOTDIRをthrowする。しかしreview authorizeフロー(src/agent-review.js)は同ディレクトリ直下にdispatch-authorizations.json(story-level state file)とmkdirベースの.dispatch.lockを作成するため、authorizeを経たstoryはvibepro execute mergeのcanonical audit promotion段階で必ず失敗する(2026-07-22にstory-vibepro-target-architecture-conformanceのmergeで再現)。代替案は(a)authorize側がstate fileをstage外の別ディレクトリへ書く、(b)audit側が既知のstory-level state fileを許容する、の2つ。(a)は既存storyのstate file移行とパス解決の互換層が必要で影響が大きい。(b)はreaddir分類の1関数に閉じるため採用。stage名を装ったファイル(拡張子なしファイル)への従来のfail-loudは維持し、許容はdotエントリと[A-Za-z0-9_-]+.jsonのstory-level state fileに限定する。rollback: safeReaddirDirectoriesの許容分岐をrevertすれば従来挙動へ戻る。boundary: canonical audit promotionのreaddir分類のみ。authorize側の書き込み先・stage配下の収集対象は変更しない。"
created_at: 2026-07-22
updated_at: 2026-07-22
---

# Canonical auditがreview root直下のstory-level state fileでmergeを失敗させないようにする

## User Value

review authorizeフローを使ったstoryでも `vibepro execute merge` がcanonical audit promotionで失敗せず、authorize（モデル承認・予算予約）とmerge監査を両立できる。

## Background（コード事実）

- `src/canonical-audit.js` の `safeReaddirDirectories()` は review root（`.vibepro/reviews/<story-id>/`）のエントリを列挙し、ディレクトリ以外は `*-final.md` のみ許容、それ以外は `expected review stage directory` (code: ENOTDIR) をthrowする。
- `src/agent-review.js` の authorize/dispatch フローは `getDispatchAuthorizationsPath()` で review root直下に `dispatch-authorizations.json` を書き、`withDirectoryLock()` で mkdirベースの `.dispatch.lock` ディレクトリを作成する（クラッシュ時は残骸が残り得る）。
- `safeReaddirDirectories()` の呼び出し元は `promoteCanonicalAuditArtifacts` 系のreview stage収集2箇所で、いずれも `vibepro execute merge` のcanonical audit promotionから到達する。
- 結果として、authorizeを使ったstoryのmergeは監査段階で必ず失敗する（story-vibepro-target-architecture-conformance で再現、2026-07-22）。

## Acceptance Criteria

- [ ] CARS-S-1: `.vibepro/reviews/<story-id>/` 直下に `dispatch-authorizations.json` が存在しても `promoteCanonicalAuditArtifacts` は失敗せず、stage収集は継続する。
- [ ] CARS-S-2: review root直下の将来のstory-level state file（`[A-Za-z0-9_-]+\.json` に一致するファイル）も同様に許容される。
- [ ] CARS-S-3: dot始まりのエントリ（stale `.dispatch.lock` ディレクトリ、`.DS_Store` 等）はstage一覧に含めず、エラーにもしない。
- [ ] CARS-S-4: stageディレクトリ名を装った拡張子なしファイル（例: `gate` という名前のファイル）は従来通り ENOTDIR でfail-loudする。
- [ ] CARS-S-5: 回帰テストで CARS-S-1〜S-4 を固定する。

## Non Goals

- authorize側（`src/agent-review.js`）の書き込み先・state fileスキーマの変更。
- stageディレクトリ配下の収集対象パターン（REVIEW_AUDIT_FILES / REVIEW_HANDOFF_FILES）の変更。
- `*-final.md` 互換許容の廃止・変更。
