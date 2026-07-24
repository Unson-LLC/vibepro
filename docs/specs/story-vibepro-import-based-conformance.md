---
story_id: story-vibepro-import-based-conformance
parent_design: story-vibepro-import-based-conformance
---

# Spec: import文ベースのconformance依存測定

人間可読ミラー。機械可読の正本は `.vibepro/spec/story-vibepro-import-based-conformance/spec.json`。

## Clauses

- `C-001` (contract): `findDependencyViolations` は `importEdges`(モジュール間import-scanエッジ)からのみ undeclared_dependency を集計する。Graphifyの `calls`/`imports_from`/`method` グラフエッジは根拠に使わない。
- `INV-001` (invariant): `buildImportDependencyEdges` は `.` で始まる相対specifierのみを追跡する。`node:` 組み込みおよびbareなnpmパッケージspecifierは構造上エッジ集合から除外される。
- `C-002` (contract): `runArchitectureConformance` の結果は常に `edge_source: "import_scan"` と、Graphify callsエッジからの移行理由を説明する1行の `edge_source_note` を含む。**破壊的変更**: トップレベルの旧 `graph` フィールドは削除され `import_scan`/`graph_context` へ置き換わる。呼び出し元は `src/cli.js` の1箇所のみで同一コミットで更新済み。この artifact はdry-run専用診断出力でバージョン管理された公開APIではないため後方互換は提供しない。
- `S-001` (scenario): `.vibepro/graphify/graph.json` が存在しないリポジトリで `vibepro architecture conformance` を実行しても、import scanのみでconformanceは完了し、fail loudせず `graph_context.available=false` を報告する。
- `INV-002` (invariant): `budget_violation` / `orphan_file` / `stale_pattern` の判定、および dry-run専用のexit code契約(`--strict`かつviolation存在時のみ非0)は、edge-source移行によって変更されない。
- `S-002` (scenario, 新規追加の保護): target modelの `scope_roots` 配下に `.js`/`.mjs`/`.cjs` が1件も見つからない場合、fail loudする。これは既存契約の継続ではない — 旧実装(Graphify calls依存)はこのケースで violation_count=0 の「成功」を静かに返していた。回帰テスト: `test/architecture-conformance.test.js` の `scope_roots resolving to zero .js/.mjs/.cjs files fails loud instead of a silent zero-violation success`。

## Code / Test References

- `src/architecture-conformance.js`
- `test/architecture-conformance.test.js`
