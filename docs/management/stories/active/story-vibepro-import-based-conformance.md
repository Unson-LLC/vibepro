---
story_id: story-vibepro-import-based-conformance
title: モジュール間依存の測定をGraphify callsから実import文スキャンへ切り替える
status: active
parent_design: story-vibepro-import-based-conformance
reason: story-vibepro-target-architecture-conformance(PR #378)導入のconformanceはGraphifyの"calls"エッジをundeclared_dependency判定の根拠にしていたが、story-vibepro-infra-story-dependency-cut(PR #387)の独立監査で最大違反ペア(workspace-infra->story, 46 edges)の実依存は3本のみ、残り約43本は識別子参照の逆向き帰属ノイズと判明した。violation数はrun間でも揺れ、台帳として信頼できない。代替は本文書に書ける決定論的な代替手段(実import/export/require文の静的スキャン)のみであり、graph.jsonへの依存を切ってもconformanceはdry-run専用でgateに未結合のため既存の互換性・rollback経路に影響しない(コマンドとscanner関数の削除でrollback可能)。境界は`src/architecture-conformance.js`の依存判定ロジックとそのテストに限定し、target-model.jsonのallowed_dependencies/budgets宣言自体やgateへの結合は変更しない。
---

# モジュール間依存の測定をGraphify callsから実import文スキャンへ切り替える

## User Value

VibePro開発者が `vibepro architecture conformance` を実行したとき、undeclared_dependency違反が実際のソースコード上のimport/export/require文で裏付けられる。Graphifyの"calls"抽出ノイズ(識別子参照の逆向き帰属)によって実在しない依存が violation として報告されなくなり、減算(削除・統合)Storyの提案が信頼できる台帳の上で行えるようになる。

## Background / Evidence

- PR #378 (`story-vibepro-target-architecture-conformance`, merged 2026-07-22): `findDependencyViolations` は `.vibepro/graphify/graph.json` の `calls`/`imports_from`/`method` エッジを undeclared_dependency の根拠にしていた。
- PR #387 (`story-vibepro-infra-story-dependency-cut`, merged 2026-07-24): 独立裁定者2名が最大違反ペア workspace-infra -> story (46 edges) を再現確認し、実依存は3本のみ、残り約43本はGraphifyの"calls"抽出ノイズ(識別子参照の逆向き帰属)と判明。violation数は同一HEADに対する再実行でも揺れた(44/46, 68/85等)。
- 結論: 現行の violation 数は台帳として信頼できない。測定層自体を修正しない限り、以降の減算Storyは誤った根拠の上に立つ。

## Acceptance Criteria

- `IBC-AC-001`: `vibepro architecture conformance` の undeclared_dependency 判定は、`src/`・`bin/` 配下の `.js`/`.mjs`/`.cjs` ファイルを走査した実 `import ... from`／`export ... from`／動的 `import()`／`require()` の相対パス解決結果(決定論的スキャン)のみを根拠とする。Graphifyの `calls` エッジは根拠として使わない。
- `IBC-AC-002`: node組み込みモジュール(`node:*`)およびnpmパッケージ(bare specifier)への参照は依存判定から除外する。相対パス以外の specifier は無視する。
- `IBC-AC-003`: artifact(`conformance.json`)は `edge_source: "import_scan"` を明示し、旧方式(Graphify calls)からの移行理由を1行の `edge_source_note` として含む。**互換性への影響**: これは追加フィールドに留まらない。トップレベルの `graph`(`path`/`node_count`/`dependency_edge_count`)フィールドは削除され、`import_scan`(`scanned_file_count`/`edge_count`/`unresolved_reference_count`)と `graph_context`(`available`/`node_count`/`calls_edge_count`/`note`)へ置き換わる、破壊的な出力形状変更である。リポジトリ内の呼び出し元は `src/cli.js` の1箇所のみで、本Storyの同一コミットで更新済み(grep で確認済み・他に消費者なし)。この artifact はdry-run専用の診断出力でありバージョン管理された公開APIではないため、非推奨期間は設けない。生のJSON形状に依存する外部スクリプトがあれば追随が必要。
- `IBC-AC-004`: `graph.json` が存在しなくても import scan のみで conformance が動作する(graph.json は `graph_context` として文脈情報のみ提供し、欠落時も fail loud しない)。target model が存在しない場合は従来通り fail loud する。**スキャン対象の scope_roots にソースファイルが1件もない場合も fail loud するが、これは既存契約の継続ではなく本Storyで新規に追加した保護である**: 旧実装(Graphify calls依存)はこのケースで空の importEdges/violations を「成功」として静かに返していた(measurement not possible ≠ 0 violations という区別がなかった)。import scanが実行不能な状態を偽陰性の成功として返さないために、この一件は新しいfail-loudパスとして追加し、専用の回帰テストで担保する。TAC-AC-005 の「graph.json 欠落は fail loud」という契約は本Storyで意図的に緩和(graph.jsonは文脈情報化)し、代わりにこの新しい保護(scope空)を置く — 契約の継続ではなく置き換えである。
- `IBC-AC-005`: 既存の budget_violation / orphan_file / stale_pattern 判定、dry-run専用の exit code 契約(`--strict` 時のみ非0)は変更しない。

## Non Goals

- target-model.json の `allowed_dependencies` / `budgets` 宣言内容、モジュール分割そのものの変更は行わない。
- R-001 (workspace-infraは何にも依存しない) / R-002 (cli以外はcliを呼ばない) の実import違反を修正すること。本Storyは測定のみを扱い、検出された違反の解消は別Storyのスコープとする。
- conformance の gate 化・blocking 化は行わない(既存通りdry-run専用)。
- rule_id 帰属機構(`story-vibepro-ideal-state-inversion` の作業範囲)の実装は行わない。並走マージ後は本Storyの import edge をそのrule_id判定にそのまま渡せる形を維持するに留める。

## Rollback

`src/architecture-conformance.js` の変更と `test/architecture-conformance.test.js` を revert すれば旧(Graphify calls依存)の挙動に戻る。target-model.json 自体は変更しないため、モデル裁定状態への影響はない。
