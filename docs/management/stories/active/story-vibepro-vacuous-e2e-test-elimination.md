---
story_id: story-vibepro-vacuous-e2e-test-elimination
title: 製品コードを実行しないtest/e2eの自己充足テストを解消し再発をlintで止める
architecture_ref: docs/architecture/story-vibepro-vacuous-e2e-test-elimination.md
parent_design: vibepro-vacuous-e2e-test-elimination
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
reason: "alternatives considered: (a) 19ファイルを一括削除してカバレッジの穴を許容する、(b) 全ファイルを実挙動テストへ書き換える、(c) ファイルごとに実カバレッジの有無を実測し、存在するものは削除・存在しないものだけ書き換える。(c)を選択した。(a)は実カバレッジが別ファイルに存在することを確認せずに消すため、実際に未検証な分岐(execution-state.jsのmerged->agent_review導出、managed-worktree-gate.jsのbypassed分岐)を見逃す。(b)は既にtest/vibepro-cli.test.js等が実git repo + runCliで同一ACを検証している15ファイル分の重複テストを新規に増やし、CI時間と保守面を悪化させる。compatibility impact: 削除対象はいずれも製品コードを一切importせず実行しないため、製品挙動の検証範囲は縮小しない。scripts/run-e2e-ts-specs.mjsはtest/e2e/*.spec.tsが0件になるとerror扱いになるが、削除後も22件のspec.tsが残るためgateは維持される。docs/management/audit-artifacts/とroi-ledgerおよび過去Storyのpr-prepare.json内のtest_refsは凍結された監査記録であり書き換えない。一方 .vibepro/spec/ 配下はgit追跡されvalidateSpecで機械検証される現行SSOTなので、削除ファイルを指すtest_refは現に存在する実挙動テストへ張り替える。rollback plan: 本コミットをrevertすれば削除ファイルとlintが同時に戻る。データ移行なし。boundary and scope: 主対象は test/e2e配下のTier A(src import・プロセス起動・fsアクセスのいずれも無い)ファイルと再発防止lintである。加えて、本Story自身の証跡を空虚でないものにするために不可欠な派生修正だけを同一PRに含める: (1) 入れ子runnerの出力をTAP形式だけでassertしていた test/e2e/*-acceptance.spec.ts 6件のreporter形式修正(これが無いと .spec.ts レーンをe2e証跡として記録できない)、(2) package.json の typecheck glob への scripts/*.mjs 追加とそのfixture更新(拡張前はtypecheck証跡が対象ファイルを一度も読まない空虚な主張だった)、(3) 削除ファイルを指す origin ref 1行の docs/features/routing-profiles-rendered-projections/02_functional_spec.md 修正(同一SSOT対の食い違いを残さないため)。詳細と根拠は Delivery 節に列挙する。docs/srcをreadFileして単語をgrepするだけのTier B 8件、製品コードの実装変更、mutation testingの導入は対象外。"
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
- [ ] VET-S-2: 削除した17ファイルそれぞれについて、**代表となる実挙動テストケース**(製品コードをimportまたはCLI実行するもの)が別ファイルに実在し、名前で特定できる形で対応づけられている。対応表は網羅的(未対応の削除ファイルが0件)であり、各対応先ケースは実際に実行されてpassする。
      これは「削除ファイルが主張していた全ACが1対1で別テストへ移った」ことは主張しない。下記7 Story slugは `test/e2e/<slug>-*` を失い、再生auditではACがuncoveredとして報告される。これは意図した結果であり、CHANGELOGで開示済みである(削除したファイルは製品コードを一切実行しておらず、報告していたカバレッジは実体が無かったため、false greenの除去であって生成ではない)。
      - `cli-status-honesty`
      - `evidence-user-fingerprint`
      - `keyword-gate-structured-migration`
      - `pr-ship-command`
      - `execute-merge-command`
      - `engineering-judgment-activation-precision`
      - `merge-delta-review-reuse`

      > **Superseded (2026-07-31, owner裁定)**: 旧文言は
      > 「削除した各ファイルについて、対応StoryのACを検証する実挙動テスト(製品コードをimportまたはCLI実行するもの)が別ファイルに存在する。」
      > だった。独立裁定により、実証されているのは *代表ケース単位* の置換であって
      > *AC単位* の等価な移設ではないと判定された(削除ファイルの一部は7 ACや4 ACを主張していたが、
      > 対応先は各1ケース)。旧文言は実証範囲を超えて主張していたため、
      > owner (sato_keigo) の承認(2026-07-31, session 70ea817c-ee56-48c0-ab7c-612da8629872)のもと、
      > 実証済みの範囲へ再スコープした。7 slugのカバレッジ喪失は隠さず上記に明記する。
- [ ] VET-S-3: 実カバレッジが無かった `src/execution-state.js` の `deriveCompletedPhases` における `merged && !hasExplicitDelivery -> agent_review` 導出が、実挙動テストで検証される。
- [ ] VET-S-4: 実カバレッジが無かった `src/managed-worktree-gate.js` の `buildManagedWorktreeGate` bypassed分岐(accepted waiver decision record経由)が、実挙動テストで検証される。
- [ ] VET-S-5: 新たに追加されたlintテストは、製品コードを実行しないtest/e2eファイルを検出して失敗する。lint自身が対象ディレクトリを走査できない場合も失敗する。
- [ ] VET-S-6: `scripts/run-e2e-ts-specs.mjs` の `.spec.ts` gateは削除後も有効なまま(spec数 > 0)である。

## 既存挙動（inherited behavior）

- `scripts/run-e2e-ts-specs.mjs` のNode版判定・skip注記・空集合エラーの挙動は変更しない。
- `test/vibepro-cli.test.js` をはじめとする既存の実挙動テストは変更しない。
- `docs/management/audit-artifacts/` と `docs/management/roi-ledger/ledger.json` は過去の記録であり書き換えない。過去Storyの `pr-prepare.json` に記録済みの `test_refs` も監査記録として保持する。

## Delivery

**現行方針(2026-07-29改訂): 単一PRで原子的に出荷する。**

削除17件・実挙動テストへの書き換え2件・Story登録・`.vibepro/spec/` のtest_ref張り替え・
`docs/specs/vibepro-pr-ship-command.md` の記述修正・`scripts/lint-e2e-product-execution.mjs`・
`test/e2e-product-execution-lint.test.js`・CIステップ追加・Story acceptance replay specを
1つのPRに含め、VET-S-1 から VET-S-6 までを同一HEADで満たす。

加えて、本Storyの証跡を空虚でないものにするために必要になった派生修正を同一PRに含める。
いずれも本Story自身のgateを閉じるために不可欠で、単独では出荷単位を構成しない。

1. **`test/e2e/*-acceptance.spec.ts` 6件のreporter形式修正**:
   `story-vibepro-{agent-runtime-adapters, guarded-run-session-contract,
   human-decision-checkpoint, next-best-action-controller, run-context-capsule,
   safe-action-orchestrator}-acceptance.spec.ts`。入れ子の `node --test` 出力を
   TAP形式の `/# pass N/` だけでassertしていたため、Node 23以降がspec reporterを
   既定にすると製品挙動と無関係に失敗する。`/(?:ℹ|#) pass N/` へ広げた。
   これが無いと `.spec.ts` レーン全体をe2e証跡として記録できず、
   VET-S-6 の根拠が「ローカルでは検証不能」という注記付きのままになる。
   `run-context-capsule` の `pass 14` 固定値は下限へ緩めた
   (契約スイートへのテスト追加が無関係な赤にならないようにするため)。
2. **`package.json` の typecheck glob 拡張と `test/verification-runner.test.js` のfixture拡張**:
   `bin/vibepro.js src/*.js` に `scripts/*.mjs` を追加した。拡張前は
   `scripts/lint-e2e-product-execution.mjs` をtypecheck証跡のtargetに挙げながら
   globが同ファイルを一度も読まないという、まさに本Storyが除去する形の空虚な主張に
   なっていた。fixtureは実script文字列を実行するため、glob拡張に合わせて
   `scripts/` を作る形へ更新した。
3. **`docs/features/routing-profiles-rendered-projections/02_functional_spec.md`**:
   削除ファイルを指す origin ref 1行を、`.vibepro/spec/` 側の張り替え先と同じ
   `test/vibepro-cli.test.js` へ合わせた。同一SSOT対の2面が食い違う状態を残さない。

### 旧方針(superseded: 2 PR分割)とその撤回理由

当初の記載は以下のとおりで、これは撤回する。記録として残す。

> 本Storyは2 PRに分けて出荷する。順序に依存関係があるため入れ替えられない。
>
> 1. **PR 1 (e2e-gate / requirements-ssot / repo-control)**: 19件の削除・2件の実挙動テストへの書き換え・Story登録・`.vibepro/spec/` のtest_ref張り替え・`docs/specs/vibepro-pr-ship-command.md` の記述修正。VET-S-2 / VET-S-3 / VET-S-4 / VET-S-6 を満たす。
> 2. **PR 2 (runtime-behavior)**: `scripts/lint-e2e-product-execution.mjs` と `test/e2e-product-execution-lint.test.js`。VET-S-1 / VET-S-5 を満たす。
>
> lintは19件が存在する状態では失敗するため、PR 2 を先に出すとCIが赤になる。逆順(PR 1 → PR 2)は各PR単体でgreenであることを実測済み。

撤回の根拠は以下のとおり。1は未検証の観察、2と3は検証済みであり、
2と3だけで撤回の判断は成立する。

1. **分割の主動機は根拠として使えない(未検証)**: 下記 Dogfooding findings 1 は
   「削除主体のlaneは `atomic_scope` を `accepted` にできず、`gate:pr_scope_judgment` を
   分割以外で閉じられない」ことを分割の理由としていた。この主張は本Storyの成果物として
   検証されていない。削除のみの構成で `pr prepare` を実行したartifactは
   `.vibepro/pr/story-vibepro-vacuous-e2e-test-elimination/` に永続化されておらず、
   `split-plan.json` の `atomic_scope.status` は `not_requested` で、
   atomic scopeはそもそも一度も要求されていない。
   さらに単一PR化後の `needs_split` を実際に駆動しているのは
   `mixed_repo_control_surface`(`.github/workflows/ci.yml` と `package.json`)であり、
   これは単一PR化によって初めて生じたsignalである。
   したがって「分割してもgateは閉じない」とは主張できず、この項目は撤回の根拠に含めない。
   本項目はVibePro側の欠陥報告としてのみ残す。
2. **順序制約は単一PR化で消滅する(検証済み)**: 「lintは19件が存在する状態では失敗する」
   という制約は、削除とlintを同一commit範囲で出荷すれば発生しない。
   分割した場合にのみ生じる制約だった。
3. **分割ではVET-S-1が満たせない(検証済み)**: VET-S-1「test/e2e 配下に vacuous file が
   0件になる」は、削除とlintによる強制が同一HEADで同時に成立して初めて満たされる不変条件で
   あり、削除のみのPR 1 では成立しない。下記のacceptance coverage評価と合わせると、
   分割はPR 1 をwaiverなしには出荷できない構成にする。

加えて、Story全体のAcceptance CriteriaはStory単位で評価される
(`buildStoryE2eAcceptanceCoverage` はStory markdownの `## Acceptance Criteria` 配下の
全項目を必須とし、チェックボックス状態も繰り延べマーカーも解釈しない)。
`pr prepare --task` によるacceptance scopeの絞り込みは、hand-written Storyでは
`story derive` → `story plan` → `task create` の系列が使えないため利用できない。
そのため2 PR分割を維持すると、PR 1 は VET-S-1 / VET-S-5 未達を理由に
`gate:e2e` を `needs_evidence` のまま閉じられず、waiverなしには出荷できなかった。
単一PR化はこのwaiverを不要にする。

## Dogfooding findings（VibePro本体の欠陥。本Storyでは修正せず別Storyに送る）

1. **削除のみのlaneはatomic scopeを取得できない**: `buildAgentReviewOwnerMapEvidence()` はowner判定を `content_binding.surface_files` から行うが、`buildContentBinding()` は実在するファイルしかhashしないため、削除されたパスは永久に `uncovered_paths` に残る。結果として削除主体の変更は `atomic_scope` を `accepted` にできない。**訂正(2026-07-29)**: 当初これを「`gate:pr_scope_judgment` を分割以外の方法で閉じられない」と読み、分割の理由とした。しかしこの読みは本Storyでは検証していない。削除のみ構成の `pr prepare` artifactは残っておらず、`split-plan.json` の `atomic_scope.status` は `not_requested` である。単一PR化後に `needs_split` を駆動しているのは `mixed_repo_control_surface` であり、これは単一PR化で初めて生じたsignalなので、「分割の有無に依存しない」とも主張できない。本findingはVibePro側の欠陥報告としてのみ有効であり、PR分割の採否の根拠には使わない。実際のgate解消は理由付きdecision recordで行う。上記 Delivery の撤回根拠1を参照。
2. **ディレクトリを `--inspection-input` に渡すと無言で捨てられる**: `buildContentBinding()` はディレクトリを `surface_files` にも `missing_files` にも入れないため、coordinatorは入力が無視されたことに気づけない。`verificationTargetCoversChangedPath()` はprefix一致を実装しており、ディレクトリ指定が効くように見えるのが誤解を強める。

## Non Goals

- docs/srcを `readFile` して単語をgrepするだけのTier B 8件の扱い(製品挙動は未実行だがfsアクセスはあるため、別Storyで判断する)。
- 製品コード(`src/`)の実装変更。上記 Dogfooding findings の2件も含め、本Storyでは修正しない。
- mutation testingの導入やgate新設。
