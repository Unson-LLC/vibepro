---
story_id: story-vibepro-ideal-state-inversion
title: senior-gap judgmentのideal_stateがStoryではなく裁定済みtarget architectureを参照するようにする
status: active
reason: buildIdealStateはこれまでStory自身のacceptance criteria/gate DAGのみからideal stateを作る自己参照構造で、Story側が誤っていてもStoryを裁く外部規範が存在しなかった。PR #378でdocs/architecture/target-model.jsonという人間裁定済みのto-be正本が既に存在するため、代替案(a: 新規モデルを別途作る)は正本を二重化するので採らず、既存target-model.jsonをそのまま参照する。互換性はideal_stateへの追加フィールド(target_architecture)のみで既存キーは変更せず、buildIdealStateはgap生成やgate blockingを一切行わないdry-run的な参照供給に限定するため既存gate判定への影響はない。ロールバックはsenior-gap-judgment.js/architecture-conformance.js/target-model.jsonの当該差分を打ち消すのみで完結する。変更境界はこの3ファイルとpr-manager.jsの配線箇所に限定し、gate DAGへの新規ノード追加やblocking化・hotspot優先順位付け・decision card producerは別Storyとして切り出す。
---

# senior-gap judgmentのideal_stateがStoryではなく裁定済みtarget architectureを参照するようにする

## User Value

VibePro開発者が、PRのsenior gap judgmentを読んだときに「このStoryが自分自身のAcceptance Criteriaを満たしているか」だけでなく「佐藤が裁定済みのあるべきアーキテクチャ規範(target-model.json)から見て妥当か」を同じ artifact 上で確認できる。これにより、Story自身は正しくても裁定済み規範に反する変更(未宣言依存の追加・凍結ファイルの成長等)を、Story記述に頼らず機構側から見える化できる。

## Acceptance Criteria

- `IDEAL-AC-001`: `docs/architecture/target-model.json` の `status` が `adjudicated`、`adjudicated_by` が `sato_keigo`、`adjudicated_at` が `2026-07-22` であり、佐藤が2026-07-22に裁定した4規範(R-001 workspace-infraは何にも依存しない、R-002 cli以外はcliに依存しない、R-003 baseline 13ファイルは凍結行数を超えて成長しない、R-004 モジュール間新規依存はtarget-model宣言を先に必要とする)が `rules[]` として `{id, statement, status: adjudicated, adjudicated_by: sato_keigo, adjudicated_at}` の形で記録されている。
- `IDEAL-AC-002`: `vibepro architecture conformance` の各 violation に `rule_id` が付与される。`undeclared_dependency` は `from_module=workspace-infra` なら `R-001`、`to_module=cli` なら(前者に該当しない場合)`R-002`、それ以外は `R-004`。`budget_violation` は常に `R-003`。既存の「adjudicatedモデルではadvisory_noticeを出さない」挙動は変更しない。
- `IDEAL-AC-003`: `buildIdealState`(`src/senior-gap-judgment.js`)が返す `ideal_state` に `target_architecture` フィールドが追加される。`docs/architecture/target-model.json` が存在する場合は `{model_path, status, adjudicated_rules: [{id, statement}], conformance_summary}`(`conformance_summary` は直近の `.vibepro/architecture/conformance/conformance.json` の `summary`。無ければ `null`)を含み、target model が存在しない場合は `target_architecture: null` となる。`ideal_state` の既存フィールド(`story_id`/`title`/`acceptance_criteria_count`/`active_judgment_axes`/`required_gates`等)は変更しない。
- `IDEAL-AC-004`: `pr-manager.js` の `buildSeniorGapJudgment` 呼び出し箇所が target model と直近 conformance artifact を非同期で読み込み `targetArchitecture` として渡す。`buildIdealState` 自体は同期関数のままであり、ファイルI/Oを内部に持たない。
- `IDEAL-AC-005`: 本Storyの変更は `gate:senior_gap_judgment` の decision status を新規にblockへ変えない(target_architectureの参照供給のみで、gap生成やgate化は行わない)。target modelが存在しないfixture repoでの既存 `pr prepare` e2e (`SGJ-S-004`)がtarget_architecture=nullで従来通り通過し、target modelが存在するfixture repoでの新規e2eでもgateがblockにならないことをテストで示す。

## Non Goals

- conformance violation のgate化・blocking化(現状どおりdry-run専用のまま)。
- git churn × violation によるhotspot優先順位付け(次Story)。
- pr prepare / conformance / adjudication のneeds_review出力をhuman-decision-checkpointのchoices付きカードへ変換するdecision card producer(次Story、`human-adjudication-cards` skill運用)。
- target-model.json の `modules` / `allowed_dependencies` / `budgets` の構成変更(rules追加・status/adjudicated_by/adjudicated_at更新以外は変更しない)。
