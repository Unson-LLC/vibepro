# Spec: 製品コードを実行しないtest/e2eの自己充足テストを解消し再発をlintで止める

- Story: `story-vibepro-vacuous-e2e-test-elimination`
- 機械可読の正本: `.vibepro/spec/story-vibepro-vacuous-e2e-test-elimination/spec.json`

このMarkdownは人間が読むための面であり、clause単位の検証は上記JSONを正とする。

## 問題

`test/e2e/` 配下の19ファイルが、製品コードを一切importも実行もせず、
テストファイル内で定義した文字列リテラルを、その文字列に含まれる語から作った
正規表現で `assert.match` していた。左辺と右辺がどちらもテスト自身の産物なので、
製品コードがどう壊れてもassertionは通る。

`node --test` はこれらを通常のテストとして数えるため、
「AC件数分のe2eテストがpassしている」という誤った読み取りを生む。
どのdiffにも現れないため、diffから導出する既存チェックでは検出できなかった。

## 判定基準（lint）

e2eテストは最低でも次のいずれかを行っていなければならない。

| capability | 判定に使うmodule specifier |
|---|---|
| 製品コードのimport | `src/` `bin/` `scripts/` を含むパス |
| 子プロセス起動 | `child_process` / `node:child_process` |
| ファイルシステムアクセス | `fs` / `node:fs` / `node:fs/promises` |

ESMではこの3つはいずれもimport/require無しには到達できないため、
判定はmodule specifierだけで完結する。コメントは先に除去するので、
コメントアウトされたimportはカバレッジとして数えない。

## 削除と書き換えの判定

19ファイルそれぞれについて、対応StoryのACが別ファイルの実挙動テストで
検証されているかを実測した。

- 17件: `test/cli-status-honesty.test.js` / `test/engineering-judgment-activation-precision.test.js` /
  `test/managed-worktree-policy-resync.test.js` / `test/traceability-usage-report.test.js` /
  `test/vibepro-cli.test.js` と実在する `-main.test.js` 兄弟ファイルが、
  実git repoと `runCli` で同一ACを検証していた。削除。
- 2件: 他のどのテストも実行していない分岐を扱っていた。実挙動テストへ書き換え。
  - `src/execution-state.js` `deriveCompletedPhases` の `merged && !hasExplicitDelivery -> agent_review`
  - `src/managed-worktree-gate.js` `findAcceptedManagedWorktreeBypass` 経由の bypassed 分岐

書き換えた2件はいずれもmutation checkで確認した。
該当する製品分岐を外すとテストが落ちる。

## 出荷単位

**単一PR(2026-07-29改訂)**: 削除17件 + 書き換え2件 + Story/spec/doc/config + lint本体 +
lintのCIステップ + Story acceptance replay spec を1つのPRに含め、
VET-S-1 から VET-S-6 までを同一HEADで満たす。

旧記載は以下で、これは撤回した。

> lintは19ファイルが存在する状態では失敗するため、順序を入れ替えられない。
>
> 1. PR 1: 削除17件 + 書き換え2件 + Story/spec/doc/config → VET-S-2, VET-S-3, VET-S-4, VET-S-6
> 2. PR 2: lint本体 → VET-S-1, VET-S-5

「lintは19ファイルが存在する状態では失敗する」という制約は、削除とlintを
同一commit範囲に置けば発生しない。分割した場合にのみ生じる制約だった。
分割のもう一方の根拠(削除のみのlaneは `atomic_scope` を取得できないので
`gate:pr_scope_judgment` を分割でしか閉じられない)は実測で否定されている。
分割しても同gateは `needs_split` のままで、解消は分割の有無に依存しない。
詳細はStoryの Delivery 節を参照。

## 脅威モデル上の位置づけ

このlintが守るのは「テスト結果の信頼性」であり、悪意ある回避ではない。
未使用のcapability importを1行足せばlintは通るため、
これは事故的な再発を止めるtripwireである。
逆方向（test helper経由で間接的に製品コードへ到達するテスト）は
vacuous判定になって失敗するので、誤りはloudな偽陽性として出る。
