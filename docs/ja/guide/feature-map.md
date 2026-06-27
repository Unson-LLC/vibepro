# 機能マップ

| 領域 | コマンド | 出力 |
| --- | --- | --- |
| Story / Spec | `story list`, `story derive`, `story diagnose` | Story catalog、診断レポート、追跡性文脈 |
| Graph artifact | `graph` | `.vibepro/graphify/` |
| PR readiness | `pr prepare`, `check pr-readiness` | `.vibepro/pr/<story-id>/` |
| 検証 | `verify record`, `verify status` | `.vibepro/verification-artifacts/` |
| レビュー | `review prepare`, `review record`, `review status` | `.vibepro/reviews/` |
| 判断 | `decision record`, `decision status` | リスク受容とwaiver記録 |
| Doctor | `doctor` | 作業領域の健康診断と修復候補 |

`codebase-memory-mcp` 専用のVibeProコマンドはありません。利用可能な場合、`pr prepare` が任意の topology provider として自動的に読みます。
