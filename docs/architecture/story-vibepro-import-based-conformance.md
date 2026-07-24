---
story_id: story-vibepro-import-based-conformance
parent_design: story-vibepro-import-based-conformance
---

# Architecture: import文ベースのconformance依存測定

## Context

`vibepro architecture conformance` (`src/architecture-conformance.js`, PR #378) は `docs/architecture/target-model.json` の宣言と `.vibepro/graphify/graph.json` の `calls`/`imports_from`/`method` エッジを突き合わせ、undeclared_dependency を報告していた。PR #387 (`story-vibepro-infra-story-dependency-cut`) の独立監査で、最大違反ペア (workspace-infra -> story, 46 edges) のうち実依存は3本のみで、残りはGraphifyの"calls"抽出が識別子参照を逆向きに帰属させたノイズと判明した。violation数は同一HEADへの再実行でも揺れており(44/46, 68/85等)、台帳として信頼できない。

## Decision

依存判定の根拠を Graphify の calls グラフから、`src/`・`bin/` 配下の `.js`/`.mjs`/`.cjs` を対象にした実 import/export/require 文の決定論的スキャンへ切り替える。

- 新しい内部関数群 (`extractImportSpecifiers` / `resolveRelativeImport` / `buildImportDependencyEdges`) が `src/architecture-conformance.js` 内に追加され、ファイル内容から静的 import・`export ... from`・動的 `import()`・`require()` の相対 specifier を正規表現で抽出し、呼び出し元ファイルからの相対パス解決(拡張子補完・ディレクトリ index 解決込み)でリポジトリ相対パスへ解決する。
- `node:*` 組み込みおよび npm パッケージ(bare specifier)は `specifier.startsWith('.')` でない限り除外され、依存グラフに現れない。
- `findDependencyViolations` は `importEdges` のみを受け取り、target-model.json の `allowed_dependencies` と突き合わせて undeclared_dependency を生成する。
- `graph.json` はオプションの文脈情報 (`graph_context`) に降格し、欠落しても fail loud しない。target model 自体の欠落の場合は従来通り fail loud する。
- **scope_roots 配下に走査対象ファイルが1件もない場合も fail loud するが、これは新規追加の保護であり、既存契約の継続ではない**(下記 Failure Modes 参照)。
- artifact (`conformance.json`) は `edge_source: "import_scan"` と1行の `edge_source_note` を含み、旧方式からの移行理由を機械可読に明示する。

## Public Contract / Compatibility

`conformance.json` のトップレベル形状は破壊的に変わる: 旧 `graph` フィールド(`path`/`node_count`/`dependency_edge_count`)は削除され、`import_scan`(`scanned_file_count`/`edge_count`/`unresolved_reference_count`)と `graph_context`(`available`/`node_count`/`calls_edge_count`/`note`)へ置き換わる。トップレベルに新規 `edge_source`/`edge_source_note` も追加される。

- 影響範囲: `runArchitectureConformance` の呼び出し元は `src/cli.js`(`architecture conformance` サブコマンド)の1箇所のみ(`grep -rn "runArchitectureConformance" src bin` で確認済み)。同一コミットで `--json` 出力・Markdown レンダラ (`renderConformanceMarkdown`) の両方を新形状に更新済み。
- 互換性方針: この artifact はdry-run専用の診断出力であり、gateに未結合・バージョン管理された公開APIでもないため、後方互換フィールドや非推奨期間は設けない。生のJSON形状 (`result.graph.*`) を直接パースする外部スクリプト・ダッシュボードがあれば、`import_scan`/`graph_context` への追随が必要。
- budget_violation / orphan_file / stale_pattern の各 violation オブジェクトの形状、および `violations[]` 配列自体の構造は変更しない。

## Failure Modes

- target model 欠落・不正JSON: 従来通り fail loud(変更なし)。
- graph.json 欠落: **緩和**。従来は必須(欠落でfail loud)だったが、import scanのみで動作可能になったため任意の文脈情報に降格した。graph.json 不正JSON(存在するが parse 不能)は引き続き fail loud する。
- **scope_roots 配下に .js/.mjs/.cjs が1件もない: 新規追加のfail loud。** 旧実装(Graphify calls依存)はこのケースで空の importEdges から violation_count=0 を「成功」として静かに返していた — 「測定不能」と「違反ゼロ」を区別できていなかった。import scanが実質的に何もスキャンできない状態を偽陰性の成功として返さないよう、本Storyでこの経路を新設した。既存契約の"継続"ではない。回帰テスト: `test/architecture-conformance.test.js` の `scope_roots resolving to zero .js/.mjs/.cjs files fails loud instead of a silent zero-violation success`。

## Consequences

- violation台帳が実import文で裏付けられ、run間で決定論的になる(同一HEADへの3回実行で件数が完全一致することを確認済み)。
- `budget_violation` / `orphan_file` / `stale_pattern` の判定ロジック、dry-run専用の exit code 契約は変更しない。
- target-model.json の `allowed_dependencies` / `budgets` 宣言自体は変更しない。R-001 (workspace-infraは何にも依存しない) / R-002 (cli以外はcliを呼ばない) の実import違反の解消は別Storyのスコープとする。

## Rollback

`src/architecture-conformance.js` と `test/architecture-conformance.test.js` の変更を revert すれば旧(Graphify calls依存)の挙動に戻る。target-model.json は変更しないため、モデル裁定状態への影響はない。
