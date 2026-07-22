---
story_id: story-vibepro-target-architecture-conformance
title: Target Architecture SSOTとconformance dry-runを導入する
status: active
reason: あるべき姿をStory自身やGraphify(as-is)から導出すると自己参照になり減算判断が原理的に出ないため、人間が裁く小さなto-beモデルを正本として新設し、既存graph.jsonとの決定論的diffで違反を可視化する。既存gateへの配線やblocking化は行わずdry-run専用に留めるため互換性影響はなく、問題時はコマンドとモデルファイルの削除でrollbackできる。変更境界は新規モジュール・CLIサブコマンド追加・target modelドキュメントに限定し、既存のsenior-gap judgment / gate DAGは変更しない。
---

# Target Architecture SSOTとconformance dry-runを導入する

## User Value

VibePro開発者が、Storyから独立した「あるべき構造」(target model)を正本として宣言でき、現状コード(Graphify as-isグラフ)との乖離 — 宣言外のモジュール間依存・複雑性予算超過・どのモジュールにも属さない孤児ファイル — を機械的に列挙できる。これにより削除・統合Storyの候補が機構から定常的に得られ、パッチ蓄積ではなく精錬のループが回る。

## Acceptance Criteria

- `TAC-AC-001`: `docs/architecture/target-model.json` が正本として存在し、モジュール定義(名前・責務・ファイルパターン)・許可依存(モジュール間の許可エッジ)・複雑性予算(ファイル行数上限・モジュール別ファイル数上限)・`status`(draft/adjudicated)と`adjudicated_by`を保持する。
- `TAC-AC-002`: `vibepro architecture conformance <repo>` が target model と `.vibepro/graphify/graph.json` を突き合わせ、(a) 宣言にないモジュール間依存、(b) 予算超過、(c) 孤児ファイルを violation として JSON artifact に出力する。
- `TAC-AC-003`: conformance は dry-run 専用であり、violation があっても exit code 0 で終了し、既存の gate_status / pr prepare の判定に影響を与えない。`--strict` 指定時のみ violation 存在で非0終了する。
- `TAC-AC-004`: target model の `status` が `draft` の場合、artifact とサマリーに「未裁定モデルにつき違反は参考値」である旨が明示される。
- `TAC-AC-005`: graph.json が存在しない・parse不能な場合は fail loud し、空の violation リストを成功として返さない。

## Non Goals

- senior-gap judgment の `buildIdealState` への配線(参照系の反転)は次Storyで行い、本Storyでは変更しない。
- conformance violation の gate 化・blocking 化は行わない。
- target model の自動生成・自動改訂は実装しない(モデルは人間の裁定でのみ改訂する)。
- CLIコマンド数予算・fix/feat比率などrepo横断メトリクスの収集は本Storyの範囲外。
