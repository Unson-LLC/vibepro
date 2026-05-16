# Story: VibePro performance evidence framework

## 背景

改善Storyで「速くなった」と判断するには、開始点、途中marker、完了点、証跡source、失敗分類がStoryごとに同じ定義で残る必要がある。従来の `measure` はHTTP、command、startupなどの低レベル計測を保存できるが、ユーザー体感、サーバー内部、外部依存を同じStoryのbefore/afterとして再集計する契約が弱かった。

## 要求

任意のStoryで `performanceMetrics` を定義し、before/after runを同一schemaで `.vibepro/pr/<story-id>/performance-runs/*.json` に蓄積できるようにする。

各metricは以下を明示する。

- `metricId`
- `userStory`
- `startCondition`
- `completionCondition`
- `intermediateMarkers`
- `timeoutMs`
- `failureClassifications`
- `evidenceSources`
- `comparisonPolicy`

## 受け入れ条件

- [x] storyごとにperformance metricを定義できる
- [x] runが同一schemaで `.vibepro/pr/<story-id>/performance-runs/*.json` に保存される
- [x] before/afterのp50/p90/max差分を自動集計できる
- [x] `blocked`, `needs_review`, `timeout`, `auth_required`, `resource_unavailable`, `unknown` を未完了runとして残せる
- [x] server log、browser E2E、API log、client marker、manual observationを別sourceとして記録できる
- [x] user-perceived metricはserver logだけで比較可能扱いにしない
- [x] diagnoseとPR summaryでperformance evidenceを読める
- [x] comparison不能時は理由と不足marker/sourceを表示する

## 非目標

- Playwright marker収集そのものの自動実装は別Storyに分ける
- 既存 `vibepro measure` のschema互換を壊さない
