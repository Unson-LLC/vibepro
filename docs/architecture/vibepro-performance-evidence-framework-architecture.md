# VibePro Performance Evidence Framework Architecture

## 位置づけ

`vibepro measure` は低レベル計測器であり、`vibepro performance` はStory単位の証跡契約である。

このframeworkは「何を、どこからどこまで、どの証跡sourceで測ったか」をStoryに固定し、後から同じschemaでbefore/afterを再集計できるようにする。

## データ配置

- metric definition: `.vibepro/config.json` の対象Story `performanceMetrics[]`
- run evidence: `.vibepro/pr/<story-id>/performance-runs/<run-id>.json`
- manifest summary: `.vibepro/vibepro-manifest.json` の `performance_evidence[story-id]`
- diagnose evidence: `.vibepro/diagnostics/<run-id>/evidence.json` の `performance_evidence`
- PR body: `.vibepro/pr/<story-id>/pr-body.md` の `Performance Evidence`

## Schema方針

metricは開始条件と完了条件を文字列として保持しつつ、VibePro側で以下の分類を付与する。

- start kind: `user_action`, `server_event`, `client_marker`, `custom`
- completion kind: `snapshot_visible`, `dom_visible`, `api_completed`, `interactive_ready`, `server_ready`, `custom`
- readiness kind: `server_side`, `user_perceived`, `external_dependency`, `system_internal`

これにより、snapshot表示、DOM表示、API完了、操作可能、サーバー準備完了を同じ「完了」として混同しない。

## 比較方針

before/after比較は以下を満たすrunだけで行う。

- `metricId` が一致する
- `completionCondition` がmetric定義と一致する
- statusが `completed`
- `duration_ms` が存在する

`user_perceived` metricでは、before/afterそれぞれに `browser_e2e`, `client_marker`, `manual_observation` のいずれかが必要である。`server_log` だけのrunは保存するが、ユーザー体感改善として比較可能扱いにしない。

## 未完了run

未完了runは破棄せず、以下で分類する。

- `blocked`
- `needs_review`
- `timeout`
- `auth_required`
- `resource_unavailable`
- `unknown`

集計ではsample数、未完了数、未完了率、分類別件数を出す。

## 表示面

`vibepro performance compare`、`diagnose`、`pr prepare` はp50/p90/max、sample数、未完了率、比較不能理由、不足marker/sourceを表示する。
