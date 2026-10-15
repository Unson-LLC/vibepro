---
story_id: story-vibepro-journey-scope-steps-curate
title: Journey を Story の範囲で絞り、必須 step と curate での step・論点の追加を扱う
status: active
contract_type: feature
view: dev
period: 2026-10
---

# Journey を Story の範囲で絞り、必須 step と curate での step・論点の追加を扱う

## Story

プロダクトの責任者として、1つのリポジトリに複数の Journey があるとき、Journey ごとに対象の Story と walking skeleton の必須 step を決め、curate で Story のない step や未解決の論点も記録したい。

それにより、curated Journey を手で書かずに、承認された Journey の構造を VibePro の curate だけで確定できる。

## Problem Frame

- status: valid
- statement: `deriveJourneyMap` は archived 以外の全 Story を読み、walking skeleton の必須 step を `discover` / `signup` / `first-value` に固定している。`curateJourneyMap` は conflict と open question への判断しか受け取らず、step や論点を足せない。
- reason: brainbase-organization#516（Journey 9）で、承認された4点のうち3点（範囲を Journey 9 の Story に絞る、agent-* step を必須にする、Story のない agent-task-readback を step と論点として残す）が curate で表せず、curated JSON の手書きしか手段がなかった。

## Constraints

- 設定がないときの derive の出力は変えない（全 Story、既定の必須 step）。
- 必須 step の既定は、Journey ごとに設定したときだけ置き換える。
- curate で足した step は Story を持たなくてよいが、Story の担保（coverage）を作らない。Story のない必須 step は walking skeleton の gap として残る。
- curate で足した論点は、status を明示しない限り未解決のまま残す。
- derive と curate で scope が違うときは、curate は書き込まずに止まる。
- curated JSON の形式（schema_version）は変えない。追加のフィールドだけにする。
- 新しい処理は `src/journey-scope.js` に置き、`src/journey-map.js` の増加を小さくする。

## Options

1. `.vibepro/config.json` の `journey.journeys.<id>` に scope と walking_skeleton.required_step_ids を置き、curate input に `add_steps` / `add_open_questions` を足す（採用）。設定はリポジトリに残り、curate は判断の記録だけを受け取る。
2. derive の CLI オプションだけで scope と必須 step を渡す（不採用）。実行ごとに値が変わり、curate と derive の一致を確かめられない。
3. curated JSON の手書きを正式な手段にする（不採用）。検証なしで構造を変えられてしまう。

## Acceptance Criteria

- [ ] JSC-1: Journey の設定がなければ、derive は全 Story と既定の必須 step を出す。
- [ ] JSC-2: `scope.story_tags`（frontmatter の `tags` / `journey_tags`）、`scope.story_id_prefixes`、`scope.story_ids` のどれかに当たる Story だけを derive が読む。`options.scope` でも渡せる。
- [ ] JSC-3: `walking_skeleton.required_step_ids` を設定した Journey だけ、必須 step がその値になる。
- [ ] JSC-4: curate input の `add_steps` で Story のない step を足せ、`walking_skeleton_required` で必須にできる。`add_open_questions` で未解決の論点を足せる。
- [ ] JSC-5: 形式の誤り、既存と重なる論点 ID、derive 後の scope の変更では、curate は書き込まずに失敗する。
