# 機能マップ

| 領域 | コマンド | 出力 |
| --- | --- | --- |
| Story / Spec | `story list`, `story derive`, `story diagnose` | Story catalog、診断レポート、追跡性文脈 |
| Graph artifact | `graph` | `.vibepro/graphify/` |
| PR readiness | `pr prepare`, `check pr-readiness` | `.vibepro/pr/<story-id>/` |
| 検証 / CI | `verify record`, `verify import-ci` | `.vibepro/verification-artifacts/`、CI evidence |
| 独立レビュー | `review prepare`, `review start`, `review close`, `review record`, `review status` | `.vibepro/reviews/`、lifecycle / provenance |
| Adjudication | `adjudicate prepare`, `adjudicate record` | Clause / Senior Judgment verdict |
| 判断 | `decision record`, `decision status` | リスク受容とwaiver記録 |
| Release guard | `guard check`, `guard status` | fail-closed release境界 |
| Managed execution | `execute start`, `execute status`, `execute reconcile`, `execute merge` | `.vibepro/executions/`、監査済みmerge状態 |
| Audit / ROI | `audit replay`, `audit session-cost`, `usage report` | canonical replay、cost、gate / subagent ROI |
| UI/UX intake / IA | `journey handoff`, `story map`, `design-modernize plan` | Journey文脈、Storyリンク、routeとflowの仮説 |
| Native Design System | `design-system init`, `design-system derive`, `design-system validate` | `.vibepro/design-system/<ds-id>/` |
| UI modernization証跡 | `design-modernize derive-system`, `design-modernize plan`, `verify visual`, `uiux evidence` | `.vibepro/design-modernize/<story-id>/`、visual residual、responsive / accessibility証跡 |
| UI/UX cockpit / PR連携 | `pr prepare`, `review prepare`, `review status` | `review-cockpit.html`、`gate-dag.html`、PR readiness gate |
| Doctor | `doctor` | 作業領域の健康診断と修復候補 |

`codebase-memory-mcp` 専用のVibeProコマンドはありません。利用可能な場合、`pr prepare` が任意の topology provider として自動的に読みます。

## UI/UX Workflow Path

既存Storyから開始します。intake prompt や visual hypothesis は判断材料に限定し、ready判定は Story、Spec、Architecture、現行route code、VibePro-native Design System、現在の検証証跡、Gate DAG で行います。

```bash
vibepro story list .
vibepro journey handoff . --id <journey-id>
vibepro design-system derive . --id <ds-id> --product <name> --routes <csv> --from-code
vibepro design-modernize plan . --id <story-id> --product <name> --routes <csv> --base-url <url>
vibepro verify visual . --id <story-id> --base-url <url>
vibepro uiux evidence . --id <story-id>
vibepro pr prepare . --story-id <story-id> --base origin/main
```

関連するUI/UX Storyは `story-vibepro-uiux-structured-intake`、`story-vibepro-uiux-ia-flow-map`、`story-vibepro-uiux-style-preset-token-gate`、`story-vibepro-uiux-responsive-a11y-evidence-matrix`、`story-vibepro-uiux-one-command-cockpit` です。
