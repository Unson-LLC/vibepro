---
story_id: story-vibepro-vacuous-e2e-test-elimination
title: Vacuous e2e Test Elimination Architecture
---

# アーキテクチャ

## 判断

`test/e2e` に置かれたテストが「製品挙動を実行したこと」を、テスト本文の構造から機械判定する。
判定は再発防止lintとして `scripts/lint-e2e-product-execution.mjs` に置き、CIの必須stepにする。

判定を人間のレビュー観点として文書化するだけでは足りない。VibePro自身が
`node --test` のpass数をPR判断の根拠として読むため、製品コードを一切実行しないテストが
1件でもpassとして数えられると、「AC件数分のe2eテストがpassしている」という
誤った読み取りが成立してしまう。したがって判定は決定的なガードとして実装する
(`~/CLAUDE.md` 0.6 Prefer Deterministic Guards Over Reminders)。

## 境界

lintが見るのは**構造**であり、意味ではない。次の4つのsignalのいずれかが
ファイル本文に現れれば「製品挙動を実行している」と判定する。

| signal | 意味 |
|---|---|
| `product_import` | repository内部のmodule specifier (相対パス・`#`subpath・`@/`alias) を解決する |
| `process_start` | 子プロセスまたはCLIを起動する |
| `filesystem_access` | ファイルシステムを読み書きする |
| `browser_automation` | Playwright / Cypress / Puppeteer で実アプリを操作する |

`product_import` を「`../src/` を含むパス」に限定しない。共有test helper経由・
subpath import経由・alias経由で製品コードへ到達するテストも実行しているのは同じであり、
リテラルな `../src/` を要求すると正当なテストを誤って弾く。

この境界の帰結として、lintは**構造的なtripwireであり、挙動カバレッジの証明ではない**。
未使用importを1行足せば通り、製品コードをimportしたうえで自分の書いたリテラルだけを
assertするファイルも通る。守っているのは「テスト結果の信頼性」であって、
悪意ある回避ではない。

## 不変条件

lintが**自分の対象を観測できなかった場合は必ず失敗する**。走査不能なディレクトリ
(任意の深さ)、読取不能なファイル、空のファイル集合は、いずれも exit 1 とする。
observable でない状態から clean への遷移を持たない。clean は、列挙した全ファイルを
読んで分類し終えた後にのみ到達する。

`test/e2e` は再帰的に走査する。サブディレクトリを列挙から落とすと、
「観測できないものをcleanと報告しない」という上記の不変条件そのものを破る。

## 代替案と却下理由

- **19件を一括削除してカバレッジの穴を許容する**: 却下。実カバレッジが別ファイルに
  存在することを確認せずに消すと、実際に未検証な分岐
  (`src/execution-state.js` の merged->agent_review 導出、
  `src/managed-worktree-gate.js` の bypassed 分岐) を見逃す。
- **全ファイルを実挙動テストへ書き換える**: 却下。既存の実挙動テストが同一ACを
  検証している分の重複テストを新規に増やし、CI時間と保守面を悪化させる。
- **ファイルごとに実カバレッジの有無を実測し、存在するものは削除・
  存在しないものだけ書き換える**: 採用。

## 出荷単位

単一PR。削除とlintによる強制が同一HEADで同時に成立して初めて VET-S-1 が満たされるため、
分割できない。経緯と撤回した2-PR案は
`docs/management/stories/active/story-vibepro-vacuous-e2e-test-elimination.md` の
Delivery 節に supersede 形式で残す。

## Rollback

本commitのrevertで戻る。lintはstandaloneスクリプト1本・CI step 1つ・npm script 1つのみで、
出力をデータとして読む消費者は無く、永続状態もschemaもmigrationも無い。
revertせず無効化する場合は `.github/workflows/ci.yml` から
`npm run lint:e2e-product-execution` のstepを外す。削除17件はlintに依存しないため単独で成立する。
