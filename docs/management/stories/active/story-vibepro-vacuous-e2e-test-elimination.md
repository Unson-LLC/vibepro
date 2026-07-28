---
story_id: story-vibepro-vacuous-e2e-test-elimination
title: 製品コードを実行しないtest/e2eの自己充足テストを解消し再発をlintで止める
status: active
view: dev
period: 2026-07
category: quality
source:
  type: operator_feedback
  title: "test/e2e配下に、テスト内で定義した文字列リテラルを同じ文字列由来の正規表現でassert.matchするだけの、構造上失敗しないテストが19ファイル存在する"
related_stories:
  - story-vibepro-fake-value-hardening
  - story-vibepro-content-scoped-evidence-freshness
  - story-vibepro-engineering-judgment-surface-evidence
reason: "alternatives considered: (a) 19ファイルを一括削除してカバレッジの穴を許容する、(b) 全ファイルを実挙動テストへ書き換える、(c) ファイルごとに実カバレッジの有無を実測し、存在するものは削除・存在しないものだけ書き換える。(c)を選択した。(a)は実カバレッジが別ファイルに存在することを確認せずに消すため、実際に未検証な分岐(execution-state.jsのmerged->agent_review導出、managed-worktree-gate.jsのbypassed分岐)を見逃す。(b)は既にtest/vibepro-cli.test.js等が実git repo + runCliで同一ACを検証している15ファイル分の重複テストを新規に増やし、CI時間と保守面を悪化させる。compatibility impact: 削除対象はいずれも製品コードを一切importせず実行しないため、製品挙動の検証範囲は縮小しない。scripts/run-e2e-ts-specs.mjsはtest/e2e/*.spec.tsが0件になるとerror扱いになるが、削除後も22件のspec.tsが残るためgateは維持される。docs/management/audit-artifacts/とroi-ledgerおよび過去Storyのpr-prepare.json内のtest_refsは凍結された監査記録であり書き換えない。一方 .vibepro/spec/ 配下はgit追跡されvalidateSpecで機械検証される現行SSOTなので、削除ファイルを指すtest_refは現に存在する実挙動テストへ張り替える。rollback plan: 本コミットをrevertすれば削除ファイルとlintが同時に戻る。データ移行なし。boundary and scope: test/e2e配下のTier A(src import・プロセス起動・fsアクセスのいずれも無い)ファイルと再発防止lintのみを対象とする。docs/srcをreadFileして単語をgrepするだけのTier B 8件、製品コードの実装変更、mutation testingの導入は対象外。"
spec_docs:
  - docs/specs/story-vibepro-vacuous-e2e-test-elimination.md
created_at: 2026-07-28
updated_at: 2026-07-28
---

# 製品コードを実行しないtest/e2eの自己充足テストを解消し再発をlintで止める

## Background

`test/e2e/` 配下に、製品コードを一切importも実行もせず、テストファイル内で定義した文字列リテラルを、
その文字列に含まれる語から作った正規表現で `assert.match` するだけのファイルが19件存在する
(origin/main `eae6373e` で確認)。

最小例は `test/e2e/story-vibepro-engineering-judgment-activation-precision-main.test.js` の全9行:

```js
assert.match('activation_candidates activation_signals activation_precision', /activation_precision/);
```

左辺はこのファイル自身が書いたリテラルであり、右辺はその部分文字列である。
製品コードがどう壊れてもこのassertionは通る。
`story-vibepro-keyword-gate-structured-migration-main.spec.ts` はAC文(日本語)をローカル`const`に置き、
その文に含まれる語で `assert.match` している。

これらはStory ACへのトレーサビリティ・マーカーとして書かれているが、
`node --test` 上は通常のテストとして数えられるため、
「AC件数分のe2eテストがpassしている」という誤った読み取りを生む。

## User Story

**As a** VibeProのテスト結果をPR判断の根拠に使う人<br>
**I want** test/e2e配下のテストが製品コードを実行していることを保証されること<br>
**So that** passしているe2eテスト数を、実際に検証された挙動の量として読める

## Scope

- 19件それぞれについて、対応するStoryのACが別ファイルの実挙動テストで検証されているかを実測する。
- 実カバレッジが存在するものは削除する。存在しないものは、その未検証分岐を実際に実行する実挙動テストへ書き換える。削除して穴を空けたままにしない。
- `test/e2e` 配下に「src importもプロセス起動もfsアクセスも無いテストファイル」が再び追加されたら失敗するlintテストを追加する。

## Acceptance Criteria

- [ ] VET-S-1: `test/e2e` 配下に、src import・プロセス起動・fsアクセスのいずれも持たないテストファイルが0件になる。
- [ ] VET-S-2: 削除した各ファイルについて、対応StoryのACを検証する実挙動テスト(製品コードをimportまたはCLI実行するもの)が別ファイルに存在する。
- [ ] VET-S-3: 実カバレッジが無かった `src/execution-state.js` の `deriveCompletedPhases` における `merged && !hasExplicitDelivery -> agent_review` 導出が、実挙動テストで検証される。
- [ ] VET-S-4: 実カバレッジが無かった `src/managed-worktree-gate.js` の `buildManagedWorktreeGate` bypassed分岐(accepted waiver decision record経由)が、実挙動テストで検証される。
- [ ] VET-S-5: 新たに追加されたlintテストは、製品コードを実行しないtest/e2eファイルを検出して失敗する。lint自身が対象ディレクトリを走査できない場合も失敗する。
- [ ] VET-S-6: `scripts/run-e2e-ts-specs.mjs` の `.spec.ts` gateは削除後も有効なまま(spec数 > 0)である。

## 既存挙動（inherited behavior）

- `scripts/run-e2e-ts-specs.mjs` のNode版判定・skip注記・空集合エラーの挙動は変更しない。
- `test/vibepro-cli.test.js` をはじめとする既存の実挙動テストは変更しない。
- `docs/management/audit-artifacts/` と `docs/management/roi-ledger/ledger.json` は過去の記録であり書き換えない。過去Storyの `pr-prepare.json` に記録済みの `test_refs` も監査記録として保持する。

## Delivery

本Storyは2 PRに分けて出荷する。順序に依存関係があるため入れ替えられない。

1. **PR 1 (e2e-gate / requirements-ssot / repo-control)**: 19件の削除・2件の実挙動テストへの書き換え・Story登録・`.vibepro/spec/` のtest_ref張り替え・`docs/specs/vibepro-pr-ship-command.md` の記述修正。VET-S-2 / VET-S-3 / VET-S-4 / VET-S-6 を満たす。
2. **PR 2 (runtime-behavior)**: `scripts/lint-e2e-product-execution.mjs` と `test/e2e-product-execution-lint.test.js`。VET-S-1 / VET-S-5 を満たす。

lintは19件が存在する状態では失敗するため、PR 2 を先に出すとCIが赤になる。逆順(PR 1 → PR 2)は各PR単体でgreenであることを実測済み。

## Dogfooding findings（VibePro本体の欠陥。本Storyでは修正せず別Storyに送る）

1. **削除のみのlaneはatomic scopeを取得できない**: `buildAgentReviewOwnerMapEvidence()` はowner判定を `content_binding.surface_files` から行うが、`buildContentBinding()` は実在するファイルしかhashしないため、削除されたパスは永久に `uncovered_paths` に残る。結果として削除主体の変更は `atomic_scope` を `accepted` にできず、critical gateである `gate:pr_scope_judgment` を分割以外の方法で閉じられない。本Storyがまさにこれに当たり、単一PR方針を断念して分割した。
2. **ディレクトリを `--inspection-input` に渡すと無言で捨てられる**: `buildContentBinding()` はディレクトリを `surface_files` にも `missing_files` にも入れないため、coordinatorは入力が無視されたことに気づけない。`verificationTargetCoversChangedPath()` はprefix一致を実装しており、ディレクトリ指定が効くように見えるのが誤解を強める。

## Non Goals

- docs/srcを `readFile` して単語をgrepするだけのTier B 8件の扱い(製品挙動は未実行だがfsアクセスはあるため、別Storyで判断する)。
- 製品コード(`src/`)の実装変更。上記 Dogfooding findings の2件も含め、本Storyでは修正しない。
- mutation testingの導入やgate新設。
